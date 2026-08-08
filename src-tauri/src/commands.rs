//! Tauri commands exposed to the frontend (invoked from TypeScript).
//!
//! Every command is asynchronous: disk I/O, keyring access and process
//! spawning run on the tunnel runtime blocking pool so the UI never freezes.
//! Errors are returned as `String` (serde friendly).

use std::time::Duration;

use tauri::State;

use crate::console;
use crate::models::{
    AppSettings, AuthMethod, ConsoleLaunch, PortForwardRule, SshProfile, StorageInfo, TunnelStatus,
};
use crate::storage::{self, Storage, StorageData};
use crate::tunnel::TunnelManager;

type CmdResult<T> = Result<T, String>;

/// Awaits a blocking-pool `JoinHandle` and flattens the inner error.
async fn await_blocking<T>(
    manager: &TunnelManager,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> CmdResult<T>
where
    T: Send + 'static,
{
    manager
        .spawn_blocking(f)
        .await
        .map_err(|e| format!("internal task was cancelled: {e}"))?
}

fn load_data() -> Result<StorageData, String> {
    Storage::open()
        .and_then(|s| s.load())
        .map_err(|e| e.to_string())
}

fn load_and_save<F>(mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut StorageData) -> Result<(), String>,
{
    let storage = Storage::open().map_err(|e| e.to_string())?;
    let mut data = storage.load().map_err(|e| e.to_string())?;
    mutate(&mut data)?;
    storage.save(&data).map_err(|e| e.to_string())
}

fn validate_profile(p: &SshProfile) -> CmdResult<()> {
    if p.name.trim().is_empty() {
        return Err("the server name cannot be empty".to_string());
    }
    if p.host.trim().is_empty() {
        return Err("the host cannot be empty".to_string());
    }
    if p.port == 0 {
        return Err("the SSH port must be between 1 and 65535".to_string());
    }
    if p.username.trim().is_empty() {
        return Err("the username cannot be empty".to_string());
    }
    if let AuthMethod::KeyFile { path, .. } = &p.auth_method {
        if path.trim().is_empty() {
            return Err("the private key path cannot be empty".to_string());
        }
    }
    Ok(())
}

fn validate_rule(r: &PortForwardRule) -> CmdResult<()> {
    if r.name.trim().is_empty() {
        return Err("the rule name cannot be empty".to_string());
    }
    if r.local_port == 0 {
        return Err("the local port must be between 1 and 65535".to_string());
    }
    if r.remote_port == 0 {
        return Err("the remote port must be between 1 and 65535".to_string());
    }
    if r.remote_host.trim().is_empty() {
        return Err("the remote host cannot be empty".to_string());
    }
    Ok(())
}

/// Resolves a profile secret (password or passphrase) from the Windows
/// Credential Manager.
fn resolve_secret(profile: &SshProfile) -> Result<Option<String>, String> {
    match &profile.auth_method {
        AuthMethod::Password => {
            storage::get_secret(&storage::password_user(&profile.id)).map_err(|e| e.to_string())
        }
        AuthMethod::KeyFile { has_passphrase, .. } => {
            if *has_passphrase {
                storage::get_secret(&storage::passphrase_user(&profile.id))
                    .map_err(|e| e.to_string())
            } else {
                Ok(None)
            }
        }
    }
}

/// Loads a rule together with its profile and the global settings.
fn load_rule_context(rule_id: &str) -> Result<(SshProfile, PortForwardRule, AppSettings), String> {
    let data = load_data()?;
    let rule = data
        .rules
        .iter()
        .find(|r| r.id == rule_id)
        .cloned()
        .ok_or_else(|| format!("rule `{rule_id}` does not exist"))?;
    let profile = data
        .profiles
        .iter()
        .find(|p| p.id == rule.profile_id)
        .cloned()
        .ok_or_else(|| "the SSH profile linked to this rule no longer exists".to_string())?;
    Ok((profile, rule, data.settings))
}

/// Starts the tunnel of a rule: loads rule + profile, resolves the secret and
/// delegates to the `TunnelManager`.
async fn start_rule(manager: &TunnelManager, rule_id: &str) -> CmdResult<TunnelStatus> {
    let owned_id = rule_id.to_string();
    let (profile, rule, settings) =
        await_blocking(manager, move || load_rule_context(&owned_id)).await?;

    let secret_profile = profile.clone();
    let secret = await_blocking(manager, move || resolve_secret(&secret_profile)).await?;

    manager
        .start_tunnel(profile, rule, secret, settings)
        .map_err(|e| e.to_string())
}

// ───────────────────────────── SSH profiles ─────────────────────────────

#[tauri::command]
pub async fn get_profiles(manager: State<'_, TunnelManager>) -> CmdResult<Vec<SshProfile>> {
    await_blocking(&manager, || load_data().map(|d| d.profiles)).await
}

#[tauri::command]
pub async fn save_profile(
    manager: State<'_, TunnelManager>,
    profile: SshProfile,
    password: Option<String>,
    passphrase: Option<String>,
) -> CmdResult<SshProfile> {
    validate_profile(&profile)?;

    // The backend generates the id when the frontend did not provide one.
    let id = if profile.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        profile.id.clone()
    };

    let mut profile = SshProfile {
        id,
        name: profile.name.trim().to_string(),
        host: profile.host.trim().to_string(),
        port: profile.port,
        username: profile.username.trim().to_string(),
        auth_method: match &profile.auth_method {
            AuthMethod::Password => AuthMethod::Password,
            AuthMethod::KeyFile {
                path,
                has_passphrase,
            } => AuthMethod::KeyFile {
                path: path.trim().to_string(),
                has_passphrase: *has_passphrase,
            },
        },
        created_at: profile.created_at,
    };
    if profile.created_at == 0 {
        profile.created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
    }

    await_blocking(&manager, move || -> CmdResult<SshProfile> {
        load_and_save(|data| {
            Storage::upsert_profile(data, profile.clone());
            Ok(())
        })?;

        // Secret management in the Credential Manager.
        match &profile.auth_method {
            AuthMethod::Password => {
                if let Some(pw) = password {
                    if !pw.is_empty() {
                        storage::store_secret(&storage::password_user(&profile.id), &pw)
                            .map_err(|e| e.to_string())?;
                    }
                }
                // If it previously used a key, drop the leftover passphrase.
                let _ = storage::delete_secret(&storage::passphrase_user(&profile.id));
            }
            AuthMethod::KeyFile { has_passphrase, .. } => {
                // No password is associated any more.
                let _ = storage::delete_secret(&storage::password_user(&profile.id));
                if *has_passphrase {
                    if let Some(pp) = passphrase {
                        if !pp.is_empty() {
                            storage::store_secret(&storage::passphrase_user(&profile.id), &pp)
                                .map_err(|e| e.to_string())?;
                        }
                    }
                } else {
                    let _ = storage::delete_secret(&storage::passphrase_user(&profile.id));
                }
            }
        }
        Ok(profile)
    })
    .await
}

#[tauri::command]
pub async fn delete_profile(
    manager: State<'_, TunnelManager>,
    profile_id: String,
) -> CmdResult<Vec<String>> {
    let removed_rule_ids = await_blocking(&manager, move || -> CmdResult<Vec<String>> {
        let storage = Storage::open().map_err(|e| e.to_string())?;
        let mut data = storage.load().map_err(|e| e.to_string())?;

        let removed: Vec<String> = data
            .rules
            .iter()
            .filter(|r| r.profile_id == profile_id)
            .map(|r| r.id.clone())
            .collect();

        data.rules.retain(|r| r.profile_id != profile_id);
        data.profiles.retain(|p| p.id != profile_id);
        storage.save(&data).map_err(|e| e.to_string())?;

        // Credential cleanup (password and passphrase).
        let _ = storage::delete_secret(&storage::password_user(&profile_id));
        let _ = storage::delete_secret(&storage::passphrase_user(&profile_id));

        Ok(removed)
    })
    .await?;

    // Stop orphaned tunnels.
    for rule_id in &removed_rule_ids {
        if manager.is_running(rule_id) {
            let _ = manager.stop_tunnel(rule_id);
        }
    }

    Ok(removed_rule_ids)
}

// ──────────────────────────── Forwarding rules ──────────────────────────

#[tauri::command]
pub async fn get_rules(manager: State<'_, TunnelManager>) -> CmdResult<Vec<PortForwardRule>> {
    await_blocking(&manager, || load_data().map(|d| d.rules)).await
}

#[tauri::command]
pub async fn save_rule(
    manager: State<'_, TunnelManager>,
    rule: PortForwardRule,
) -> CmdResult<PortForwardRule> {
    validate_rule(&rule)?;

    let id = if rule.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        rule.id.clone()
    };

    let rule = PortForwardRule {
        id,
        profile_id: rule.profile_id.clone(),
        name: rule.name.trim().to_string(),
        local_port: rule.local_port,
        remote_host: rule.remote_host.trim().to_string(),
        remote_port: rule.remote_port,
        auto_start: rule.auto_start,
    };

    await_blocking(&manager, move || -> CmdResult<PortForwardRule> {
        load_and_save(|data| {
            if !data.profiles.iter().any(|p| p.id == rule.profile_id) {
                return Err("the selected SSH profile does not exist".to_string());
            }
            let conflict = data
                .rules
                .iter()
                .find(|r| r.local_port == rule.local_port && r.id != rule.id);
            if let Some(other) = conflict {
                return Err(format!(
                    "local port {} is already assigned to rule “{}”",
                    rule.local_port, other.name
                ));
            }
            Storage::upsert_rule(data, rule.clone());
            Ok(())
        })?;
        Ok(rule)
    })
    .await
    .map(|saved| {
        // If the rule was edited while running, stop the tunnel so the new
        // configuration is picked up on the next start.
        if manager.is_running(&saved.id) {
            let _ = manager.stop_tunnel(&saved.id);
        }
        saved
    })
}

#[tauri::command]
pub async fn delete_rule(manager: State<'_, TunnelManager>, rule_id: String) -> CmdResult<String> {
    if manager.is_running(&rule_id) {
        let _ = manager.stop_tunnel(&rule_id);
    }

    await_blocking(&manager, move || -> CmdResult<String> {
        load_and_save(|data| {
            data.rules.retain(|r| r.id != rule_id);
            Ok(())
        })?;
        Ok(rule_id)
    })
    .await
}

// ─────────────────────────── Tunnel control ─────────────────────────────

#[tauri::command]
pub async fn toggle_tunnel(
    manager: State<'_, TunnelManager>,
    rule_id: String,
) -> CmdResult<TunnelStatus> {
    if manager.is_running(&rule_id) {
        return manager.stop_tunnel(&rule_id).map_err(|e| e.to_string());
    }
    start_rule(&manager, &rule_id).await
}

#[tauri::command]
pub async fn restart_tunnel(
    manager: State<'_, TunnelManager>,
    rule_id: String,
) -> CmdResult<TunnelStatus> {
    if manager.is_running(&rule_id) {
        manager.stop_tunnel(&rule_id).map_err(|e| e.to_string())?;
        // Small pause so the previous listener releases the local port before
        // binding it again.
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    start_rule(&manager, &rule_id).await
}

#[tauri::command]
pub async fn get_active_tunnels_status(
    manager: State<'_, TunnelManager>,
) -> CmdResult<Vec<TunnelStatus>> {
    let rules = await_blocking(&manager, || load_data().map(|d| d.rules)).await?;
    Ok(rules
        .iter()
        .map(|rule| {
            manager
                .snapshot(&rule.id)
                .unwrap_or_else(|| TunnelStatus::inactive(&rule.id))
        })
        .collect())
}

// ─────────────────────── Windows PowerShell consoles ────────────────────

/// Opens an interactive Windows PowerShell console running `ssh` against the
/// given profile.
#[tauri::command]
pub async fn open_ssh_console(
    manager: State<'_, TunnelManager>,
    profile_id: String,
) -> CmdResult<ConsoleLaunch> {
    let launch = await_blocking(&manager, move || -> CmdResult<ConsoleLaunch> {
        let data = load_data()?;
        let profile = data
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| format!("profile `{profile_id}` does not exist"))?;
        console::open_ssh_console(&profile, &data.settings).map_err(|e| e.to_string())
    })
    .await?;

    manager.emit_console(&launch);
    Ok(launch)
}

/// Opens a local PowerShell console pointed at the forwarded port of a rule.
#[tauri::command]
pub async fn open_tunnel_console(
    manager: State<'_, TunnelManager>,
    rule_id: String,
) -> CmdResult<ConsoleLaunch> {
    let launch = await_blocking(&manager, move || -> CmdResult<ConsoleLaunch> {
        let (profile, rule, settings) = load_rule_context(&rule_id)?;
        console::open_tunnel_console(&rule, &profile, &settings).map_err(|e| e.to_string())
    })
    .await?;

    manager.emit_console(&launch);
    Ok(launch)
}

/// Returns the `ssh` command line that would be executed for a profile, so the
/// UI can preview it without spawning anything.
#[tauri::command]
pub async fn preview_ssh_command(
    manager: State<'_, TunnelManager>,
    profile_id: String,
) -> CmdResult<String> {
    await_blocking(&manager, move || -> CmdResult<String> {
        let data = load_data()?;
        let profile = data
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| format!("profile `{profile_id}` does not exist"))?;
        Ok(console::ssh_command_line(&profile, &data.settings))
    })
    .await
}

// ───────────────────────── Settings and storage ─────────────────────────

#[tauri::command]
pub async fn get_settings(manager: State<'_, TunnelManager>) -> CmdResult<AppSettings> {
    await_blocking(&manager, || load_data().map(|d| d.settings)).await
}

#[tauri::command]
pub async fn save_settings(
    manager: State<'_, TunnelManager>,
    settings: AppSettings,
) -> CmdResult<AppSettings> {
    await_blocking(&manager, move || -> CmdResult<AppSettings> {
        load_and_save(|data| {
            data.settings = settings.clone();
            Ok(())
        })?;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub async fn get_storage_info(manager: State<'_, TunnelManager>) -> CmdResult<StorageInfo> {
    let (profiles, rules) = await_blocking(&manager, || {
        load_data().map(|d| (d.profiles.len(), d.rules.len()))
    })
    .await?;

    let config_path = Storage::open()
        .map(|s| s.config_path().display().to_string())
        .map_err(|e| e.to_string())?;

    Ok(StorageInfo {
        config_path,
        keyring_service: storage::KEYRING_SERVICE.to_string(),
        profiles,
        rules,
        active_tunnels: manager.active_count(),
        mock_mode: false,
    })
}

#[tauri::command]
pub async fn connect_all(manager: State<'_, TunnelManager>) -> CmdResult<Vec<TunnelStatus>> {
    let mgr = manager.inner().clone();
    await_blocking(&manager, move || {
        mgr.start_all();
        Ok(())
    })
    .await?;
    get_active_tunnels_status(manager).await
}

#[tauri::command]
pub async fn disconnect_all(manager: State<'_, TunnelManager>) -> CmdResult<Vec<TunnelStatus>> {
    manager.stop_all();
    get_active_tunnels_status(manager).await
}

#[tauri::command]
pub async fn open_in_browser(_manager: State<'_, TunnelManager>, url: String) -> CmdResult<()> {
    let clean = url.trim().to_string();
    if clean.is_empty() {
        return Err("URL is empty".to_string());
    }

    open::that(&clean).map_err(|e| format!("could not open browser for {clean}: {e}"))?;
    Ok(())
}


