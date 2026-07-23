use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const MEMORY_SCHEMA_VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 100;
const MAX_ENTRY_CHARS: usize = 300;
const MAX_RECENT_INTERACTIONS: usize = 50;
const MAX_BOND_EVENTS: usize = 50;
const DAILY_BOND_LIMIT: u32 = 3;
const MAX_BOND_POINTS: u32 = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    id: String,
    category: String,
    content: String,
    source: String,
    reason: String,
    created_at_ms: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BondEvent {
    id: String,
    delta: u32,
    reason: String,
    occurred_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BondState {
    points: u32,
    daily_date: String,
    daily_awards: u32,
    recent_interaction_ids: Vec<String>,
    events: Vec<BondEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    schema_version: u32,
    entries: Vec<MemoryEntry>,
    bond: BondState,
    updated_at_ms: u64,
}

impl Default for MemorySnapshot {
    fn default() -> Self {
        Self {
            schema_version: MEMORY_SCHEMA_VERSION,
            entries: Vec::new(),
            bond: BondState {
                points: 0,
                daily_date: String::new(),
                daily_awards: 0,
                recent_interaction_ids: Vec::new(),
                events: Vec::new(),
            },
            updated_at_ms: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryLoadResponse {
    snapshot: MemorySnapshot,
    recovery: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BondAwardResponse {
    snapshot: MemorySnapshot,
    awarded: u32,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMemoryRequest {
    id: String,
    category: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryRequest {
    id: String,
    category: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptMemoryProposalRequest {
    id: String,
    category: String,
    content: String,
    reason: String,
    acceptance: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInteractionRequest {
    interaction_id: String,
    occurred_at_ms: u64,
    local_date: String,
}

pub struct MemoryManager {
    path: PathBuf,
    snapshot: Mutex<MemorySnapshot>,
    recovery: Mutex<String>,
}

impl MemoryManager {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("memory.v1.json");
        let (snapshot, recovery) = load_with_recovery(&path);
        Ok(Self {
            path,
            snapshot: Mutex::new(snapshot),
            recovery: Mutex::new(recovery),
        })
    }

    fn mutate<T>(
        &self,
        update: impl FnOnce(&mut MemorySnapshot) -> Result<T, String>,
    ) -> Result<(T, MemorySnapshot), String> {
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "记忆存储锁已损坏".to_string())?;
        let result = update(&mut snapshot)?;
        snapshot.updated_at_ms = now_ms();
        validate_snapshot(&snapshot)?;
        persist_snapshot(&self.path, &snapshot)?;
        Ok((result, snapshot.clone()))
    }
}

#[tauri::command]
pub fn memory_get_snapshot(
    manager: State<'_, MemoryManager>,
) -> Result<MemoryLoadResponse, String> {
    let snapshot = manager
        .snapshot
        .lock()
        .map_err(|_| "记忆存储锁已损坏".to_string())?
        .clone();
    let mut recovery = manager
        .recovery
        .lock()
        .map_err(|_| "记忆恢复状态锁已损坏".to_string())?;
    let response = MemoryLoadResponse {
        snapshot,
        recovery: recovery.clone(),
    };
    *recovery = "none".to_string();
    Ok(response)
}

#[tauri::command]
pub fn memory_add_entry(
    app: AppHandle,
    request: AddMemoryRequest,
    manager: State<'_, MemoryManager>,
) -> Result<MemorySnapshot, String> {
    let (_, snapshot) = manager.mutate(|snapshot| {
        if snapshot.entries.len() >= MAX_ENTRIES {
            return Err(format!("记忆数量不能超过 {MAX_ENTRIES} 条"));
        }
        validate_id(&request.id)?;
        if snapshot.entries.iter().any(|entry| entry.id == request.id) {
            return Err("记忆 ID 已存在".to_string());
        }
        let category = validate_category(&request.category)?;
        let content = validate_content(&request.content)?;
        if snapshot
            .entries
            .iter()
            .any(|entry| entry.category == category && entry.content == content)
        {
            return Err("同一条记忆已经存在".to_string());
        }
        let now = now_ms();
        snapshot.entries.push(MemoryEntry {
            id: request.id,
            category,
            content,
            source: "user_saved".to_string(),
            reason: "用户在设置中明确保存".to_string(),
            created_at_ms: now,
            updated_at_ms: now,
        });
        Ok(())
    })?;
    emit_changed(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn memory_accept_proposal(
    app: AppHandle,
    request: AcceptMemoryProposalRequest,
    manager: State<'_, MemoryManager>,
) -> Result<MemorySnapshot, String> {
    let (_, snapshot) = manager.mutate(|snapshot| {
        if snapshot.entries.len() >= MAX_ENTRIES {
            return Err(format!("记忆数量不能超过 {MAX_ENTRIES} 条"));
        }
        validate_id(&request.id)?;
        if snapshot.entries.iter().any(|entry| entry.id == request.id) {
            return Err("记忆 ID 已存在".to_string());
        }
        let category = validate_category(&request.category)?;
        let content = validate_content(&request.content)?;
        if snapshot
            .entries
            .iter()
            .any(|entry| entry.category == category && entry.content == content)
        {
            return Err("同一条记忆已经存在".to_string());
        }
        let proposal_reason = validate_proposal_reason(&request.reason)?;
        let now = now_ms();
        let (source, reason) = match request.acceptance.as_str() {
            "confirmed" => (
                "user_confirmed_agent_proposal",
                format!("用户确认了模型提议：{proposal_reason}"),
            ),
            "explicit_request" => (
                "user_explicit_agent_proposal",
                format!("用户明确要求记住并启用了自动保存：{proposal_reason}"),
            ),
            _ => return Err("记忆提议接受方式不受支持".to_string()),
        };
        snapshot.entries.push(MemoryEntry {
            id: request.id,
            category,
            content,
            source: source.to_string(),
            reason,
            created_at_ms: now,
            updated_at_ms: now,
        });
        Ok(())
    })?;
    emit_changed(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn memory_update_entry(
    app: AppHandle,
    request: UpdateMemoryRequest,
    manager: State<'_, MemoryManager>,
) -> Result<MemorySnapshot, String> {
    let (_, snapshot) = manager.mutate(|snapshot| {
        validate_id(&request.id)?;
        let category = validate_category(&request.category)?;
        let content = validate_content(&request.content)?;
        let entry = snapshot
            .entries
            .iter_mut()
            .find(|entry| entry.id == request.id)
            .ok_or_else(|| "记忆不存在".to_string())?;
        entry.category = category;
        entry.content = content;
        entry.updated_at_ms = now_ms();
        Ok(())
    })?;
    emit_changed(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn memory_delete_entry(
    app: AppHandle,
    id: String,
    manager: State<'_, MemoryManager>,
) -> Result<MemorySnapshot, String> {
    let (_, snapshot) = manager.mutate(|snapshot| {
        validate_id(&id)?;
        let original_len = snapshot.entries.len();
        snapshot.entries.retain(|entry| entry.id != id);
        if snapshot.entries.len() == original_len {
            return Err("记忆不存在".to_string());
        }
        Ok(())
    })?;
    emit_changed(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn memory_clear_all(
    app: AppHandle,
    manager: State<'_, MemoryManager>,
) -> Result<MemorySnapshot, String> {
    let (_, snapshot) = manager.mutate(|snapshot| {
        *snapshot = MemorySnapshot::default();
        Ok(())
    })?;
    emit_changed(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn memory_record_interaction(
    app: AppHandle,
    request: RecordInteractionRequest,
    manager: State<'_, MemoryManager>,
) -> Result<BondAwardResponse, String> {
    let ((awarded, reason), snapshot) =
        manager.mutate(|snapshot| record_interaction(snapshot, &request))?;
    emit_changed(&app, &snapshot);
    Ok(BondAwardResponse {
        snapshot,
        awarded,
        reason,
    })
}

#[tauri::command]
pub fn memory_export(app: AppHandle, manager: State<'_, MemoryManager>) -> Result<String, String> {
    let snapshot = manager
        .snapshot
        .lock()
        .map_err(|_| "记忆存储锁已损坏".to_string())?
        .clone();
    let dir = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("ltypet-memory-{}.json", now_ms()));
    let json = serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn record_interaction(
    snapshot: &mut MemorySnapshot,
    request: &RecordInteractionRequest,
) -> Result<(u32, String), String> {
    validate_id(&request.interaction_id)?;
    if !is_local_date(&request.local_date) {
        return Err("localDate 必须是 YYYY-MM-DD".to_string());
    }
    if snapshot
        .bond
        .recent_interaction_ids
        .contains(&request.interaction_id)
    {
        return Ok((0, "duplicate".to_string()));
    }
    snapshot
        .bond
        .recent_interaction_ids
        .push(request.interaction_id.clone());
    if snapshot.bond.recent_interaction_ids.len() > MAX_RECENT_INTERACTIONS {
        snapshot.bond.recent_interaction_ids.remove(0);
    }
    if snapshot.bond.daily_date != request.local_date {
        snapshot.bond.daily_date = request.local_date.clone();
        snapshot.bond.daily_awards = 0;
    }
    if snapshot.bond.points >= MAX_BOND_POINTS {
        return Ok((0, "maximum_reached".to_string()));
    }
    if snapshot.bond.daily_awards >= DAILY_BOND_LIMIT {
        return Ok((0, "daily_limit".to_string()));
    }
    snapshot.bond.points += 1;
    snapshot.bond.daily_awards += 1;
    snapshot.bond.events.push(BondEvent {
        id: request.interaction_id.clone(),
        delta: 1,
        reason: "成功完成一次用户发起的对话".to_string(),
        occurred_at_ms: request.occurred_at_ms,
    });
    if snapshot.bond.events.len() > MAX_BOND_EVENTS {
        snapshot.bond.events.remove(0);
    }
    Ok((1, "completed_conversation".to_string()))
}

fn emit_changed(app: &AppHandle, snapshot: &MemorySnapshot) {
    let _ = app.emit("memory-changed", snapshot);
}

fn load_with_recovery(path: &Path) -> (MemorySnapshot, String) {
    if !path.exists() {
        return (MemorySnapshot::default(), "none".to_string());
    }
    if let Ok(snapshot) = read_snapshot(path) {
        return (snapshot, "none".to_string());
    }
    let backup = backup_path(path);
    if let Ok(snapshot) = read_snapshot(&backup) {
        // 恢复路径不能调用常规轮转，否则损坏的主文件会覆盖当前有效备份。
        let _ = replace_primary(path, &snapshot);
        return (snapshot, "backup".to_string());
    }
    let snapshot = MemorySnapshot::default();
    if replace_primary(path, &snapshot).is_ok() {
        let _ = fs::copy(path, backup);
    }
    (snapshot, "reset".to_string())
}

fn read_snapshot(path: &Path) -> Result<MemorySnapshot, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("记忆文件超过大小上限".to_string());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let snapshot: MemorySnapshot =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn persist_snapshot(path: &Path, snapshot: &MemorySnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(snapshot).map_err(|error| error.to_string())?;
    if json.len() as u64 > MAX_FILE_BYTES {
        return Err("记忆文件超过大小上限".to_string());
    }
    let temporary = path.with_extension("json.tmp");
    let backup = backup_path(path);
    fs::write(&temporary, json).map_err(|error| error.to_string())?;
    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| error.to_string())?;
    }
    if path.exists() {
        fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        error.to_string()
    })
}

/// 仅供启动恢复使用：替换无效主文件，同时保留已经验证过的备份。
fn replace_primary(path: &Path, snapshot: &MemorySnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(snapshot).map_err(|error| error.to_string())?;
    if json.len() as u64 > MAX_FILE_BYTES {
        return Err("记忆文件超过大小上限".to_string());
    }
    let temporary = path.with_extension("json.restore.tmp");
    fs::write(&temporary, json).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn validate_snapshot(snapshot: &MemorySnapshot) -> Result<(), String> {
    if snapshot.schema_version != MEMORY_SCHEMA_VERSION {
        return Err("不支持的记忆 schemaVersion".to_string());
    }
    if snapshot.entries.len() > MAX_ENTRIES {
        return Err("记忆条目过多".to_string());
    }
    if snapshot.bond.points > MAX_BOND_POINTS {
        return Err("羁绊值超出范围".to_string());
    }
    if snapshot.bond.daily_awards > DAILY_BOND_LIMIT {
        return Err("每日羁绊计数超出范围".to_string());
    }
    if snapshot.bond.recent_interaction_ids.len() > MAX_RECENT_INTERACTIONS
        || snapshot.bond.events.len() > MAX_BOND_EVENTS
    {
        return Err("羁绊审计记录过多".to_string());
    }
    let mut entry_ids = HashSet::new();
    for entry in &snapshot.entries {
        validate_id(&entry.id)?;
        if !entry_ids.insert(&entry.id) {
            return Err("记忆 ID 重复".to_string());
        }
        validate_category(&entry.category)?;
        validate_content(&entry.content)?;
        match entry.source.as_str() {
            "user_saved" if entry.reason == "用户在设置中明确保存" => {}
            "user_confirmed_agent_proposal"
                if entry.reason.starts_with("用户确认了模型提议：")
                    && entry.reason.chars().count() <= 180 => {}
            "user_explicit_agent_proposal"
                if entry
                    .reason
                    .starts_with("用户明确要求记住并启用了自动保存：")
                    && entry.reason.chars().count() <= 200 => {}
            _ => return Err("记忆来源或保存原因不受支持".to_string()),
        }
    }
    for id in &snapshot.bond.recent_interaction_ids {
        validate_id(id)?;
    }
    for event in &snapshot.bond.events {
        validate_id(&event.id)?;
        if event.delta != 1 || event.reason != "成功完成一次用户发起的对话" {
            return Err("羁绊审计事件无效".to_string());
        }
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.chars().count() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("ID 必须是 1～128 位 ASCII 字母、数字、连字符或下划线".to_string());
    }
    Ok(())
}

fn validate_category(value: &str) -> Result<String, String> {
    if matches!(value, "preference" | "profile" | "note") {
        Ok(value.to_string())
    } else {
        Err("记忆分类必须是 preference、profile 或 note".to_string())
    }
}

fn validate_content(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_ENTRY_CHARS {
        return Err(format!("记忆内容必须是 1～{MAX_ENTRY_CHARS} 个字符"));
    }
    Ok(trimmed.to_string())
}

fn validate_proposal_reason(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > 160 {
        return Err("提议原因必须是 1～160 个字符".to_string());
    }
    Ok(trimmed.to_string())
}

fn is_local_date(value: &str) -> bool {
    if !(value.len() == 10
        && value.as_bytes().iter().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                *byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        }))
    {
        return false;
    }
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bond_awards_are_deduplicated_and_capped_per_day() {
        let mut snapshot = MemorySnapshot::default();
        for index in 0..4 {
            let request = RecordInteractionRequest {
                interaction_id: format!("turn-{index}"),
                occurred_at_ms: index,
                local_date: "2026-07-23".to_string(),
            };
            let result = record_interaction(&mut snapshot, &request).unwrap();
            assert_eq!(result.0, if index < 3 { 1 } else { 0 });
        }
        let duplicate = RecordInteractionRequest {
            interaction_id: "turn-0".to_string(),
            occurred_at_ms: 99,
            local_date: "2026-07-24".to_string(),
        };
        assert_eq!(
            record_interaction(&mut snapshot, &duplicate).unwrap().1,
            "duplicate"
        );
        assert_eq!(snapshot.bond.points, 3);
    }

    #[test]
    fn new_local_day_resets_only_the_daily_counter() {
        let mut snapshot = MemorySnapshot::default();
        for (id, date) in [("a", "2026-07-23"), ("b", "2026-07-24")] {
            let request = RecordInteractionRequest {
                interaction_id: id.to_string(),
                occurred_at_ms: 1,
                local_date: date.to_string(),
            };
            assert_eq!(record_interaction(&mut snapshot, &request).unwrap().0, 1);
        }
        assert_eq!(snapshot.bond.points, 2);
        assert_eq!(snapshot.bond.daily_awards, 1);
    }

    #[test]
    fn invalid_or_oversized_entries_are_rejected() {
        assert!(validate_category("secret").is_err());
        assert!(validate_content(" ").is_err());
        assert!(validate_content(&"a".repeat(MAX_ENTRY_CHARS + 1)).is_err());
    }

    #[test]
    fn user_confirmed_agent_proposal_is_a_valid_auditable_source() {
        let mut snapshot = MemorySnapshot::default();
        snapshot.entries.push(MemoryEntry {
            id: "proposal-1".to_string(),
            category: "preference".to_string(),
            content: "用户不喜欢香菜".to_string(),
            source: "user_confirmed_agent_proposal".to_string(),
            reason: "用户确认了模型提议：稳定饮食偏好".to_string(),
            created_at_ms: 1,
            updated_at_ms: 1,
        });
        assert!(validate_snapshot(&snapshot).is_ok());
        snapshot.entries[0].source = "agent_silent_write".to_string();
        assert!(validate_snapshot(&snapshot).is_err());
    }

    #[test]
    fn explicit_request_auto_save_has_a_distinct_auditable_source() {
        let mut snapshot = MemorySnapshot::default();
        snapshot.entries.push(MemoryEntry {
            id: "explicit-1".to_string(),
            category: "note".to_string(),
            content: "用户希望以后称呼他为阿明".to_string(),
            source: "user_explicit_agent_proposal".to_string(),
            reason: "用户明确要求记住并启用了自动保存：用户明确要求".to_string(),
            created_at_ms: 1,
            updated_at_ms: 1,
        });
        assert!(validate_snapshot(&snapshot).is_ok());
    }

    #[test]
    fn corrupted_primary_recovers_from_valid_backup() {
        let dir = std::env::temp_dir().join(format!("ltypet-memory-test-{}", now_ms()));
        let path = dir.join("memory.v1.json");
        let mut expected = MemorySnapshot::default();
        expected.bond.points = 7;
        persist_snapshot(&path, &expected).unwrap();
        fs::copy(&path, backup_path(&path)).unwrap();
        fs::write(&path, "{broken").unwrap();

        let (loaded, recovery) = load_with_recovery(&path);
        assert_eq!(recovery, "backup");
        assert_eq!(loaded.bond.points, 7);
        assert!(read_snapshot(&path).is_ok());
        assert_eq!(read_snapshot(&backup_path(&path)).unwrap().bond.points, 7);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupted_primary_and_backup_are_reset_to_valid_empty_data() {
        let dir = std::env::temp_dir().join(format!("ltypet-memory-reset-test-{}", now_ms()));
        let path = dir.join("memory.v1.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "{broken").unwrap();
        fs::write(backup_path(&path), "{also-broken").unwrap();

        let (loaded, recovery) = load_with_recovery(&path);
        assert_eq!(recovery, "reset");
        assert!(loaded.entries.is_empty());
        assert_eq!(loaded.bond.points, 0);
        assert!(read_snapshot(&path).is_ok());
        assert!(read_snapshot(&backup_path(&path)).is_ok());
        let _ = fs::remove_dir_all(dir);
    }
}
