use crate::models::{HostError, HostResult, ProjectSnapshot, PublishPlan, StoredPublishPlan};
use crate::project_io::{document_signature, transactional_replace, validate_snapshot};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const PRODUCTION_RIG_ID: &str = "xiaoluobao";
const PRODUCTION_RELATIVE_PATH: &str = "src/assets/character/xiaoluobao";

pub fn prepare(snapshot: ProjectSnapshot) -> HostResult<StoredPublishPlan> {
    if !cfg!(debug_assertions) {
        return Err(HostError::new(
            "publish_disabled",
            "publish_prepare",
            None,
            "production publish is disabled outside development builds",
        ));
    }
    validate_publish_snapshot(&snapshot)?;
    let target = production_target()?;
    let production_artwork = fs::read_to_string(target.join("artwork.svg")).map_err(|error| {
        HostError::new(
            "io_error",
            "publish_read_artwork",
            Some(&target.join("artwork.svg")),
            error.to_string(),
        )
    })?;
    if production_artwork != snapshot.artwork {
        return Err(HostError::new(
            "artwork_mismatch",
            "publish_validate",
            Some(&target.join("artwork.svg")),
            "candidate artwork does not byte-match production artwork",
        ));
    }
    let current_rig: Value = read_json(&target.join("rig.v1.json"), "publish_read_rig")?;
    if current_rig.get("artwork") != snapshot.rig.get("artwork") {
        return Err(HostError::new(
            "artwork_reference_mismatch",
            "publish_validate",
            Some(&target.join("rig.v1.json")),
            "candidate artwork source, fingerprint, or viewBox differs from production",
        ));
    }
    let current_motions: Value =
        read_json(&target.join("motions.v1.json"), "publish_read_motions")?;
    let current_snapshot = ProjectSnapshot {
        manifest: snapshot.manifest.clone(),
        artwork: production_artwork,
        rig: current_rig,
        motions: current_motions,
        editor: snapshot.editor.clone(),
    };
    let current_signature = document_signature(&current_snapshot)?;
    let candidate_signature = document_signature(&snapshot)?;
    let plan = PublishPlan {
        plan_id: Uuid::new_v4().to_string(),
        target_directory: target.display().to_string(),
        current_signature,
        candidate_signature,
    };
    Ok(StoredPublishPlan {
        plan,
        snapshot,
        target,
    })
}

pub fn commit(stored: &StoredPublishPlan) -> HostResult<String> {
    let target = production_target()?;
    if target != stored.target {
        return Err(HostError::new(
            "publish_target_changed",
            "publish_commit",
            Some(&target),
            "production target no longer matches the prepared allowlist target",
        ));
    }
    let current_rig: Value = read_json(&target.join("rig.v1.json"), "publish_read_rig")?;
    let current_motions: Value =
        read_json(&target.join("motions.v1.json"), "publish_read_motions")?;
    let current = ProjectSnapshot {
        manifest: stored.snapshot.manifest.clone(),
        artwork: fs::read_to_string(target.join("artwork.svg")).map_err(|error| {
            HostError::new(
                "io_error",
                "publish_read_artwork",
                Some(&target),
                error.to_string(),
            )
        })?,
        rig: current_rig,
        motions: current_motions,
        editor: stored.snapshot.editor.clone(),
    };
    if document_signature(&current)? != stored.plan.current_signature {
        return Err(HostError::new(
            "production_changed",
            "publish_commit",
            Some(&target),
            "production assets changed after publish preparation",
        ));
    }
    let writes = vec![
        (
            PathBuf::from("rig.v1.json"),
            canonical_json(&stored.snapshot.rig)?,
        ),
        (
            PathBuf::from("motions.v1.json"),
            canonical_json(&stored.snapshot.motions)?,
        ),
    ];
    transactional_replace(&target, &writes, None)?;
    let reread = ProjectSnapshot {
        manifest: stored.snapshot.manifest.clone(),
        artwork: fs::read_to_string(target.join("artwork.svg")).map_err(|error| {
            HostError::new(
                "io_error",
                "publish_verify",
                Some(&target),
                error.to_string(),
            )
        })?,
        rig: read_json(&target.join("rig.v1.json"), "publish_verify")?,
        motions: read_json(&target.join("motions.v1.json"), "publish_verify")?,
        editor: stored.snapshot.editor.clone(),
    };
    validate_publish_snapshot(&reread)?;
    let signature = document_signature(&reread)?;
    if signature != stored.plan.candidate_signature {
        return Err(HostError::new(
            "publish_verify_failed",
            "publish_verify",
            Some(&target),
            "published signature differs from prepared candidate",
        ));
    }
    Ok(signature)
}

pub fn production_target() -> HostResult<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest.join("../../..").canonicalize().map_err(|error| {
        HostError::new(
            "repository_not_found",
            "publish_target",
            Some(manifest),
            error.to_string(),
        )
    })?;
    let target = repository
        .join(PRODUCTION_RELATIVE_PATH)
        .canonicalize()
        .map_err(|error| {
            HostError::new(
                "publish_target_not_found",
                "publish_target",
                Some(&repository.join(PRODUCTION_RELATIVE_PATH)),
                error.to_string(),
            )
        })?;
    let expected = repository
        .join("src")
        .join("assets")
        .join("character")
        .join(PRODUCTION_RIG_ID);
    if target != expected || !target.is_dir() {
        return Err(HostError::new(
            "publish_target_denied",
            "publish_target",
            Some(&target),
            "resolved target is outside the production allowlist",
        ));
    }
    Ok(target)
}

fn validate_publish_snapshot(snapshot: &ProjectSnapshot) -> HostResult<()> {
    validate_snapshot(snapshot)?;
    if snapshot.manifest.character_rig_id != PRODUCTION_RIG_ID {
        return Err(HostError::new(
            "publish_rig_denied",
            "publish_validate",
            None,
            "only xiaoluobao can be published",
        ));
    }
    let artwork = snapshot
        .rig
        .get("artwork")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostError::new(
                "invalid_artwork_reference",
                "publish_validate",
                None,
                "rig artwork reference is missing",
            )
        })?;
    if artwork.get("source").and_then(Value::as_str) != Some("artwork.svg")
        || artwork.get("fingerprint").and_then(Value::as_str).is_none()
        || !artwork.get("viewBox").is_some_and(Value::is_array)
    {
        return Err(HostError::new(
            "invalid_artwork_reference",
            "publish_validate",
            None,
            "rig artwork source, fingerprint, and viewBox are required",
        ));
    }
    let clips = snapshot
        .motions
        .get("clips")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostError::new(
                "invalid_document",
                "publish_validate",
                None,
                "motions clips are missing",
            )
        })?;
    if !clips
        .iter()
        .any(|clip| clip.get("id").and_then(Value::as_str) == Some("wave"))
    {
        return Err(HostError::new(
            "required_clip_missing",
            "publish_validate",
            None,
            "production motions must contain wave",
        ));
    }
    for event in clips
        .iter()
        .filter_map(|clip| clip.get("events").and_then(Value::as_array))
        .flatten()
    {
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        if !matches!(event_type, "blink" | "mouthOpen" | "mouthClose") {
            return Err(HostError::new(
                "event_not_allowed",
                "publish_validate",
                None,
                format!("event type {event_type} is not in the production allowlist"),
            ));
        }
    }
    Ok(())
}

fn read_json(path: &Path, stage: &str) -> HostResult<Value> {
    let bytes = fs::read(path)
        .map_err(|error| HostError::new("io_error", stage, Some(path), error.to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| HostError::new("invalid_json", stage, Some(path), error.to_string()))
}

fn canonical_json(value: &Value) -> HostResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        HostError::new("serialize_failed", "publish_stage", None, error.to_string())
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EditorStateV1, ProjectFiles, ProjectManifestV1};
    use serde_json::json;

    fn candidate(rig_id: &str) -> ProjectSnapshot {
        ProjectSnapshot {
            manifest: ProjectManifestV1 {
                schema_version: 1,
                project_id: "publish-test".into(),
                display_name: "Publish".into(),
                character_rig_id: rig_id.into(),
                files: ProjectFiles {
                    artwork: "artwork.svg".into(),
                    rig: "rig.v1.json".into(),
                    motions: "motions.v1.json".into(),
                    editor: "editor.json".into(),
                },
            },
            artwork: "<svg/>".into(),
            rig: json!({"schemaVersion":1,"rigId":rig_id,"artwork":{"source":"artwork.svg","fingerprint":"sha256:test","viewBox":[0,0,1,1]},"parts":[]}),
            motions: json!({"schemaVersion":1,"rigId":rig_id,"clips":[{"id":"wave","events":[]}]}),
            editor: EditorStateV1 {
                schema_version: 1,
                ..EditorStateV1::default()
            },
        }
    }

    #[test]
    fn publish_allowlist_rejects_other_rigs_and_unsafe_events() {
        assert_eq!(
            validate_publish_snapshot(&candidate("other"))
                .unwrap_err()
                .code,
            "publish_rig_denied"
        );
        let mut unsafe_candidate = candidate(PRODUCTION_RIG_ID);
        unsafe_candidate.motions["clips"][0]["events"] = json!([{"frame":0,"type":"sfx"}]);
        assert_eq!(
            validate_publish_snapshot(&unsafe_candidate)
                .unwrap_err()
                .code,
            "event_not_allowed"
        );
    }

    #[test]
    fn production_target_is_fixed_to_repository_asset_directory() {
        let target = production_target().unwrap();
        assert!(target.ends_with(Path::new("src/assets/character/xiaoluobao")));
    }
}
