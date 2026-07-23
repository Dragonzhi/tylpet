use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};

const REGISTRY_SCHEMA_VERSION: u32 = 1;
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const BRIDGE_PROTOCOL_VERSION: u32 = 1;
const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SETTINGS_SCHEMA_BYTES: usize = 16 * 1024;
const MAX_BRIDGE_REQUEST_BYTES: u64 = 8 * 1024;
const MAX_EVENTS_PER_MINUTE: usize = 20;
const PLUGINS_CHANGED_EVENT: &str = "plugins-changed";
const PLUGIN_OBSERVATION_EVENT: &str = "plugin-observation-event";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub host_compatibility: String,
    pub entry: PluginEntry,
    pub permissions: PluginPermissions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_schema: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginEntry {
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPermissions {
    pub observation_events: Vec<String>,
    pub max_sensitivity: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInspection {
    pub inspection_token: String,
    pub manifest: PluginManifest,
    pub permission_changes: Vec<String>,
    pub replaces_existing: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub observation_events: Vec<String>,
    pub max_sensitivity: String,
    pub credential_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryFile {
    schema_version: u32,
    plugins: BTreeMap<String, RegistryPlugin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryPlugin {
    manifest: PluginManifest,
    enabled: bool,
    token: String,
}

#[derive(Clone)]
struct PendingInspection {
    manifest: PluginManifest,
}

struct PluginRegistry {
    root: PathBuf,
    file: PathBuf,
    bridge_address: SocketAddr,
    data: Mutex<RegistryFile>,
    pending: Mutex<HashMap<String, PendingInspection>>,
    recent_events: Mutex<HashMap<String, VecDeque<Instant>>>,
}

pub struct PluginHost {
    registry: Arc<PluginRegistry>,
    app: AppHandle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeRequest {
    protocol_version: u32,
    plugin_id: String,
    token: String,
    event: BridgeEvent,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeEvent {
    #[serde(rename = "type")]
    event_type: String,
    sensitivity: String,
    payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    correlation_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeCredential {
    schema_version: u32,
    plugin_id: String,
    token: String,
    address: String,
}

impl PluginHost {
    pub fn load(app: AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("plugins");
        fs::create_dir_all(&root).map_err(|error| format!("创建插件目录失败：{error}"))?;
        let file = root.join("registry.v1.json");
        let data = load_registry(&file)?;
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|error| format!("启动本机插件桥接失败：{error}"))?;
        let bridge_address = listener.local_addr().map_err(|error| error.to_string())?;
        let registry = Arc::new(PluginRegistry {
            root,
            file,
            bridge_address,
            data: Mutex::new(data),
            pending: Mutex::new(HashMap::new()),
            recent_events: Mutex::new(HashMap::new()),
        });
        rewrite_credentials(&registry)?;
        start_bridge(listener, registry.clone(), app.clone());
        Ok(Self { registry, app })
    }

    fn inspect_manifest(&self, path: &Path) -> Result<ManifestInspection, String> {
        let manifest = read_manifest(path)?;
        let token = random_hex(16)?;
        let data = lock(&self.registry.data)?;
        let existing = data.plugins.get(&manifest.id);
        let permission_changes = permission_changes(existing, &manifest);
        let replaces_existing = existing.is_some();
        drop(data);
        let mut pending = lock(&self.registry.pending)?;
        if pending.len() >= 32 {
            pending.clear();
        }
        pending.insert(
            token.clone(),
            PendingInspection {
                manifest: manifest.clone(),
            },
        );
        Ok(ManifestInspection {
            inspection_token: token,
            manifest,
            permission_changes,
            replaces_existing,
        })
    }

    fn install_inspected(&self, inspection_token: &str) -> Result<InstalledPlugin, String> {
        let pending = lock(&self.registry.pending)?
            .remove(inspection_token)
            .ok_or_else(|| "安装确认已失效，请重新检查 manifest".to_string())?;
        validate_manifest(&pending.manifest)?;
        let mut data = lock(&self.registry.data)?;
        let token = if let Some(plugin) = data.plugins.get(&pending.manifest.id) {
            plugin.token.clone()
        } else {
            random_hex(32)?
        };
        let enabled = data
            .plugins
            .get(&pending.manifest.id)
            .map(|plugin| plugin.enabled)
            .unwrap_or(true);
        let id = pending.manifest.id.clone();
        data.plugins.insert(
            id.clone(),
            RegistryPlugin {
                manifest: pending.manifest,
                enabled,
                token,
            },
        );
        save_registry(&self.registry.file, &data)?;
        let installed = public_plugin(&self.registry, data.plugins.get(&id).expect("inserted"));
        write_credential(&self.registry, data.plugins.get(&id).expect("inserted"))?;
        let list = public_plugins(&self.registry, &data);
        drop(data);
        emit_plugin_change(&self.app, &list);
        Ok(installed)
    }

    fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<Vec<InstalledPlugin>, String> {
        validate_plugin_id(plugin_id)?;
        let mut data = lock(&self.registry.data)?;
        let plugin = data
            .plugins
            .get_mut(plugin_id)
            .ok_or_else(|| "插件不存在".to_string())?;
        if enabled {
            validate_manifest(&plugin.manifest)?;
        }
        plugin.enabled = enabled;
        save_registry(&self.registry.file, &data)?;
        let list = public_plugins(&self.registry, &data);
        drop(data);
        if !enabled {
            lock(&self.registry.recent_events)?.remove(plugin_id);
        }
        emit_plugin_change(&self.app, &list);
        Ok(list)
    }

    fn uninstall(&self, plugin_id: &str) -> Result<Vec<InstalledPlugin>, String> {
        validate_plugin_id(plugin_id)?;
        let mut data = lock(&self.registry.data)?;
        if data.plugins.remove(plugin_id).is_none() {
            return Err("插件不存在".to_string());
        }
        save_registry(&self.registry.file, &data)?;
        let list = public_plugins(&self.registry, &data);
        drop(data);
        lock(&self.registry.recent_events)?.remove(plugin_id);
        let plugin_dir = self.registry.root.join(plugin_id);
        if plugin_dir.starts_with(&self.registry.root) && plugin_dir.exists() {
            fs::remove_dir_all(&plugin_dir)
                .map_err(|error| format!("删除插件凭据目录失败：{error}"))?;
        }
        emit_plugin_change(&self.app, &list);
        Ok(list)
    }

    fn list(&self) -> Result<Vec<InstalledPlugin>, String> {
        let data = lock(&self.registry.data)?;
        Ok(public_plugins(&self.registry, &data))
    }
}

#[tauri::command]
pub fn plugin_inspect_manifest(
    host: State<'_, PluginHost>,
    path: String,
) -> Result<ManifestInspection, String> {
    host.inspect_manifest(Path::new(&path))
}

#[tauri::command]
pub fn plugin_install_inspected(
    host: State<'_, PluginHost>,
    inspection_token: String,
) -> Result<InstalledPlugin, String> {
    host.install_inspected(&inspection_token)
}

#[tauri::command]
pub fn plugin_list(host: State<'_, PluginHost>) -> Result<Vec<InstalledPlugin>, String> {
    host.list()
}

#[tauri::command]
pub fn plugin_set_enabled(
    host: State<'_, PluginHost>,
    plugin_id: String,
    enabled: bool,
) -> Result<Vec<InstalledPlugin>, String> {
    host.set_enabled(&plugin_id, enabled)
}

#[tauri::command]
pub fn plugin_uninstall(
    host: State<'_, PluginHost>,
    plugin_id: String,
) -> Result<Vec<InstalledPlugin>, String> {
    host.uninstall(&plugin_id)
}

fn start_bridge(listener: TcpListener, registry: Arc<PluginRegistry>, app: AppHandle) {
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(stream) = connection else {
                continue;
            };
            let registry = registry.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(error) = handle_connection(stream, &registry, &app) {
                    eprintln!("插件桥接请求被拒绝：{error}");
                }
            });
        }
    });
}

fn handle_connection(
    mut stream: TcpStream,
    registry: &PluginRegistry,
    app: &AppHandle,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut stream)
        .take(MAX_BRIDGE_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取插件请求失败：{error}"))?;
    let result = (|| -> Result<(), String> {
        if bytes.len() as u64 > MAX_BRIDGE_REQUEST_BYTES {
            return Err("插件请求超过 8 KiB".to_string());
        }
        let request: BridgeRequest =
            serde_json::from_slice(&bytes).map_err(|_| "插件请求不是合法的 v1 JSON".to_string())?;
        authorize_bridge_request(registry, &request)?;
        let event_id = format!("plugin-{}-{}", now_unix_ms(), random_hex(8)?);
        let mut event = json!({
            "protocolVersion": 1,
            "id": event_id,
            "source": { "kind": "plugin", "id": request.plugin_id },
            "type": request.event.event_type,
            "observedAt": now_unix_ms(),
            "sensitivity": request.event.sensitivity,
            "payload": request.event.payload,
        });
        if let Some(correlation_id) = request.event.correlation_id {
            event["correlationId"] = Value::String(correlation_id);
        }
        app.emit_to("main", PLUGIN_OBSERVATION_EVENT, event)
            .map_err(|error| format!("提交插件观察事件失败：{error}"))?;
        Ok(())
    })();
    let response = match &result {
        Ok(()) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    let mut encoded = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .map_err(|error| format!("写入插件响应失败：{error}"))?;
    result
}

fn authorize_bridge_request(
    registry: &PluginRegistry,
    request: &BridgeRequest,
) -> Result<(), String> {
    if request.protocol_version != BRIDGE_PROTOCOL_VERSION {
        return Err("不支持的插件桥接协议版本".to_string());
    }
    validate_plugin_id(&request.plugin_id)?;
    if request
        .event
        .correlation_id
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 128)
    {
        return Err("correlationId 必须是 1 到 128 字符".to_string());
    }
    if !request.event.payload.is_object() {
        return Err("插件事件 payload 必须是对象".to_string());
    }
    validate_event_payload(&request.event)?;
    let data = lock(&registry.data)?;
    let plugin = data
        .plugins
        .get(&request.plugin_id)
        .ok_or_else(|| "插件未安装".to_string())?;
    if !plugin.enabled {
        return Err("插件已禁用".to_string());
    }
    if !constant_time_eq(plugin.token.as_bytes(), request.token.as_bytes()) {
        return Err("插件凭据无效".to_string());
    }
    if !plugin
        .manifest
        .permissions
        .observation_events
        .contains(&request.event.event_type)
    {
        return Err("插件未声明该事件类型".to_string());
    }
    if sensitivity_rank(&request.event.sensitivity)?
        > sensitivity_rank(&plugin.manifest.permissions.max_sensitivity)?
    {
        return Err("插件事件超过已授权敏感级别".to_string());
    }
    drop(data);

    let mut recent = lock(&registry.recent_events)?;
    let events = recent.entry(request.plugin_id.clone()).or_default();
    let now = Instant::now();
    while events
        .front()
        .is_some_and(|timestamp| now.duration_since(*timestamp) >= Duration::from_secs(60))
    {
        events.pop_front();
    }
    if events.len() >= MAX_EVENTS_PER_MINUTE {
        return Err("插件超过每分钟事件预算".to_string());
    }
    events.push_back(now);
    Ok(())
}

fn read_manifest(path: &Path) -> Result<PluginManifest, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取 manifest 失败：{error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err("manifest 必须是小于 64 KiB 的文件".to_string());
    }
    let content = fs::read(path).map_err(|error| format!("读取 manifest 失败：{error}"))?;
    let manifest: PluginManifest = serde_json::from_slice(&content)
        .map_err(|error| format!("manifest 不是合法的严格 JSON：{error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    validate_manifest_structure(manifest)?;
    if !host_version_matches(&manifest.host_compatibility)? {
        return Err(format!("插件不兼容当前宿主版本 {HOST_VERSION}"));
    }
    Ok(())
}

fn validate_manifest_structure(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err("只支持 ltypet.plugin.json schemaVersion 1".to_string());
    }
    validate_plugin_id(&manifest.id)?;
    if manifest.name.trim().is_empty() || manifest.name.len() > 80 {
        return Err("插件名称必须是 1 到 80 字符".to_string());
    }
    parse_version(&manifest.version)?;
    host_version_matches(&manifest.host_compatibility)?;
    if manifest.entry.entry_type != "observation-source" {
        return Err("首版只允许 observation-source 声明式入口".to_string());
    }
    if manifest.permissions.observation_events.is_empty()
        || manifest.permissions.observation_events.len() > 8
    {
        return Err("插件必须声明 1 到 8 个观察事件类型".to_string());
    }
    let mut unique = Vec::new();
    for event_type in &manifest.permissions.observation_events {
        if event_type != "dev-agent.status" && event_type != "media.playback" {
            return Err(format!("宿主不支持插件事件类型：{event_type}"));
        }
        if unique.contains(event_type) {
            return Err(format!("插件重复声明事件类型：{event_type}"));
        }
        unique.push(event_type.clone());
    }
    sensitivity_rank(&manifest.permissions.max_sensitivity)?;
    if let Some(schema) = &manifest.settings_schema {
        if !schema.is_object() {
            return Err("settingsSchema 必须是 JSON 对象".to_string());
        }
        let size = serde_json::to_vec(schema)
            .map_err(|error| error.to_string())?
            .len();
        if size > MAX_SETTINGS_SCHEMA_BYTES {
            return Err("settingsSchema 不能超过 16 KiB".to_string());
        }
    }
    Ok(())
}

fn validate_event_payload(event: &BridgeEvent) -> Result<(), String> {
    let payload = event
        .payload
        .as_object()
        .ok_or_else(|| "插件事件 payload 必须是对象".to_string())?;
    if payload.len() != 1 {
        return Err("v1 payload 只能包含 state".to_string());
    }
    let state = payload
        .get("state")
        .and_then(Value::as_str)
        .ok_or_else(|| "v1 payload.state 必须是字符串".to_string())?;
    validate_cli_state(&event.event_type, state)
}

fn validate_plugin_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && (byte == b'-' || byte == b'.' || byte == b'_'))
        });
    if valid {
        Ok(())
    } else {
        Err("插件 ID 必须是稳定的小写标识且不超过 64 字符".to_string())
    }
}

fn parse_version(value: &str) -> Result<(u32, u32, u32), String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return Err("版本必须使用 x.y.z 格式".to_string());
    }
    let parse = |part: &str| {
        part.parse::<u32>()
            .map_err(|_| "版本必须使用非负整数 x.y.z 格式".to_string())
    };
    Ok((parse(parts[0])?, parse(parts[1])?, parse(parts[2])?))
}

fn host_version_matches(requirement: &str) -> Result<bool, String> {
    let host = parse_version(HOST_VERSION)?;
    let mut lower = None;
    let mut upper = None;
    for token in requirement
        .split(|character: char| character.is_whitespace() || character == ',')
        .filter(|token| !token.is_empty())
    {
        if let Some(value) = token.strip_prefix(">=") {
            lower = Some(parse_version(value)?);
        } else if let Some(value) = token.strip_prefix('<') {
            upper = Some(parse_version(value)?);
        } else {
            return Err("hostCompatibility 只支持 >=x.y.z <x.y.z".to_string());
        }
    }
    let lower = lower.ok_or_else(|| "hostCompatibility 缺少最低版本".to_string())?;
    let upper = upper.ok_or_else(|| "hostCompatibility 缺少最高版本".to_string())?;
    Ok(host >= lower && host < upper)
}

fn sensitivity_rank(value: &str) -> Result<u8, String> {
    match value {
        "status" => Ok(0),
        "metadata" => Ok(1),
        "content" => Ok(2),
        _ => Err("敏感级别必须是 status、metadata 或 content".to_string()),
    }
}

fn permission_changes(existing: Option<&RegistryPlugin>, manifest: &PluginManifest) -> Vec<String> {
    let mut changes = manifest
        .permissions
        .observation_events
        .iter()
        .filter(|event_type| {
            existing.is_none_or(|plugin| {
                !plugin
                    .manifest
                    .permissions
                    .observation_events
                    .contains(event_type)
            })
        })
        .map(|event_type| format!("新增观察事件：{event_type}"))
        .collect::<Vec<_>>();
    let previous_rank = existing
        .and_then(|plugin| sensitivity_rank(&plugin.manifest.permissions.max_sensitivity).ok())
        .unwrap_or(0);
    if sensitivity_rank(&manifest.permissions.max_sensitivity).unwrap_or(0) > previous_rank {
        changes.push(format!(
            "提高敏感级别：{}",
            manifest.permissions.max_sensitivity
        ));
    }
    if changes.is_empty() {
        changes.push("权限没有扩大".to_string());
    }
    changes
}

fn load_registry(path: &Path) -> Result<RegistryFile, String> {
    if !path.exists() {
        return Ok(empty_registry());
    }
    let content = fs::read(path).map_err(|error| format!("读取插件注册表失败：{error}"))?;
    let mut parsed: RegistryFile = match serde_json::from_slice(&content) {
        Ok(value) => value,
        Err(error) => {
            let corrupt = path.with_extension("json.corrupt");
            let _ = fs::rename(path, corrupt);
            eprintln!("插件注册表损坏，已隔离并使用空注册表：{error}");
            return Ok(empty_registry());
        }
    };
    let compatibility_changed = match normalize_registry(&mut parsed) {
        Ok(changed) => changed,
        Err(error) => {
            let corrupt = path.with_extension("json.corrupt");
            let _ = fs::remove_file(&corrupt);
            let _ = fs::rename(path, corrupt);
            eprintln!("插件注册表内容损坏，已隔离并使用空注册表：{error}");
            return Ok(empty_registry());
        }
    };
    if compatibility_changed {
        if let Err(error) = save_registry(path, &parsed) {
            eprintln!("保存自动禁用的插件状态失败：{error}");
        }
    }
    Ok(parsed)
}

fn normalize_registry(parsed: &mut RegistryFile) -> Result<bool, String> {
    if parsed.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err("插件注册表版本不兼容".to_string());
    }
    let mut compatibility_changed = false;
    for (id, plugin) in &mut parsed.plugins {
        if id != &plugin.manifest.id || plugin.token.len() != 64 {
            return Err("插件注册表身份信息损坏".to_string());
        }
        validate_manifest_structure(&plugin.manifest)?;
        if !host_version_matches(&plugin.manifest.host_compatibility)? && plugin.enabled {
            plugin.enabled = false;
            compatibility_changed = true;
            eprintln!("插件 {id} 与当前宿主版本不兼容，已自动禁用");
        }
    }
    Ok(compatibility_changed)
}

fn empty_registry() -> RegistryFile {
    RegistryFile {
        schema_version: REGISTRY_SCHEMA_VERSION,
        plugins: BTreeMap::new(),
    }
}

fn save_registry(path: &Path, data: &RegistryFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    fs::write(&temp, bytes).map_err(|error| format!("写入插件注册表失败：{error}"))?;
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    if path.exists() {
        fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, path).map_err(|error| {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        error.to_string()
    })
}

fn rewrite_credentials(registry: &PluginRegistry) -> Result<(), String> {
    let data = lock(&registry.data)?;
    for plugin in data.plugins.values() {
        write_credential(registry, plugin)?;
    }
    Ok(())
}

fn write_credential(registry: &PluginRegistry, plugin: &RegistryPlugin) -> Result<(), String> {
    let directory = registry.root.join(&plugin.manifest.id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("credential.v1.json");
    let credential = BridgeCredential {
        schema_version: 1,
        plugin_id: plugin.manifest.id.clone(),
        token: plugin.token.clone(),
        address: registry.bridge_address.to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&credential).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| format!("写入插件凭据失败：{error}"))
}

fn credential_path(registry: &PluginRegistry, plugin_id: &str) -> String {
    registry
        .root
        .join(plugin_id)
        .join("credential.v1.json")
        .to_string_lossy()
        .into_owned()
}

fn public_plugin(registry: &PluginRegistry, plugin: &RegistryPlugin) -> InstalledPlugin {
    InstalledPlugin {
        id: plugin.manifest.id.clone(),
        name: plugin.manifest.name.clone(),
        version: plugin.manifest.version.clone(),
        enabled: plugin.enabled,
        observation_events: plugin.manifest.permissions.observation_events.clone(),
        max_sensitivity: plugin.manifest.permissions.max_sensitivity.clone(),
        credential_path: credential_path(registry, &plugin.manifest.id),
    }
}

fn public_plugins(registry: &PluginRegistry, data: &RegistryFile) -> Vec<InstalledPlugin> {
    data.plugins
        .values()
        .map(|plugin| public_plugin(registry, plugin))
        .collect()
}

fn emit_plugin_change(app: &AppHandle, plugins: &[InstalledPlugin]) {
    let _ = app.emit_to("main", PLUGINS_CHANGED_EVENT, plugins);
    let _ = app.emit_to("settings", PLUGINS_CHANGED_EVENT, plugins);
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|_| "插件状态锁已损坏".to_string())
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; byte_count];
    let status = unsafe { BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status.0 < 0 {
        return Err(format!("生成插件随机凭据失败：0x{:08x}", status.0 as u32));
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn run_emit_cli(arguments: impl IntoIterator<Item = String>) -> Option<i32> {
    let mut arguments = arguments.into_iter();
    let _program = arguments.next();
    if arguments.next().as_deref() != Some("emit") {
        return None;
    }
    let result = emit_from_cli(arguments.collect());
    match result {
        Ok(response) => {
            println!("{response}");
            Some(0)
        }
        Err(error) => {
            eprintln!("ltypet emit 失败：{error}");
            Some(2)
        }
    }
}

fn emit_from_cli(arguments: Vec<String>) -> Result<String, String> {
    let mut values = HashMap::new();
    let mut index = 0;
    while index < arguments.len() {
        let key = arguments[index].clone();
        if !key.starts_with("--") || index + 1 >= arguments.len() {
            return Err("用法：ltypet emit --credential <path> --type <event> --state <state> [--correlation-id <id>]".to_string());
        }
        if values.insert(key, arguments[index + 1].clone()).is_some() {
            return Err("CLI 参数不能重复".to_string());
        }
        index += 2;
    }
    let credential_path = values
        .remove("--credential")
        .ok_or_else(|| "缺少 --credential".to_string())?;
    let event_type = values
        .remove("--type")
        .ok_or_else(|| "缺少 --type".to_string())?;
    let state = values
        .remove("--state")
        .ok_or_else(|| "缺少 --state".to_string())?;
    let correlation_id = values.remove("--correlation-id");
    if !values.is_empty() {
        return Err("包含未知 CLI 参数".to_string());
    }
    validate_cli_state(&event_type, &state)?;
    let credential_bytes =
        fs::read(&credential_path).map_err(|error| format!("读取凭据失败：{error}"))?;
    if credential_bytes.len() > 4 * 1024 {
        return Err("凭据文件过大".to_string());
    }
    let credential: BridgeCredential =
        serde_json::from_slice(&credential_bytes).map_err(|_| "凭据文件损坏".to_string())?;
    if credential.schema_version != 1 {
        return Err("凭据版本不兼容".to_string());
    }
    let address: SocketAddr = credential
        .address
        .parse()
        .map_err(|_| "凭据中的桥接地址无效".to_string())?;
    if !address.ip().is_loopback() {
        return Err("插件桥接地址不是本机回环地址".to_string());
    }
    let request = json!({
        "protocolVersion": 1,
        "pluginId": credential.plugin_id,
        "token": credential.token,
        "event": {
            "type": event_type,
            "sensitivity": "status",
            "payload": { "state": state },
            "correlationId": correlation_id,
        }
    });
    let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| format!("连接桌宠失败，请确认主程序正在运行：{error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&bytes)
        .map_err(|error| format!("发送事件失败：{error}"))?;
    stream
        .shutdown(Shutdown::Write)
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .take(4 * 1024)
        .read_to_string(&mut response)
        .map_err(|error| format!("读取桌宠响应失败：{error}"))?;
    let parsed: Value =
        serde_json::from_str(response.trim()).map_err(|_| "桌宠返回了无效响应".to_string())?;
    if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok("事件已提交".to_string())
    } else {
        Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("桌宠拒绝了事件")
            .to_string())
    }
}

fn validate_cli_state(event_type: &str, state: &str) -> Result<(), String> {
    let valid = match event_type {
        "dev-agent.status" => matches!(
            state,
            "session_started" | "working" | "waiting_for_user" | "completed" | "failed" | "stopped"
        ),
        "media.playback" => matches!(state, "playing" | "paused" | "stopped"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("事件类型或 state 不在 v1 白名单中".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_bridge_request, constant_time_eq, host_version_matches, validate_cli_state,
        validate_event_payload, validate_manifest, BridgeEvent, BridgeRequest, PluginEntry,
        PluginManifest, PluginPermissions, PluginRegistry, RegistryFile, RegistryPlugin,
        BRIDGE_PROTOCOL_VERSION, MAX_EVENTS_PER_MINUTE,
    };
    use serde_json::json;
    use std::collections::{BTreeMap, HashMap};
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
    use std::path::PathBuf;
    use std::sync::Mutex;

    fn manifest() -> PluginManifest {
        PluginManifest {
            schema_version: 1,
            id: "dev-agent-hooks".to_string(),
            name: "开发 Agent 状态桥".to_string(),
            version: "0.1.0".to_string(),
            host_compatibility: ">=0.1.0 <0.2.0".to_string(),
            entry: PluginEntry {
                entry_type: "observation-source".to_string(),
            },
            permissions: PluginPermissions {
                observation_events: vec!["dev-agent.status".to_string()],
                max_sensitivity: "status".to_string(),
            },
            settings_schema: None,
        }
    }

    #[test]
    fn validates_safe_manifest_and_host_range() {
        assert!(validate_manifest(&manifest()).is_ok());
        assert!(host_version_matches(">=0.1.0 <0.2.0").unwrap());
        assert!(!host_version_matches(">=1.0.0 <2.0.0").unwrap());
    }

    #[test]
    fn rejects_executable_entry_and_unknown_event() {
        let mut value = manifest();
        value.entry.entry_type = "javascript".to_string();
        assert!(validate_manifest(&value).is_err());
        value.entry.entry_type = "observation-source".to_string();
        value.permissions.observation_events = vec!["shell.output".to_string()];
        assert!(validate_manifest(&value).is_err());
    }

    #[test]
    fn validates_cli_lifecycle_states() {
        assert!(validate_cli_state("dev-agent.status", "completed").is_ok());
        assert!(validate_cli_state("dev-agent.status", "tool_arguments").is_err());
        assert!(validate_cli_state("media.playback", "playing").is_ok());
    }

    #[test]
    fn validates_bridge_payload_as_status_only_schema() {
        let valid = BridgeEvent {
            event_type: "dev-agent.status".to_string(),
            sensitivity: "status".to_string(),
            payload: json!({ "state": "waiting_for_user" }),
            correlation_id: None,
        };
        assert!(validate_event_payload(&valid).is_ok());

        let mut invalid = valid;
        invalid.payload = json!({ "state": "working", "prompt": "secret" });
        assert!(validate_event_payload(&invalid).is_err());
        invalid.payload = json!({ "state": "tool_arguments" });
        assert!(validate_event_payload(&invalid).is_err());
    }

    #[test]
    fn compares_credentials_without_early_byte_exit() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"samf"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn authenticates_and_rate_limits_plugin_events() {
        let host_registry = registry(true);
        let valid = request("secret", "dev-agent.status", "working");
        for _ in 0..MAX_EVENTS_PER_MINUTE {
            assert!(authorize_bridge_request(&host_registry, &valid).is_ok());
        }
        assert!(authorize_bridge_request(&host_registry, &valid)
            .unwrap_err()
            .contains("每分钟"));

        let host_registry = registry(true);
        assert!(authorize_bridge_request(
            &host_registry,
            &request("wrong", "dev-agent.status", "working"),
        )
        .unwrap_err()
        .contains("凭据"));
        assert!(authorize_bridge_request(
            &host_registry,
            &request("secret", "media.playback", "playing"),
        )
        .unwrap_err()
        .contains("未声明"));
    }

    #[test]
    fn disabled_plugin_identity_is_revoked() {
        let host_registry = registry(false);
        assert!(authorize_bridge_request(
            &host_registry,
            &request("secret", "dev-agent.status", "completed"),
        )
        .unwrap_err()
        .contains("已禁用"));
    }

    fn registry(enabled: bool) -> PluginRegistry {
        let manifest = manifest();
        let mut plugins = BTreeMap::new();
        plugins.insert(
            manifest.id.clone(),
            RegistryPlugin {
                manifest,
                enabled,
                token: "secret".to_string(),
            },
        );
        PluginRegistry {
            root: PathBuf::new(),
            file: PathBuf::new(),
            bridge_address: SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 1)),
            data: Mutex::new(RegistryFile {
                schema_version: 1,
                plugins,
            }),
            pending: Mutex::new(HashMap::new()),
            recent_events: Mutex::new(HashMap::new()),
        }
    }

    fn request(token: &str, event_type: &str, state: &str) -> BridgeRequest {
        BridgeRequest {
            protocol_version: BRIDGE_PROTOCOL_VERSION,
            plugin_id: "dev-agent-hooks".to_string(),
            token: token.to_string(),
            event: BridgeEvent {
                event_type: event_type.to_string(),
                sensitivity: "status".to_string(),
                payload: json!({ "state": state }),
                correlation_id: None,
            },
        }
    }
}
