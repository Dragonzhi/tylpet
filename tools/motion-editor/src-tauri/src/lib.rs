mod commands;
mod models;
mod project_io;
mod publish;
mod recovery;

use models::StoredPublishPlan;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct HostState {
    app_data: PathBuf,
    known_roots: Mutex<HashSet<PathBuf>>,
    publish_plans: Mutex<HashMap<String, StoredPublishPlan>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            app.manage(HostState {
                app_data,
                known_roots: Mutex::new(HashSet::new()),
                publish_plans: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::choose_project_directory,
            commands::choose_artwork_and_assets,
            commands::read_project,
            commands::save_project,
            commands::save_project_as,
            commands::list_recent_projects,
            commands::remove_recent_project,
            commands::read_recovery_candidates,
            commands::write_recovery,
            commands::discard_recovery,
            commands::prepare_production_publish,
            commands::commit_production_publish,
            commands::cancel_production_publish,
            commands::reveal_path,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("Animation Studio failed to start: {error}"));
}
