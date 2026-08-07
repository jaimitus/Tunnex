//! Tunnex — native application entry point (Windows 10/11).
//!
//! Wires together:
//! - The tunnel manager (`tunnel::TunnelManager`) with its own Tokio runtime.
//! - The system tray icon with a context menu (show / open console / quit).
//! - Automatic startup of the tunnels flagged with `auto_start`.
//! - Minimize-to-tray behaviour when the window is closed.
//! - Registration of every command invocable from the UI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod console;
mod models;
mod storage;
mod tunnel;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::Manager;

use crate::models::AuthMethod;
use crate::storage::Storage;
use crate::tunnel::TunnelManager;

/// Configures the tray icon: context menu and click-to-show behaviour.
fn configure_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Tunnex", true, None::<&str>)?;
    let connect_all_item = MenuItem::with_id(app, "connect_all", "Connect all", true, None::<&str>)?;
    let disconnect_all_item = MenuItem::with_id(app, "disconnect_all", "Disconnect all", true, None::<&str>)?;
    let console_item = MenuItem::with_id(
        app,
        "console",
        "Open PowerShell",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &connect_all_item,
            &disconnect_all_item,
            &console_item,
            &separator,
            &quit_item,
        ],
    )?;

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))?;
        // Left click shows the window; the menu opens with a right click.
        tray.set_show_menu_on_left_click(false)?;

        tray.on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "connect_all" => {
                if let Some(manager) = app.try_state::<TunnelManager>() {
                    manager.start_all();
                }
            }
            "disconnect_all" => {
                if let Some(manager) = app.try_state::<TunnelManager>() {
                    manager.stop_all();
                }
            }
            "console" => {
                // Plain PowerShell window in the user's home directory.
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("powershell.exe")
                        .args([
                            "-NoLogo",
                            "-NoExit",
                            "-Command",
                            "$Host.UI.RawUI.WindowTitle = 'Tunnex — PowerShell'; Write-Host '  TUNNEX ' -NoNewline -ForegroundColor Black -BackgroundColor DarkYellow; Write-Host '  local shell' -ForegroundColor DarkGray;",
                        ])
                        .creation_flags(0x0000_0010)
                        .spawn();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        });

        tray.on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    } else {
        log::warn!("tray icon 'main' was not found");
    }

    Ok(())
}

/// Starts the tunnels of every rule flagged with `auto_start`.
fn autostart_tunnels(manager: &TunnelManager) {
    let data = match Storage::open().and_then(|s| s.load()) {
        Ok(data) => data,
        Err(e) => {
            log::error!("could not read the configuration for auto-start: {e}");
            return;
        }
    };

    for rule in data.rules.iter().filter(|r| r.auto_start) {
        let Some(profile) = data
            .profiles
            .iter()
            .find(|p| p.id == rule.profile_id)
            .cloned()
        else {
            log::warn!(
                "rule “{}” references a missing profile; skipping auto-start",
                rule.name
            );
            continue;
        };

        let secret = match &profile.auth_method {
            AuthMethod::Password => {
                storage::get_secret(&storage::password_user(&profile.id)).unwrap_or(None)
            }
            AuthMethod::KeyFile { has_passphrase, .. } => {
                if *has_passphrase {
                    storage::get_secret(&storage::passphrase_user(&profile.id)).unwrap_or(None)
                } else {
                    None
                }
            }
        };

        if let Err(e) = manager.start_tunnel(profile, rule.clone(), secret, data.settings.clone()) {
            log::warn!("auto-start failed for rule “{}”: {e}", rule.name);
        } else {
            log::info!("auto-starting tunnel “{}”", rule.name);
        }
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .setup(|app| {
            // Tunnel manager with its dedicated Tokio runtime.
            let manager = TunnelManager::new(app.handle().clone()).map_err(|e| e.to_string())?;

            // System tray.
            configure_tray(app)?;

            app.manage(manager.clone());

            // Tunnels flagged for automatic startup.
            autostart_tunnels(&manager);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window minimizes to tray: tunnels keep running.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::get_rules,
            commands::save_rule,
            commands::delete_rule,
            commands::toggle_tunnel,
            commands::restart_tunnel,
            commands::get_active_tunnels_status,
            commands::open_ssh_console,
            commands::open_tunnel_console,
            commands::preview_ssh_command,
            commands::get_settings,
            commands::save_settings,
            commands::get_storage_info,
            commands::connect_all,
            commands::disconnect_all,
            commands::open_in_browser,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Tunnex application")
        .run(|app_handle, event| {
            // On a real exit (tray menu -> Quit) shut every tunnel down.
            if let tauri::RunEvent::Exit = event {
                if let Some(manager) = app_handle.try_state::<TunnelManager>() {
                    manager.stop_all();
                }
            }
        });
}
