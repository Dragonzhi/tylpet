// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Deserialize;
use std::fs;
use std::sync::OnceLock;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuEvent, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, LogicalPosition, Manager};
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, HHOOK, MSG, WH_MOUSE_LL, WM_LBUTTONUP,
};

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

const MENU_TOGGLE_ALWAYS_ON_TOP: &str = "toggle-always-on-top";
const MENU_CENTER_WINDOW: &str = "center-window";
const MENU_SHOW_WINDOW: &str = "show-window";
const MENU_EXIT: &str = "exit";
const TRAY_ID: &str = "main-tray";

#[derive(Debug, PartialEq, Eq)]
enum WindowMenuAction {
    ToggleAlwaysOnTop,
    CenterWindow,
    ShowWindow,
    Exit,
}

fn window_menu_action(menu_id: &str) -> Option<WindowMenuAction> {
    match menu_id {
        MENU_TOGGLE_ALWAYS_ON_TOP => Some(WindowMenuAction::ToggleAlwaysOnTop),
        MENU_CENTER_WINDOW => Some(WindowMenuAction::CenterWindow),
        MENU_SHOW_WINDOW => Some(WindowMenuAction::ShowWindow),
        MENU_EXIT => Some(WindowMenuAction::Exit),
        _ => None,
    }
}

#[derive(Deserialize)]
struct ContextMenuPosition {
    x: f64,
    y: f64,
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let Some(app) = APP_HANDLE.get() else {
            return CallNextHookEx(None, code, wparam, lparam);
        };
        let mut pos = POINT::default();
        if GetCursorPos(&mut pos).is_ok() {
            let payload = serde_json::json!({ "x": pos.x as f64, "y": pos.y as f64 });
            let _ = app.emit("global-cursor-move", payload.clone());
            if is_left_button_up(wparam.0) {
                let _ = app.emit("global-left-button-up", payload);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn is_left_button_up(message: usize) -> bool {
    message == WM_LBUTTONUP as usize
}

fn start_global_mouse_hook(app_handle: tauri::AppHandle) {
    APP_HANDLE.set(app_handle).ok();
    std::thread::spawn(move || unsafe {
        let hook: HHOOK = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0)
            .expect("failed to set global mouse hook");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }

        let _ = UnhookWindowsHookEx(hook);
    });
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn start_dragging(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_context_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    position: ContextMenuPosition,
) -> Result<(), String> {
    if !position.x.is_finite() || !position.y.is_finite() {
        return Err("菜单坐标必须是有限数值".to_string());
    }

    let always_on_top = window.is_always_on_top().map_err(|e| e.to_string())?;
    let always_on_top_item = CheckMenuItemBuilder::new("始终置顶")
        .id(MENU_TOGGLE_ALWAYS_ON_TOP)
        .checked(always_on_top)
        .build(&app)
        .map_err(|e| e.to_string())?;
    let center_item = MenuItemBuilder::new("回到当前屏幕中央")
        .id(MENU_CENTER_WINDOW)
        .build(&app)
        .map_err(|e| e.to_string())?;
    let exit_item = MenuItemBuilder::new("退出小洛宝")
        .id(MENU_EXIT)
        .accelerator("Ctrl+Shift+Q")
        .build(&app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(&app)
        .item(&always_on_top_item)
        .item(&center_item)
        .separator()
        .item(&exit_item)
        .build()
        .map_err(|e| e.to_string())?;

    window
        .popup_menu_at(&menu, LogicalPosition::new(position.x, position.y))
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct WorkArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[tauri::command]
async fn get_work_area(window: tauri::Window) -> Result<WorkArea, String> {
    let tauri_hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // 转换 HWND：tauri 内部使用的 windows 版本可能与当前 crate 版本不同，
    // 但两者均为 repr(transparent) 包装 *mut c_void，所以 transmute 是安全的。
    let hwnd = unsafe { std::mem::transmute::<_, windows::Win32::Foundation::HWND>(tauri_hwnd) };
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO::default();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    let ok = unsafe { GetMonitorInfoW(monitor, &mut info) };
    if !ok.as_bool() {
        return Err("获取显示器工作区失败".to_string());
    }
    let rc = info.rcWork;
    Ok(WorkArea {
        x: rc.left as f64,
        y: rc.top as f64,
        width: (rc.right - rc.left) as f64,
        height: (rc.bottom - rc.top) as f64,
    })
}

#[tauri::command]
async fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    if !path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) => {
            eprintln!("读取设置文件失败: {e}");
            Ok(None)
        }
    }
}

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    let tmp_path = dir.join("settings.json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
async fn load_secrets(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("secrets.json");
    if !path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) => {
            eprintln!("读取密钥文件失败: {e}");
            Ok(None)
        }
    }
}

#[tauri::command]
async fn save_secrets(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("secrets.json");
    let tmp_path = dir.join("secrets.json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        e.to_string()
    })?;
    Ok(())
}

fn handle_window_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    let Some(action) = window_menu_action(event.id().as_ref()) else {
        return;
    };

    if action == WindowMenuAction::Exit {
        app.exit(0);
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("无法处理菜单：主窗口不存在");
        return;
    };

    let result = match action {
        WindowMenuAction::ToggleAlwaysOnTop => window
            .is_always_on_top()
            .and_then(|is_always_on_top| window.set_always_on_top(!is_always_on_top)),
        WindowMenuAction::CenterWindow => window.center(),
        WindowMenuAction::ShowWindow => window.show().and_then(|_| window.unminimize()),
        WindowMenuAction::Exit => unreachable!("退出操作已提前处理"),
    };

    if let Err(error) = result {
        eprintln!("执行右键菜单操作失败：{error}");
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("无法显示小洛宝：主窗口不存在");
        return;
    };

    if let Err(error) = window.show().and_then(|_| window.unminimize()) {
        eprintln!("显示小洛宝失败：{error}");
    }
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::new("显示小洛宝")
        .id(MENU_SHOW_WINDOW)
        .build(app)?;
    let exit_item = MenuItemBuilder::new("退出小洛宝")
        .id(MENU_EXIT)
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&exit_item)
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("小洛宝")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Shift+Q")
                .expect("failed to register shortcut")
                .with_handler(|app, _, _| {
                    app.exit(0);
                })
                .build(),
        )
        .on_menu_event(handle_window_menu_event)
        .invoke_handler(tauri::generate_handler![
            greet,
            start_dragging,
            close_window,
            show_context_menu,
            get_work_area,
            load_settings,
            save_settings,
            load_secrets,
            save_secrets
        ])
        .setup(|app| {
            create_tray(app)?;
            let app_handle = app.handle().clone();
            // 启动全局鼠标钩子（追踪全局鼠标位置与左键释放）。
            start_global_mouse_hook(app_handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        is_left_button_up, window_menu_action, WindowMenuAction, MENU_CENTER_WINDOW, MENU_EXIT,
        MENU_SHOW_WINDOW, MENU_TOGGLE_ALWAYS_ON_TOP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{WM_LBUTTONUP, WM_MOUSEMOVE};

    #[test]
    fn maps_only_left_button_up_to_drag_release() {
        assert!(is_left_button_up(WM_LBUTTONUP as usize));
        assert!(!is_left_button_up(WM_MOUSEMOVE as usize));
    }

    #[test]
    fn maps_menu_ids_to_window_actions() {
        assert_eq!(
            window_menu_action(MENU_TOGGLE_ALWAYS_ON_TOP),
            Some(WindowMenuAction::ToggleAlwaysOnTop)
        );
        assert_eq!(
            window_menu_action(MENU_CENTER_WINDOW),
            Some(WindowMenuAction::CenterWindow)
        );
        assert_eq!(
            window_menu_action(MENU_SHOW_WINDOW),
            Some(WindowMenuAction::ShowWindow)
        );
        assert_eq!(window_menu_action(MENU_EXIT), Some(WindowMenuAction::Exit));
        assert_eq!(window_menu_action("unknown"), None);
    }
}
