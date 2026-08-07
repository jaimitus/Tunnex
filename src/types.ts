/**
 * Frontend types, paired 1:1 with the Rust models
 * (`src-tauri/src/models.rs`). Any change must be mirrored in both files.
 */

/** SSH authentication method (enum tagged by `type`, matching serde). */
export type AuthMethod =
  | { type: "password" }
  | { type: "key_file"; path: string; has_passphrase: boolean };

/** SSH connection profile (a "server"). */
export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  created_at: number;
}

/** Port forwarding rule: 127.0.0.1:local_port -> remote_host:remote_port. */
export interface PortForwardRule {
  id: string;
  profile_id: string;
  name: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
}

/** Tunnel lifecycle state. */
export type TunnelState =
  | "inactive"
  | "connecting"
  | "active"
  | "stopping"
  | "error";

/** Real time tunnel status (delivered by the `tunnel-status` event). */
export interface TunnelStatus {
  rule_id: string;
  state: TunnelState;
  bytes_sent: number;
  bytes_received: number;
  connections: number;
  started_at: number | null;
  error: string | null;
}

/** Terminal host used when Tunnex opens a console window. */
export type TerminalKind =
  | "windows_powershell"
  | "powershell_core"
  | "windows_terminal";

/** Global application preferences. */
export interface AppSettings {
  open_console_on_connect: boolean;
  terminal: TerminalKind;
  keep_console_open: boolean;
  accept_new_host_keys: boolean;
}

/** Result of spawning a console window. */
export interface ConsoleLaunch {
  terminal: string;
  command: string;
  title: string;
}

/** Persistence details shown in the storage panel. */
export interface StorageInfo {
  config_path: string;
  keyring_service: string;
  profiles: number;
  rules: number;
  active_tunnels: number;
  mock_mode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  open_console_on_connect: true,
  terminal: "windows_powershell",
  keep_console_open: true,
  accept_new_host_keys: true,
};

export const TERMINAL_LABELS: Record<TerminalKind, string> = {
  windows_powershell: "Windows PowerShell",
  powershell_core: "PowerShell 7 (pwsh)",
  windows_terminal: "Windows Terminal",
};

export const TERMINAL_EXECUTABLES: Record<TerminalKind, string> = {
  windows_powershell: "powershell.exe",
  powershell_core: "pwsh.exe",
  windows_terminal: "wt.exe",
};

export const INACTIVE_STATUS = (ruleId: string): TunnelStatus => ({
  rule_id: ruleId,
  state: "inactive",
  bytes_sent: 0,
  bytes_received: 0,
  connections: 0,
  started_at: null,
  error: null,
});
