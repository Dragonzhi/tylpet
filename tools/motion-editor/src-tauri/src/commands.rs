use crate::models::{
    HostError, HostResult, ProjectSnapshot, PublishPlan, RecentProjectV1, RecoverySnapshotV1,
    SaveResult,
};
use crate::{project_io, publish, recovery, HostState};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn choose_project_directory(state: State<'_, HostState>) -> HostResult<Option<String>> {
    let selected = rfd::FileDialog::new().pick_folder();
    if let Some(path) = selected {
        let canonical = path.canonicalize().map_err(|error| {
            HostError::new("io_error", "choose_project", Some(&path), error.to_string())
        })?;
        remember_root(&state, canonical.clone())?;
        return Ok(Some(canonical.display().to_string()));
    }
    Ok(None)
}

#[tauri::command]
pub fn choose_artwork_and_assets(state: State<'_, HostState>) -> HostResult<Option<Vec<String>>> {
    let selected = rfd::FileDialog::new()
        .add_filter("LTypet character assets", &["svg", "json"])
        .pick_files();
    let Some(paths) = selected else {
        return Ok(None);
    };
    if paths.is_empty() {
        return Ok(None);
    }
    let parent = paths[0].parent().ok_or_else(|| {
        HostError::new(
            "invalid_selection",
            "choose_assets",
            Some(&paths[0]),
            "selected file has no parent directory",
        )
    })?;
    let root = parent.canonicalize().map_err(|error| {
        HostError::new("io_error", "choose_assets", Some(parent), error.to_string())
    })?;
    let mut resolved = Vec::new();
    for path in paths {
        let canonical = path.canonicalize().map_err(|error| {
            HostError::new("io_error", "choose_assets", Some(&path), error.to_string())
        })?;
        if canonical.parent() != Some(root.as_path()) {
            return Err(HostError::new(
                "selection_spans_directories",
                "choose_assets",
                Some(&canonical),
                "all selected assets must share one directory",
            ));
        }
        resolved.push(canonical.display().to_string());
    }
    remember_root(&state, root)?;
    Ok(Some(resolved))
}

#[tauri::command]
pub fn read_project(root: String, state: State<'_, HostState>) -> HostResult<ProjectSnapshot> {
    let root = authorize_existing_root(&state, &root)?;
    let snapshot = project_io::read_project(&root)?;
    recovery::record_recent(&state.app_data, recent_entry(&snapshot, &root))?;
    Ok(snapshot)
}

#[tauri::command]
pub fn save_project(
    root: String,
    snapshot: ProjectSnapshot,
    state: State<'_, HostState>,
) -> HostResult<SaveResult> {
    let root = authorize_existing_root(&state, &root)?;
    let result = project_io::save_project(&root, &snapshot, false)?;
    recovery::record_recent(&state.app_data, recent_entry(&snapshot, &root))?;
    Ok(result)
}

#[tauri::command]
pub fn save_project_as(
    target: String,
    snapshot: ProjectSnapshot,
    state: State<'_, HostState>,
) -> HostResult<SaveResult> {
    let target = PathBuf::from(target);
    let canonical = if target.exists() {
        authorize_existing_root(&state, &target.display().to_string())?
    } else {
        let parent = target.parent().ok_or_else(|| {
            HostError::new(
                "invalid_project_path",
                "save_as",
                Some(&target),
                "target has no parent",
            )
        })?;
        let parent = parent.canonicalize().map_err(|error| {
            HostError::new("io_error", "save_as", Some(parent), error.to_string())
        })?;
        if !is_known_root(&state, &parent)? {
            return Err(HostError::new(
                "path_not_authorized",
                "save_as",
                Some(&target),
                "save-as parent must be selected through the directory picker",
            ));
        }
        target
    };
    let result = project_io::save_project(&canonical, &snapshot, true)?;
    remember_root(&state, PathBuf::from(&result.root))?;
    recovery::record_recent(
        &state.app_data,
        recent_entry(&snapshot, Path::new(&result.root)),
    )?;
    Ok(result)
}

#[tauri::command]
pub fn list_recent_projects(state: State<'_, HostState>) -> HostResult<Vec<RecentProjectV1>> {
    let recent = recovery::list_recent(&state.app_data)?;
    let mut known = state.known_roots.lock().map_err(lock_error)?;
    for entry in &recent {
        let path = PathBuf::from(&entry.root);
        if let Ok(canonical) = path.canonicalize() {
            if canonical.is_dir() {
                known.insert(canonical);
            }
        }
    }
    Ok(recent)
}

#[tauri::command]
pub fn remove_recent_project(root: String, state: State<'_, HostState>) -> HostResult<()> {
    recovery::remove_recent(&state.app_data, &root)
}

#[tauri::command]
pub fn read_recovery_candidates(
    state: State<'_, HostState>,
) -> HostResult<Vec<RecoverySnapshotV1>> {
    recovery::read_recovery_candidates(&state.app_data)
}

#[tauri::command]
pub fn write_recovery(
    recovery_snapshot: RecoverySnapshotV1,
    state: State<'_, HostState>,
) -> HostResult<()> {
    recovery::write_recovery(&state.app_data, &recovery_snapshot)
}

#[tauri::command]
pub fn discard_recovery(project_id: String, state: State<'_, HostState>) -> HostResult<()> {
    recovery::discard_recovery(&state.app_data, &project_id)
}

#[tauri::command]
pub fn prepare_production_publish(
    snapshot: ProjectSnapshot,
    state: State<'_, HostState>,
) -> HostResult<PublishPlan> {
    let stored = publish::prepare(snapshot)?;
    let plan = stored.plan.clone();
    state
        .publish_plans
        .lock()
        .map_err(lock_error)?
        .insert(plan.plan_id.clone(), stored);
    Ok(plan)
}

#[tauri::command]
pub fn commit_production_publish(
    plan_id: String,
    state: State<'_, HostState>,
) -> HostResult<String> {
    let stored = state
        .publish_plans
        .lock()
        .map_err(lock_error)?
        .remove(&plan_id)
        .ok_or_else(|| {
            HostError::new(
                "publish_plan_not_found",
                "publish_commit",
                None,
                "publish plan is missing, cancelled, or already consumed",
            )
        })?;
    publish::commit(&stored)
}

#[tauri::command]
pub fn cancel_production_publish(plan_id: String, state: State<'_, HostState>) -> HostResult<()> {
    state
        .publish_plans
        .lock()
        .map_err(lock_error)?
        .remove(&plan_id);
    Ok(())
}

#[tauri::command]
pub fn reveal_path(path: String, app: AppHandle, state: State<'_, HostState>) -> HostResult<()> {
    let requested = PathBuf::from(&path).canonicalize().map_err(|error| {
        HostError::new(
            "io_error",
            "reveal",
            Some(Path::new(&path)),
            error.to_string(),
        )
    })?;
    let production = publish::production_target().ok();
    if !is_known_root(&state, &requested)? && production.as_ref() != Some(&requested) {
        return Err(HostError::new(
            "path_not_authorized",
            "reveal",
            Some(&requested),
            "only selected project roots and the fixed publish directory can be revealed",
        ));
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .reveal_item_in_dir(&requested)
        .map_err(|error| {
            HostError::new(
                "reveal_failed",
                "reveal",
                Some(&requested),
                error.to_string(),
            )
        })
}

fn authorize_existing_root(state: &HostState, root: &str) -> HostResult<PathBuf> {
    let path = PathBuf::from(root);
    let canonical = path
        .canonicalize()
        .map_err(|error| HostError::new("io_error", "authorize", Some(&path), error.to_string()))?;
    if !canonical.is_dir() || !is_known_root(state, &canonical)? {
        return Err(HostError::new(
            "path_not_authorized",
            "authorize",
            Some(&canonical),
            "project root must be selected through the directory picker",
        ));
    }
    Ok(canonical)
}

fn remember_root(state: &HostState, root: PathBuf) -> HostResult<()> {
    state.known_roots.lock().map_err(lock_error)?.insert(root);
    Ok(())
}

fn is_known_root(state: &HostState, root: &Path) -> HostResult<bool> {
    Ok(state.known_roots.lock().map_err(lock_error)?.contains(root))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> HostError {
    HostError::new(
        "state_unavailable",
        "state",
        None,
        "host state lock is poisoned",
    )
}

fn recent_entry(snapshot: &ProjectSnapshot, root: &Path) -> RecentProjectV1 {
    RecentProjectV1 {
        schema_version: 1,
        project_id: snapshot.manifest.project_id.clone(),
        display_name: snapshot.manifest.display_name.clone(),
        root: root.display().to_string(),
        opened_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis() as u64),
    }
}
