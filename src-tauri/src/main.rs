// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = ltypet_lib::run_cli_if_requested() {
        std::process::exit(exit_code);
    }
    ltypet_lib::run()
}
