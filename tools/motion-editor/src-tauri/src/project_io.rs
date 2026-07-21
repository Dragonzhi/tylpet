use crate::models::{
    EditorStateV1, HostError, HostResult, ProjectManifestV1, ProjectSnapshot, SaveResult,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const MANIFEST_FILE: &str = "project.ltypet.json";

pub fn read_project(root: &Path) -> HostResult<ProjectSnapshot> {
    let root = canonical_directory(root, "read")?;
    recover_transactions(&root)?;
    let manifest_path = root.join(MANIFEST_FILE);
    let manifest: ProjectManifestV1 = read_json(&manifest_path, "read_manifest")?;
    let paths = validate_manifest_paths(&root, &manifest)?;
    let artwork = read_text(&paths[0], "read_artwork")?;
    let rig: Value = read_json(&paths[1], "read_rig")?;
    let motions: Value = read_json(&paths[2], "read_motions")?;
    validate_document(&manifest, &rig, &motions)?;
    let editor = read_json(&paths[3], "read_editor").unwrap_or_else(|_| EditorStateV1 {
        schema_version: 1,
        ..EditorStateV1::default()
    });
    Ok(ProjectSnapshot {
        manifest,
        artwork,
        rig,
        motions,
        editor,
    })
}

pub fn save_project(
    root: &Path,
    snapshot: &ProjectSnapshot,
    create: bool,
) -> HostResult<SaveResult> {
    validate_snapshot(snapshot)?;
    if create {
        fs::create_dir_all(root).map_err(|error| io_error("create_root", root, error))?;
    }
    let root = canonical_directory(root, "save")?;
    recover_transactions(&root)?;
    let paths = validate_manifest_paths(&root, &snapshot.manifest)?;
    let mut writes = vec![
        (
            PathBuf::from(MANIFEST_FILE),
            canonical_json(&snapshot.manifest)?,
        ),
        (
            PathBuf::from(&snapshot.manifest.files.rig),
            canonical_json(&snapshot.rig)?,
        ),
        (
            PathBuf::from(&snapshot.manifest.files.motions),
            canonical_json(&snapshot.motions)?,
        ),
        (
            PathBuf::from(&snapshot.manifest.files.editor),
            canonical_json(&snapshot.editor)?,
        ),
    ];
    if paths[0].exists() {
        let current = read_text(&paths[0], "verify_artwork")?;
        if current != snapshot.artwork {
            return Err(HostError::new(
                "artwork_read_only",
                "verify_artwork",
                Some(&paths[0]),
                "existing artwork differs from the snapshot and cannot be overwritten",
            ));
        }
    } else {
        writes.push((
            PathBuf::from(&snapshot.manifest.files.artwork),
            snapshot.artwork.as_bytes().to_vec(),
        ));
    }
    transactional_replace(&root, &writes, None)?;
    let reread = read_project(&root)?;
    let signature = document_signature(&reread)?;
    Ok(SaveResult {
        root: root.display().to_string(),
        signature,
    })
}

pub fn document_signature(snapshot: &ProjectSnapshot) -> HostResult<String> {
    let mut hasher = Sha256::new();
    hasher.update(canonical_json(&snapshot.rig)?);
    hasher.update(canonical_json(&snapshot.motions)?);
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

pub fn canonical_path_hash(path: &Path) -> HostResult<String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| io_error("canonicalize", path, error))?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

pub fn validate_snapshot(snapshot: &ProjectSnapshot) -> HostResult<()> {
    if snapshot.manifest.schema_version != 1 {
        return Err(HostError::new(
            "unsupported_schema",
            "validate",
            None,
            "manifest schemaVersion must be 1",
        ));
    }
    if snapshot.editor.schema_version != 1 {
        return Err(HostError::new(
            "unsupported_schema",
            "validate",
            None,
            "editor schemaVersion must be 1",
        ));
    }
    validate_document(&snapshot.manifest, &snapshot.rig, &snapshot.motions)
}

fn validate_document(manifest: &ProjectManifestV1, rig: &Value, motions: &Value) -> HostResult<()> {
    let rig_schema = rig.get("schemaVersion").and_then(Value::as_u64);
    let motion_schema = motions.get("schemaVersion").and_then(Value::as_u64);
    let rig_id = rig.get("rigId").and_then(Value::as_str);
    let motion_rig_id = motions.get("rigId").and_then(Value::as_str);
    if rig_schema != Some(1) || motion_schema != Some(1) {
        return Err(HostError::new(
            "unsupported_schema",
            "validate",
            None,
            "rig and motions schemaVersion must be 1",
        ));
    }
    if rig_id != Some(manifest.character_rig_id.as_str()) || motion_rig_id != rig_id {
        return Err(HostError::new(
            "rig_id_mismatch",
            "validate",
            None,
            "manifest, rig, and motions rigId must match",
        ));
    }
    if !rig.get("parts").is_some_and(Value::is_array)
        || !motions.get("clips").is_some_and(Value::is_array)
    {
        return Err(HostError::new(
            "invalid_document",
            "validate",
            None,
            "rig parts and motion clips must be arrays",
        ));
    }
    Ok(())
}

fn validate_manifest_paths(root: &Path, manifest: &ProjectManifestV1) -> HostResult<[PathBuf; 4]> {
    let names = [
        &manifest.files.artwork,
        &manifest.files.rig,
        &manifest.files.motions,
        &manifest.files.editor,
    ];
    let mut unique = HashSet::new();
    let mut paths = Vec::with_capacity(names.len());
    for name in names {
        let relative = Path::new(name);
        if name.is_empty()
            || relative.is_absolute()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(HostError::new(
                "invalid_project_path",
                "validate_manifest",
                Some(relative),
                "file references must be normalized relative paths",
            ));
        }
        let key = relative.to_string_lossy().to_lowercase();
        if !unique.insert(key) {
            return Err(HostError::new(
                "duplicate_project_path",
                "validate_manifest",
                Some(relative),
                "file references must be unique",
            ));
        }
        let candidate = root.join(relative);
        reject_symlink_chain(root, &candidate)?;
        paths.push(candidate);
    }
    paths.try_into().map_err(|_| {
        HostError::new(
            "invalid_manifest",
            "validate_manifest",
            None,
            "manifest file set is incomplete",
        )
    })
}

fn reject_symlink_chain(root: &Path, candidate: &Path) -> HostResult<()> {
    let relative = candidate.strip_prefix(root).map_err(|_| {
        HostError::new(
            "path_escape",
            "validate_path",
            Some(candidate),
            "path escapes project root",
        )
    })?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        if current.exists() {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| io_error("metadata", &current, error))?;
            if metadata.file_type().is_symlink() {
                return Err(HostError::new(
                    "symlink_not_allowed",
                    "validate_path",
                    Some(&current),
                    "project files cannot traverse symbolic links",
                ));
            }
        }
    }
    Ok(())
}

fn canonical_directory(path: &Path, stage: &str) -> HostResult<PathBuf> {
    let canonical = path
        .canonicalize()
        .map_err(|error| io_error(stage, path, error))?;
    if !canonical.is_dir() {
        return Err(HostError::new(
            "not_directory",
            stage,
            Some(path),
            "project root is not a directory",
        ));
    }
    Ok(canonical)
}

fn read_text(path: &Path, stage: &str) -> HostResult<String> {
    fs::read_to_string(path).map_err(|error| io_error(stage, path, error))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path, stage: &str) -> HostResult<T> {
    let bytes = fs::read(path).map_err(|error| io_error(stage, path, error))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| HostError::new("invalid_json", stage, Some(path), error.to_string()))
}

fn canonical_json<T: Serialize>(value: &T) -> HostResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        HostError::new("serialize_failed", "serialize", None, error.to_string())
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn io_error(stage: &str, path: &Path, error: std::io::Error) -> HostError {
    HostError::new("io_error", stage, Some(path), error.to_string())
}

pub(crate) fn transactional_replace(
    root: &Path,
    writes: &[(PathBuf, Vec<u8>)],
    fail_before_replace: Option<usize>,
) -> HostResult<()> {
    let id = Uuid::new_v4().to_string();
    let transaction = root.join(format!(".ltypet-txn-{id}"));
    let staged = transaction.join("staged");
    let backup = transaction.join("backup");
    fs::create_dir_all(&staged).map_err(|error| io_error("stage_create", &staged, error))?;
    fs::create_dir_all(&backup).map_err(|error| io_error("backup_create", &backup, error))?;

    for (relative, bytes) in writes {
        let path = staged.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error("stage_create", parent, error))?;
        }
        let mut file =
            File::create(&path).map_err(|error| io_error("stage_write", &path, error))?;
        file.write_all(bytes)
            .map_err(|error| io_error("stage_write", &path, error))?;
        file.sync_all()
            .map_err(|error| io_error("stage_flush", &path, error))?;
        let reread = fs::read(&path).map_err(|error| io_error("stage_verify", &path, error))?;
        if reread != *bytes {
            return Err(HostError::new(
                "stage_mismatch",
                "stage_verify",
                Some(&path),
                "staged bytes changed after write",
            ));
        }
    }

    let journal_path = transaction.join("journal.json");
    write_journal(&journal_path, writes, 0)?;
    let mut replaced = 0usize;
    for (index, (relative, _)) in writes.iter().enumerate() {
        if fail_before_replace == Some(index) {
            let original = HostError::new(
                "injected_replace_failure",
                "replace",
                Some(&root.join(relative)),
                "test-injected replace failure",
            );
            return rollback_or_preserve(root, &transaction, writes, replaced, original);
        }
        write_journal(&journal_path, writes, index + 1)?;
        let destination = root.join(relative);
        let backup_path = backup.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| io_error("replace_create", parent, error))?;
        }
        if destination.exists() {
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| io_error("backup_create", parent, error))?;
            }
            fs::copy(&destination, &backup_path)
                .map_err(|error| io_error("backup", &destination, error))?;
            OpenOptions::new()
                .write(true)
                .open(&backup_path)
                .and_then(|file| file.sync_all())
                .map_err(|error| io_error("backup_flush", &backup_path, error))?;
        }
        if let Err(error) = replace_file(&staged.join(relative), &destination) {
            let original = io_error("replace", &destination, error);
            return rollback_or_preserve(root, &transaction, writes, replaced + 1, original);
        }
        replaced += 1;
        write_journal(&journal_path, writes, replaced)?;
    }
    fs::remove_dir_all(&transaction).map_err(|error| io_error("cleanup", &transaction, error))?;
    Ok(())
}

fn write_journal(path: &Path, writes: &[(PathBuf, Vec<u8>)], replaced: usize) -> HostResult<()> {
    let files: Vec<String> = writes
        .iter()
        .map(|(path, _)| path.display().to_string())
        .collect();
    let bytes =
        canonical_json(&json!({ "schemaVersion": 1, "files": files, "replaced": replaced }))?;
    let mut file = File::create(path).map_err(|error| io_error("journal", path, error))?;
    file.write_all(&bytes)
        .map_err(|error| io_error("journal", path, error))?;
    file.sync_all()
        .map_err(|error| io_error("journal", path, error))
}

#[cfg(windows)]
fn replace_file(staged: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    if !destination.exists() {
        return fs::rename(staged, destination);
    }
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let staged_wide: Vec<u16> = staged
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            staged_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn rollback_or_preserve(
    root: &Path,
    transaction: &Path,
    writes: &[(PathBuf, Vec<u8>)],
    replaced: usize,
    original: HostError,
) -> HostResult<()> {
    match rollback(root, transaction, writes, replaced) {
        Ok(()) => {
            fs::remove_dir_all(transaction)
                .map_err(|error| io_error("cleanup", transaction, error))?;
            Err(original)
        }
        Err(error) => Err(HostError::new(
            "rollback_failed",
            "rollback",
            Some(transaction),
            format!("{}; rollback: {}", original.message, error.message),
        )),
    }
}

fn rollback(
    root: &Path,
    transaction: &Path,
    writes: &[(PathBuf, Vec<u8>)],
    replaced: usize,
) -> HostResult<()> {
    for (relative, _) in writes.iter().take(replaced).rev() {
        let destination = root.join(relative);
        let backup = transaction.join("backup").join(relative);
        if backup.exists() {
            if destination.exists() {
                fs::remove_file(&destination)
                    .map_err(|error| io_error("rollback_remove", &destination, error))?;
            }
            fs::rename(&backup, &destination)
                .map_err(|error| io_error("rollback_restore", &destination, error))?;
        } else if !transaction.join("staged").join(relative).exists() && destination.exists() {
            fs::remove_file(&destination)
                .map_err(|error| io_error("rollback_remove", &destination, error))?;
        }
    }
    Ok(())
}

pub fn recover_transactions(root: &Path) -> HostResult<()> {
    let entries = fs::read_dir(root).map_err(|error| io_error("recovery_scan", root, error))?;
    for entry in entries {
        let entry = entry.map_err(|error| io_error("recovery_scan", root, error))?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".ltypet-txn-")
        {
            continue;
        }
        let transaction = entry.path();
        let journal: Value = read_json(&transaction.join("journal.json"), "recovery_journal")?;
        let replaced = journal
            .get("replaced")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                HostError::new(
                    "invalid_journal",
                    "recovery_journal",
                    Some(&transaction),
                    "journal replaced count is missing",
                )
            })? as usize;
        let files = journal
            .get("files")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                HostError::new(
                    "invalid_journal",
                    "recovery_journal",
                    Some(&transaction),
                    "journal file list is missing",
                )
            })?;
        let writes: Vec<(PathBuf, Vec<u8>)> = files
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(|path| (PathBuf::from(path), Vec::new()))
                    .ok_or_else(|| {
                        HostError::new(
                            "invalid_journal",
                            "recovery_journal",
                            Some(&transaction),
                            "journal path is invalid",
                        )
                    })
            })
            .collect::<HostResult<_>>()?;
        rollback(root, &transaction, &writes, replaced)?;
        fs::remove_dir_all(&transaction)
            .map_err(|error| io_error("recovery_cleanup", &transaction, error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ProjectFiles, ProjectManifestV1};
    use tempfile::tempdir;

    fn snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            manifest: ProjectManifestV1 {
                schema_version: 1,
                project_id: "project-1".into(),
                display_name: "测试项目".into(),
                character_rig_id: "xiaoluobao".into(),
                files: ProjectFiles {
                    artwork: "artwork.svg".into(),
                    rig: "rig.v1.json".into(),
                    motions: "motions.v1.json".into(),
                    editor: "editor.json".into(),
                },
            },
            artwork: "<svg/>".into(),
            rig: json!({"schemaVersion": 1, "rigId": "xiaoluobao", "parts": []}),
            motions: json!({"schemaVersion": 1, "rigId": "xiaoluobao", "clips": []}),
            editor: EditorStateV1 {
                schema_version: 1,
                ..EditorStateV1::default()
            },
        }
    }

    #[test]
    fn save_read_and_editor_corruption_fallback() {
        let directory = tempdir().unwrap();
        let original = snapshot();
        save_project(directory.path(), &original, true).unwrap();
        fs::write(directory.path().join("editor.json"), b"broken").unwrap();
        let opened = read_project(directory.path()).unwrap();
        assert_eq!(opened.manifest, original.manifest);
        assert_eq!(opened.editor.schema_version, 1);
    }

    #[test]
    fn rejects_escape_absolute_and_duplicate_paths() {
        let directory = tempdir().unwrap();
        let mut candidate = snapshot();
        candidate.manifest.files.rig = "../rig.json".into();
        assert_eq!(
            save_project(directory.path(), &candidate, true)
                .unwrap_err()
                .code,
            "invalid_project_path"
        );
        candidate.manifest.files.rig = directory.path().join("rig.json").display().to_string();
        assert_eq!(
            save_project(directory.path(), &candidate, true)
                .unwrap_err()
                .code,
            "invalid_project_path"
        );
        candidate.manifest.files.rig = "motions.v1.json".into();
        assert_eq!(
            save_project(directory.path(), &candidate, true)
                .unwrap_err()
                .code,
            "duplicate_project_path"
        );
    }

    #[test]
    fn second_replace_failure_restores_previous_bytes() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("first"), b"old-first").unwrap();
        fs::write(directory.path().join("second"), b"old-second").unwrap();
        let writes = vec![
            (PathBuf::from("first"), b"new-first".to_vec()),
            (PathBuf::from("second"), b"new-second".to_vec()),
        ];
        let error = transactional_replace(directory.path(), &writes, Some(1)).unwrap_err();
        assert_eq!(error.code, "injected_replace_failure", "{error:?}");
        assert_eq!(
            fs::read(directory.path().join("first")).unwrap(),
            b"old-first"
        );
        assert_eq!(
            fs::read(directory.path().join("second")).unwrap(),
            b"old-second"
        );
    }
    #[test]
    fn startup_recovery_restores_interrupted_journal() {
        let directory = tempdir().unwrap();
        let transaction = directory.path().join(".ltypet-txn-interrupted");
        fs::create_dir_all(transaction.join("backup")).unwrap();
        fs::create_dir_all(transaction.join("staged")).unwrap();
        fs::write(directory.path().join("first"), b"new-first").unwrap();
        fs::write(transaction.join("backup").join("first"), b"old-first").unwrap();
        fs::write(transaction.join("staged").join("second"), b"new-second").unwrap();
        fs::write(
            transaction.join("journal.json"),
            br#"{
  "schemaVersion": 1,
  "files": ["first", "second"],
  "replaced": 1
}
"#,
        )
        .unwrap();

        recover_transactions(directory.path()).unwrap();
        assert_eq!(
            fs::read(directory.path().join("first")).unwrap(),
            b"old-first"
        );
        assert!(!transaction.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        symlink(outside.path(), directory.path().join("linked")).unwrap();
        let mut candidate = snapshot();
        candidate.manifest.files.rig = "linked/rig.json".into();
        assert_eq!(
            save_project(directory.path(), &candidate, true)
                .unwrap_err()
                .code,
            "symlink_not_allowed"
        );
    }
}
