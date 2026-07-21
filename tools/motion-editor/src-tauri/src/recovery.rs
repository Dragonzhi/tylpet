use crate::models::{HostError, HostResult, RecentProjectV1, RecoverySnapshotV1};
use crate::project_io::{canonical_path_hash, document_signature, validate_snapshot};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

const RECENT_FILE: &str = "recent-projects.v1.json";
const RECOVERY_DIRECTORY: &str = "recovery-v1";

pub fn list_recent(app_data: &Path) -> HostResult<Vec<RecentProjectV1>> {
    let path = app_data.join(RECENT_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(&path).map_err(|error| io_error("recent_read", &path, error))?;
    let values: Vec<serde_json::Value> = serde_json::from_slice(&bytes).map_err(|error| {
        HostError::new(
            "invalid_recent_file",
            "recent_read",
            Some(&path),
            error.to_string(),
        )
    })?;
    let mut recent = Vec::new();
    for value in values {
        if let Ok(entry) = serde_json::from_value::<RecentProjectV1>(value) {
            if entry.schema_version == 1
                && !recent
                    .iter()
                    .any(|existing: &RecentProjectV1| existing.root == entry.root)
            {
                recent.push(entry);
            }
        }
    }
    recent.sort_by_key(|entry| std::cmp::Reverse(entry.opened_at_unix_ms));
    recent.truncate(20);
    Ok(recent)
}

pub fn record_recent(app_data: &Path, entry: RecentProjectV1) -> HostResult<()> {
    let mut recent = list_recent(app_data).unwrap_or_default();
    recent
        .retain(|existing| existing.root != entry.root && existing.project_id != entry.project_id);
    recent.insert(0, entry);
    recent.truncate(20);
    write_json_atomic(&app_data.join(RECENT_FILE), &recent, "recent_write")
}

pub fn remove_recent(app_data: &Path, root: &str) -> HostResult<()> {
    let mut recent = list_recent(app_data)?;
    recent.retain(|entry| entry.root != root);
    write_json_atomic(&app_data.join(RECENT_FILE), &recent, "recent_write")
}

pub fn write_recovery(app_data: &Path, recovery: &RecoverySnapshotV1) -> HostResult<()> {
    validate_snapshot(&recovery.snapshot)?;
    if recovery.metadata.schema_version != 1
        || recovery.metadata.project_id != recovery.snapshot.manifest.project_id
        || recovery.metadata.document_signature != document_signature(&recovery.snapshot)?
    {
        return Err(HostError::new(
            "invalid_recovery_metadata",
            "recovery_validate",
            None,
            "recovery metadata does not match its snapshot",
        ));
    }
    let directory = app_data.join(RECOVERY_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|error| io_error("recovery_create", &directory, error))?;
    write_json_atomic(
        &recovery_path(&directory, &recovery.metadata.project_id),
        recovery,
        "recovery_write",
    )
}

pub fn read_recovery_candidates(app_data: &Path) -> HostResult<Vec<RecoverySnapshotV1>> {
    let directory = app_data.join(RECOVERY_DIRECTORY);
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut candidates = Vec::new();
    for entry in
        fs::read_dir(&directory).map_err(|error| io_error("recovery_scan", &directory, error))?
    {
        let path = entry
            .map_err(|error| io_error("recovery_scan", &directory, error))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Ok(candidate) = serde_json::from_slice::<RecoverySnapshotV1>(&bytes) else {
            continue;
        };
        if candidate.metadata.schema_version != 1 || validate_snapshot(&candidate.snapshot).is_err()
        {
            continue;
        }
        if candidate.metadata.document_signature != document_signature(&candidate.snapshot)? {
            continue;
        }
        if let Some(root) = candidate
            .snapshot
            .manifest
            .files
            .artwork
            .strip_prefix("file:")
        {
            let source = PathBuf::from(root);
            if source.exists()
                && candidate.metadata.source_path_hash != canonical_path_hash(&source)?
            {
                continue;
            }
        }
        if candidate.metadata.document_signature != candidate.metadata.saved_signature {
            candidates.push(candidate);
        }
    }
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.metadata.created_at_unix_ms));
    Ok(candidates)
}

pub fn discard_recovery(app_data: &Path, project_id: &str) -> HostResult<()> {
    let path = recovery_path(&app_data.join(RECOVERY_DIRECTORY), project_id);
    if path.exists() {
        fs::remove_file(&path).map_err(|error| io_error("recovery_discard", &path, error))?;
    }
    Ok(())
}

fn recovery_path(directory: &Path, project_id: &str) -> PathBuf {
    let safe: String = project_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    directory.join(format!("{safe}.json"))
}

fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T, stage: &str) -> HostResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error(stage, parent, error))?;
    }
    let temporary = path.with_extension("tmp");
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        HostError::new("serialize_failed", stage, Some(path), error.to_string())
    })?;
    bytes.push(b'\n');
    let mut file = File::create(&temporary).map_err(|error| io_error(stage, &temporary, error))?;
    file.write_all(&bytes)
        .map_err(|error| io_error(stage, &temporary, error))?;
    file.sync_all()
        .map_err(|error| io_error(stage, &temporary, error))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| io_error(stage, path, error))?;
    }
    fs::rename(&temporary, path).map_err(|error| io_error(stage, path, error))
}

fn io_error(stage: &str, path: &Path, error: std::io::Error) -> HostError {
    HostError::new("io_error", stage, Some(path), error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        EditorStateV1, ProjectFiles, ProjectManifestV1, ProjectSnapshot, RecoveryMetadataV1,
    };
    use serde_json::json;
    use tempfile::tempdir;

    fn snapshot() -> ProjectSnapshot {
        ProjectSnapshot {
            manifest: ProjectManifestV1 {
                schema_version: 1,
                project_id: "recovery-test".into(),
                display_name: "恢复测试".into(),
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
    fn corrupt_recent_entries_are_skipped_and_duplicates_collapse() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(RECENT_FILE);
        fs::write(&path, br#"[{"schemaVersion":1,"projectId":"one","displayName":"One","root":"C:/one","openedAtUnixMs":1},{"broken":true},{"schemaVersion":1,"projectId":"two","displayName":"Two","root":"C:/one","openedAtUnixMs":2}]"#).unwrap();
        let recent = list_recent(directory.path()).unwrap();
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn recovery_only_returns_dirty_valid_snapshots() {
        let directory = tempdir().unwrap();
        let snapshot = snapshot();
        let signature = document_signature(&snapshot).unwrap();
        let recovery = RecoverySnapshotV1 {
            metadata: RecoveryMetadataV1 {
                schema_version: 1,
                project_id: "recovery-test".into(),
                source_path_hash: "sha256:source".into(),
                saved_signature: "sha256:old".into(),
                created_at_unix_ms: 10,
                document_signature: signature,
            },
            snapshot,
        };
        write_recovery(directory.path(), &recovery).unwrap();
        assert_eq!(read_recovery_candidates(directory.path()).unwrap().len(), 1);
        discard_recovery(directory.path(), "recovery-test").unwrap();
        assert!(read_recovery_candidates(directory.path())
            .unwrap()
            .is_empty());
    }
}
