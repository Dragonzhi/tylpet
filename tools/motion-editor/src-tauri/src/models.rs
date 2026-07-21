use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFiles {
    pub artwork: String,
    pub rig: String,
    pub motions: String,
    pub editor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifestV1 {
    pub schema_version: u8,
    pub project_id: String,
    pub display_name: String,
    pub character_rig_id: String,
    pub files: ProjectFiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub manifest: ProjectManifestV1,
    pub artwork: String,
    pub rig: Value,
    pub motions: Value,
    pub editor: EditorStateV1,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStateV1 {
    pub schema_version: u8,
    #[serde(default)]
    pub active_clip_id: Option<String>,
    #[serde(default)]
    pub timeline_scale: Option<f64>,
    #[serde(default)]
    pub expanded_part_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryMetadataV1 {
    pub schema_version: u8,
    pub project_id: String,
    pub source_path_hash: String,
    pub saved_signature: String,
    pub created_at_unix_ms: u64,
    pub document_signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotV1 {
    pub metadata: RecoveryMetadataV1,
    pub snapshot: ProjectSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectV1 {
    pub schema_version: u8,
    pub project_id: String,
    pub display_name: String,
    pub root: String,
    pub opened_at_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostError {
    pub code: String,
    pub stage: String,
    pub path: Option<String>,
    pub message: String,
}

impl HostError {
    pub fn new(
        code: &str,
        stage: &str,
        path: Option<&std::path::Path>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            stage: stage.into(),
            path: path.map(|value| value.display().to_string()),
            message: message.into(),
        }
    }
}

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub root: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishPlan {
    pub plan_id: String,
    pub target_directory: String,
    pub current_signature: String,
    pub candidate_signature: String,
}

#[derive(Debug, Clone)]
pub struct StoredPublishPlan {
    pub plan: PublishPlan,
    pub snapshot: ProjectSnapshot,
    pub target: PathBuf,
}
