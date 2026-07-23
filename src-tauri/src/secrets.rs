use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use windows::core::w;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const STORE_FILE: &str = "secrets.dpapi";
const LEGACY_FILE: &str = "secrets.json";
const MAX_SECRET_BYTES: usize = 8 * 1024;

#[derive(Debug, Default, Deserialize, Serialize)]
struct SecretData(BTreeMap<String, String>);

fn validate_provider(provider: &str) -> Result<(), String> {
    let valid = !provider.is_empty()
        && provider.len() <= 64
        && provider
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err("密钥供应商标识不合法".to_string())
    }
}

fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext
            .len()
            .try_into()
            .map_err(|_| "密钥数据过大".to_string())?,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            w!("Tylpet API keys"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows DPAPI 加密失败：{error}"))?;
    }
    copy_and_free(output)
}

fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext
            .len()
            .try_into()
            .map_err(|_| "密钥文件过大".to_string())?,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows DPAPI 解密失败：{error}"))?;
    }
    copy_and_free(output)
}

fn copy_and_free(output: CRYPT_INTEGER_BLOB) -> Result<Vec<u8>, String> {
    if output.pbData.is_null() {
        return Ok(Vec::new());
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let copy = bytes.to_vec();
    let free_result = unsafe { LocalFree(HLOCAL(output.pbData as *mut c_void)) };
    if !free_result.is_invalid() {
        return Err("Windows DPAPI 内存释放失败".to_string());
    }
    Ok(copy)
}

fn load_from_path(path: &Path) -> Result<SecretData, String> {
    if !path.exists() {
        return Ok(SecretData::default());
    }
    let encrypted = fs::read(path).map_err(|error| format!("读取加密密钥失败：{error}"))?;
    let plaintext = unprotect(&encrypted)?;
    serde_json::from_slice(&plaintext).map_err(|_| "加密密钥文件内容损坏".to_string())
}

fn save_to_path(path: &Path, secrets: &SecretData) -> Result<(), String> {
    let plaintext = serde_json::to_vec(secrets).map_err(|error| error.to_string())?;
    let encrypted = protect(&plaintext)?;
    let parent = path.parent().ok_or_else(|| "密钥目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = path.with_extension("dpapi.tmp");
    let backup = path.with_extension("dpapi.bak");
    fs::write(&temp, encrypted).map_err(|error| error.to_string())?;
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    if path.exists() {
        fs::rename(path, &backup).map_err(|error| {
            let _ = fs::remove_file(&temp);
            error.to_string()
        })?;
    }
    fs::rename(&temp, path).map_err(|error| {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temp);
        error.to_string()
    })
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(STORE_FILE))
}

pub fn get_secret(app: &tauri::AppHandle, provider: &str) -> Result<Option<String>, String> {
    validate_provider(provider)?;
    let secrets = load_from_path(&store_path(app)?)?;
    Ok(secrets.0.get(provider).cloned())
}

#[tauri::command]
pub fn secret_has(app: tauri::AppHandle, provider: String) -> Result<bool, String> {
    Ok(get_secret(&app, &provider)?.is_some())
}

#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, provider: String, secret: String) -> Result<(), String> {
    validate_provider(&provider)?;
    if secret.trim().is_empty() || secret.len() > MAX_SECRET_BYTES {
        return Err("API key 不能为空且不能超过 8 KiB".to_string());
    }
    let path = store_path(&app)?;
    let mut secrets = load_from_path(&path)?;
    secrets.0.insert(provider, secret);
    save_to_path(&path, &secrets)
}

#[tauri::command]
pub fn secret_delete(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    let path = store_path(&app)?;
    let mut secrets = load_from_path(&path)?;
    secrets.0.remove(&provider);
    save_to_path(&path, &secrets)
}

pub fn migrate_legacy(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let legacy_path = dir.join(LEGACY_FILE);
    let target_path = dir.join(STORE_FILE);
    if !legacy_path.exists() {
        return Ok(());
    }
    if target_path.exists() {
        load_from_path(&target_path)?;
        return fs::remove_file(&legacy_path)
            .map_err(|error| format!("加密密钥已存在，但删除遗留明文密钥文件失败：{error}"));
    }
    let content =
        fs::read_to_string(&legacy_path).map_err(|error| format!("读取旧密钥文件失败：{error}"))?;
    let data: BTreeMap<String, String> = serde_json::from_str(&content)
        .map_err(|_| "旧密钥文件不是合法 JSON，已保留原文件".to_string())?;
    let filtered = data
        .into_iter()
        .filter(|(provider, secret)| {
            validate_provider(provider).is_ok()
                && !secret.trim().is_empty()
                && secret.len() <= MAX_SECRET_BYTES
        })
        .collect();
    save_to_path(&target_path, &SecretData(filtered))?;
    fs::remove_file(&legacy_path)
        .map_err(|error| format!("密钥已迁移，但删除旧明文密钥文件失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::{protect, unprotect, validate_provider};

    #[test]
    fn validates_provider_ids() {
        assert!(validate_provider("openai-compatible").is_ok());
        assert!(validate_provider("").is_err());
        assert!(validate_provider("OpenAI").is_err());
        assert!(validate_provider("../secret").is_err());
    }

    #[test]
    fn dpapi_round_trip_is_bound_to_current_user() {
        let plaintext = b"not-a-real-api-key";
        let encrypted = protect(plaintext).expect("protect");
        assert_ne!(encrypted, plaintext);
        assert_eq!(unprotect(&encrypted).expect("unprotect"), plaintext);
    }
}
