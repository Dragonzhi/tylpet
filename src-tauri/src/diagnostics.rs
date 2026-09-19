use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_RUNTIME_EVENTS: usize = 80;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeDiagnosticsSnapshot {
    captured_at: u64,
    behavior_mode: String,
    scheduler_events: Vec<SchedulerDiagnostic>,
    observation_events: Vec<ObservationDiagnostic>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SchedulerDiagnostic {
    timestamp: u64,
    action_type: String,
    source: String,
    channel: String,
    priority: String,
    outcome: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ObservationDiagnostic {
    received_at: u64,
    source_kind: String,
    event_type: String,
    outcome: String,
    action_type: Option<String>,
    code: Option<String>,
}

#[tauri::command]
pub fn export_sanitized_diagnostics(
    app: tauri::AppHandle,
    runtime: Option<RuntimeDiagnosticsSnapshot>,
) -> Result<String, String> {
    let settings = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("settings.json")).ok())
        .and_then(|content| serde_json::from_str::<Value>(&content).ok());
    let generated_at = unix_millis()?;
    let report = build_report(
        settings.as_ref(),
        runtime,
        generated_at,
        env!("CARGO_PKG_VERSION"),
    );
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("tylpet-diagnostics-{generated_at}.json"));
    let body = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{body}\n")).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

fn build_report(
    settings: Option<&Value>,
    runtime: Option<RuntimeDiagnosticsSnapshot>,
    generated_at: u64,
    version: &str,
) -> Value {
    let runtime = runtime.and_then(sanitize_runtime);
    json!({
        "format": "tylpet-sanitized-diagnostics-v1",
        "generatedAt": generated_at,
        "application": {
            "name": "Tylpet",
            "version": version,
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
        },
        "settings": settings_summary(settings),
        "runtime": runtime,
        "privacy": {
            "containsSecrets": false,
            "containsChatContent": false,
            "containsPromptsOrToolArguments": false,
            "containsObservationPayloads": false,
            "uploadedAutomatically": false,
        },
    })
}

fn settings_summary(settings: Option<&Value>) -> Value {
    let get = |pointer: &str| settings.and_then(|value| value.pointer(pointer));
    json!({
        "readable": settings.is_some(),
        "schemaVersion": get("/schemaVersion").and_then(Value::as_u64),
        "behaviorMode": get("/behavior/mode").and_then(Value::as_str),
        "companionAutonomyEnabled": get("/companion/autonomyEnabled").and_then(Value::as_bool),
        "companionIdleFrequency": get("/companion/idleFrequency").and_then(Value::as_str),
        "companionParticlesEnabled": get("/companion/particlesEnabled").and_then(Value::as_bool),
        "providerKind": get("/agent/provider").and_then(Value::as_str),
        "agentEnabled": get("/agent/enabled").and_then(Value::as_bool),
        "speechEnabled": get("/speech/enabled").and_then(Value::as_bool),
        "observationEnabled": get("/observation/enabled").and_then(Value::as_bool),
        "systemMediaEnabled": get("/observation/systemMediaEnabled").and_then(Value::as_bool),
        "memoryEnabled": get("/memory/enabled").and_then(Value::as_bool),
    })
}

fn sanitize_runtime(mut runtime: RuntimeDiagnosticsSnapshot) -> Option<RuntimeDiagnosticsSnapshot> {
    if !allowed(
        &runtime.behavior_mode,
        &["companion", "focus", "quiet", "sleep"],
    ) {
        return None;
    }
    runtime.scheduler_events = runtime
        .scheduler_events
        .into_iter()
        .filter(valid_scheduler_event)
        .take(MAX_RUNTIME_EVENTS)
        .collect();
    runtime.observation_events = runtime
        .observation_events
        .into_iter()
        .filter(valid_observation_event)
        .take(MAX_RUNTIME_EVENTS)
        .collect();
    Some(runtime)
}

fn valid_scheduler_event(event: &SchedulerDiagnostic) -> bool {
    allowed(
        &event.action_type,
        &[
            "motion.play",
            "expression.set",
            "look.set",
            "window.move",
            "outfit.equip",
            "speech.say",
            "timer.start",
            "timer.pause",
            "timer.resume",
            "timer.cancel",
            "media.react",
            "memory.propose",
            "wait",
        ],
    ) && allowed(&event.source, &["user", "agent", "timer", "system", "dev"])
        && allowed(
            &event.channel,
            &[
                "locomotion",
                "body-motion",
                "gaze-expression",
                "speech",
                "outfit",
                "timer",
                "ambient",
            ],
        )
        && allowed(
            &event.priority,
            &["safety-stop", "user", "menu", "timer", "agent", "idle"],
        )
        && allowed(
            &event.outcome,
            &[
                "submitted",
                "started",
                "completed",
                "interrupted",
                "rejected",
                "timed_out",
                "failed",
                "cancelled",
                "cooldown_rejected",
            ],
        )
}

fn valid_observation_event(event: &ObservationDiagnostic) -> bool {
    allowed(&event.source_kind, &["system", "plugin", "unknown"])
        && allowed(
            &event.event_type,
            &["media.playback", "dev-agent.status", "unknown"],
        )
        && allowed(&event.outcome, &["scheduled", "ignored", "rejected"])
        && event
            .action_type
            .as_deref()
            .is_none_or(|value| value.len() <= 32 && value.is_ascii())
        && event
            .code
            .as_deref()
            .is_none_or(|value| value.len() <= 48 && value.is_ascii())
}

fn allowed(value: &str, allowed_values: &[&str]) -> bool {
    allowed_values.contains(&value)
}

#[cfg(test)]
mod tests {
    use super::build_report;
    use serde_json::json;

    #[test]
    fn report_whitelists_settings_and_excludes_sensitive_values() {
        let settings = json!({
            "schemaVersion": 11,
            "behavior": { "mode": "focus" },
            "companion": {
                "autonomyEnabled": true,
                "idleFrequency": "low",
                "particlesEnabled": true
            },
            "agent": {
                "enabled": true,
                "provider": "openai-compatible",
                "endpoint": "https://secret.example/v1",
                "model": "private-model",
                "apiKey": "top-secret"
            },
            "speech": { "enabled": true },
            "observation": { "enabled": true, "systemMediaEnabled": false },
            "memory": { "enabled": true },
            "chat": { "content": "private conversation" }
        });
        let report = build_report(Some(&settings), None, 123, "0.1.0-preview.2");
        let text = serde_json::to_string(&report).unwrap();
        assert!(text.contains("openai-compatible"));
        assert!(text.contains("companionAutonomyEnabled"));
        for secret in [
            "top-secret",
            "secret.example",
            "private-model",
            "private conversation",
        ] {
            assert!(!text.contains(secret));
        }
    }
}
