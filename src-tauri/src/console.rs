//! Native Windows console integration.
//!
//! Tunnex can spawn a real PowerShell window wired to an SSH profile so the
//! user gets an interactive shell on the remote host, or a local console
//! pre-loaded with helpers to probe a forwarded port.
//!
//! The console is launched with `CREATE_NEW_CONSOLE` so it becomes an
//! independent window instead of inheriting Tunnex's (hidden) console.

use std::process::Command;

use thiserror::Error;

use crate::models::{AppSettings, AuthMethod, ConsoleLaunch, PortForwardRule, SshProfile, TerminalKind};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows process creation flag: give the child its own console window.
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

#[derive(Debug, Error)]
pub enum ConsoleError {
    #[error("could not launch `{terminal}`: {source}. Make sure it is installed and available in PATH.")]
    Spawn {
        terminal: String,
        #[source]
        source: std::io::Error,
    },
    #[error("consoles can only be opened on Windows")]
    UnsupportedPlatform,
}

/// Escapes a value so it can be embedded inside a PowerShell single-quoted
/// string (`'` is escaped by doubling it).
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Builds the `ssh` command line for a profile, exactly as it will be typed
/// inside the console (also displayed in the UI as a preview).
pub fn ssh_command_line(profile: &SshProfile, settings: &AppSettings) -> String {
    let mut parts: Vec<String> = vec!["ssh".to_string()];

    if profile.port != 22 {
        parts.push("-p".to_string());
        parts.push(profile.port.to_string());
    }

    if let AuthMethod::KeyFile { path, .. } = &profile.auth_method {
        if !path.trim().is_empty() {
            parts.push("-i".to_string());
            parts.push(if path.contains(' ') {
                format!("\"{path}\"")
            } else {
                path.clone()
            });
        }
    }

    if settings.accept_new_host_keys {
        parts.push("-o".to_string());
        parts.push("StrictHostKeyChecking=accept-new".to_string());
    }

    parts.push(format!("{}@{}", profile.username, profile.host));
    parts.join(" ")
}

/// PowerShell script executed inside the console for an interactive SSH session.
fn ssh_script(profile: &SshProfile, settings: &AppSettings, title: &str) -> String {
    let mut script = String::new();
    script.push_str(&format!(
        "$Host.UI.RawUI.WindowTitle = {};",
        ps_quote(title)
    ));
    script.push_str("Write-Host '';");
    script.push_str(
        "Write-Host '  TUNNEX ' -NoNewline -ForegroundColor Black -BackgroundColor DarkYellow;",
    );
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor DarkGray;",
        ps_quote(&format!("  SSH session -> {}", profile.name))
    ));
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor DarkCyan;",
        ps_quote(&format!(
            "  {}@{}:{}",
            profile.username, profile.host, profile.port
        ))
    ));

    if let AuthMethod::KeyFile { path, has_passphrase } = &profile.auth_method {
        script.push_str(&format!(
            "Write-Host {} -ForegroundColor DarkGray;",
            ps_quote(&format!(
                "  identity: {}{}",
                path,
                if *has_passphrase {
                    " (passphrase protected)"
                } else {
                    ""
                }
            ))
        ));
    }

    let command_line = ssh_command_line(profile, settings);
    script.push_str("Write-Host '';");
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor Yellow;",
        ps_quote(&format!("  > {command_line}"))
    ));
    script.push_str("Write-Host '';");

    // Build the actual invocation with properly quoted arguments.
    let mut args: Vec<String> = Vec::new();
    if profile.port != 22 {
        args.push("'-p'".to_string());
        args.push(format!("'{}'", profile.port));
    }
    if let AuthMethod::KeyFile { path, .. } = &profile.auth_method {
        if !path.trim().is_empty() {
            args.push("'-i'".to_string());
            args.push(ps_quote(path));
        }
    }
    if settings.accept_new_host_keys {
        args.push("'-o'".to_string());
        args.push("'StrictHostKeyChecking=accept-new'".to_string());
    }
    args.push(ps_quote(&format!("{}@{}", profile.username, profile.host)));

    script.push_str(&format!("& ssh {};", args.join(" ")));
    script.push_str(
        "if ($LASTEXITCODE -ne 0) { Write-Host ''; Write-Host \"  ssh exited with code $LASTEXITCODE\" -ForegroundColor Red; }",
    );
    script
}

/// PowerShell script for a local console attached to a forwarded port.
fn tunnel_script(rule: &PortForwardRule, profile: &SshProfile, title: &str) -> String {
    let endpoint = format!("127.0.0.1:{}", rule.local_port);
    let remote = format!("{}:{}", rule.remote_host, rule.remote_port);
    let mut script = String::new();

    script.push_str(&format!("$Host.UI.RawUI.WindowTitle = {};", ps_quote(title)));
    script.push_str("Write-Host '';");
    script.push_str(
        "Write-Host '  TUNNEX ' -NoNewline -ForegroundColor Black -BackgroundColor DarkYellow;",
    );
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor DarkGray;",
        ps_quote(&format!("  tunnel console -> {}", rule.name))
    ));
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor Green;",
        ps_quote(&format!("  {endpoint}  ->  {remote}"))
    ));
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor DarkGray;",
        ps_quote(&format!(
            "  via {}@{}:{}",
            profile.username, profile.host, profile.port
        ))
    ));
    script.push_str("Write-Host '';");
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor DarkGray;",
        ps_quote("  Handy commands:")
    ));
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor Yellow;",
        ps_quote(&format!(
            "    Test-NetConnection 127.0.0.1 -Port {}",
            rule.local_port
        ))
    ));
    script.push_str(&format!(
        "Write-Host {} -ForegroundColor Yellow;",
        ps_quote(&format!(
            "    Get-NetTCPConnection -LocalPort {} | Format-Table -AutoSize",
            rule.local_port
        ))
    ));
    script.push_str("Write-Host '';");
    script.push_str(&format!(
        "Test-NetConnection 127.0.0.1 -Port {} -InformationLevel Detailed;",
        rule.local_port
    ));
    script
}

fn to_base64_utf16(script: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(&utf16)
}

/// Spawns the terminal window running `script`.
#[cfg(windows)]
fn spawn(kind: TerminalKind, title: &str, script: &str, keep_open: bool) -> Result<(), ConsoleError> {
    let b64_script = to_base64_utf16(script);
    let shell = kind.shell_executable();

    let mut command = match kind {
        TerminalKind::WindowsTerminal => {
            let mut cmd = Command::new("wt.exe");
            cmd.arg("new-tab").arg("--title").arg(title).arg(shell);
            if keep_open {
                cmd.arg("-NoExit");
            }
            cmd.arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-EncodedCommand")
                .arg(&b64_script);
            cmd
        }
        _ => {
            let mut cmd = Command::new(shell);
            cmd.arg("-NoLogo");
            if keep_open {
                cmd.arg("-NoExit");
            }
            cmd.arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-EncodedCommand")
                .arg(&b64_script);
            cmd
        }
    };

    command.creation_flags(CREATE_NEW_CONSOLE);

    match command.spawn() {
        Ok(_) => Ok(()),
        Err(e) if kind == TerminalKind::WindowsTerminal => {
            log::warn!("wt.exe failed ({e}); falling back to standard powershell.exe");
            let mut fallback = Command::new("powershell.exe");
            fallback.arg("-NoLogo");
            if keep_open {
                fallback.arg("-NoExit");
            }
            fallback
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-EncodedCommand")
                .arg(&b64_script)
                .creation_flags(CREATE_NEW_CONSOLE);

            fallback.spawn().map_err(|source| ConsoleError::Spawn {
                terminal: "powershell.exe".to_string(),
                source,
            })?;
            Ok(())
        }
        Err(source) => Err(ConsoleError::Spawn {
            terminal: kind.executable().to_string(),
            source,
        }),
    }
}

/// Non-Windows builds cannot open a PowerShell console.
#[cfg(not(windows))]
fn spawn(
    _kind: TerminalKind,
    _title: &str,
    _script: &str,
    _keep_open: bool,
) -> Result<(), ConsoleError> {
    Err(ConsoleError::UnsupportedPlatform)
}

/// Opens an interactive SSH console for a profile.
pub fn open_ssh_console(
    profile: &SshProfile,
    settings: &AppSettings,
) -> Result<ConsoleLaunch, ConsoleError> {
    let title = format!("Tunnex — {} ({})", profile.name, profile.host);
    let script = ssh_script(profile, settings, &title);
    spawn(settings.terminal, &title, &script, settings.keep_console_open)?;

    Ok(ConsoleLaunch {
        terminal: settings.terminal.executable().to_string(),
        command: ssh_command_line(profile, settings),
        title,
    })
}

/// Opens a local console attached to a forwarded port.
pub fn open_tunnel_console(
    rule: &PortForwardRule,
    profile: &SshProfile,
    settings: &AppSettings,
) -> Result<ConsoleLaunch, ConsoleError> {
    let title = format!("Tunnex — {} (127.0.0.1:{})", rule.name, rule.local_port);
    let script = tunnel_script(rule, profile, &title);
    // A local probe console always stays open, otherwise it would vanish
    // immediately after `Test-NetConnection` finishes.
    spawn(settings.terminal, &title, &script, true)?;

    Ok(ConsoleLaunch {
        terminal: settings.terminal.executable().to_string(),
        command: format!("Test-NetConnection 127.0.0.1 -Port {}", rule.local_port),
        title,
    })
}
