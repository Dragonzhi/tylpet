import { invoke } from "@tauri-apps/api/core";

/**
 * API key 安全存储接口。
 *
 * API key 不进入普通设置 JSON，使用独立的存储机制。
 * 当前实现使用与 settings 相同的 app data 目录下的独立文件，
 * 未来可升级为 OS keychain（Windows Credential Manager）。
 *
 * 前端只通过此接口访问 key，不直接处理文件。
 */

interface KeyStoreData {
  [provider: string]: string;
}

/**
 * 读取 API key。
 *
 * @param provider - 供应商标识，如 "openai"、"deepseek"
 * @returns key 字符串，或 null（不存在或读取失败）
 */
export async function getApiKey(provider: string): Promise<string | null> {
  try {
    const json = await invoke<string | null>("load_secrets");
    if (!json) return null;
    const data = JSON.parse(json) as KeyStoreData;
    const key = data[provider];
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

/**
 * 保存 API key。
 *
 * @param provider - 供应商标识
 * @param key - API key 字符串
 */
export async function setApiKey(
  provider: string,
  key: string,
): Promise<void> {
  try {
    const json = await invoke<string | null>("load_secrets");
    const data: KeyStoreData = json ? JSON.parse(json) : {};
    data[provider] = key;
    await invoke("save_secrets", { json: JSON.stringify(data, null, 2) });
  } catch (error) {
    console.error(`保存 ${provider} API key 失败:`, error);
  }
}

/**
 * 删除 API key。
 *
 * @param provider - 供应商标识
 */
export async function deleteApiKey(provider: string): Promise<void> {
  try {
    const json = await invoke<string | null>("load_secrets");
    if (!json) return;
    const data = JSON.parse(json) as KeyStoreData;
    delete data[provider];
    await invoke("save_secrets", { json: JSON.stringify(data, null, 2) });
  } catch (error) {
    console.error(`删除 ${provider} API key 失败:`, error);
  }
}
