/**
 * Production Backend API integration for Tunnex.
 *
 * All operations call native Tauri Rust commands via `@tauri-apps/api/core` (`invoke`)
 * and listen to real-time events via `@tauri-apps/api/event` (`listen`).
 * No mock/simulated code exists here.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AppSettings,
  ConsoleLaunch,
  PortForwardRule,
  SshProfile,
  StorageInfo,
  TunnelStatus,
} from "../types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StatusListener = (status: TunnelStatus) => void;
type ConsoleListener = (launch: ConsoleLaunch) => void;

export const api = {
  /**
   * Initializes backend resources if required.
   * Auto-start rules are handled directly on app startup in Rust main.rs.
   */
  async init(): Promise<void> {
    // Rust setup handles autostart natively when running inside Tauri.
  },

  async getProfiles(): Promise<SshProfile[]> {
    return invoke<SshProfile[]>("get_profiles");
  },

  async saveProfile(
    profile: SshProfile,
    password?: string,
    passphrase?: string
  ): Promise<SshProfile> {
    return invoke<SshProfile>("save_profile", {
      profile,
      password: password ?? null,
      passphrase: passphrase ?? null,
    });
  },

  async deleteProfile(profileId: string): Promise<string[]> {
    return invoke<string[]>("delete_profile", { profileId });
  },

  async getRules(): Promise<PortForwardRule[]> {
    return invoke<PortForwardRule[]>("get_rules");
  },

  async saveRule(rule: PortForwardRule): Promise<PortForwardRule> {
    return invoke<PortForwardRule>("save_rule", { rule });
  },

  async deleteRule(ruleId: string): Promise<string> {
    return invoke<string>("delete_rule", { ruleId });
  },

  async toggleTunnel(ruleId: string): Promise<TunnelStatus> {
    return invoke<TunnelStatus>("toggle_tunnel", { ruleId });
  },

  async restartTunnel(ruleId: string): Promise<TunnelStatus> {
    return invoke<TunnelStatus>("restart_tunnel", { ruleId });
  },

  async getActiveTunnelsStatuses(): Promise<TunnelStatus[]> {
    return invoke<TunnelStatus[]>("get_active_tunnels_status");
  },

  /** Opens a Windows PowerShell window running `ssh` against a profile. */
  async openSshConsole(profileId: string): Promise<ConsoleLaunch> {
    return invoke<ConsoleLaunch>("open_ssh_console", { profileId });
  },

  /** Opens a local PowerShell window pointed at a forwarded port. */
  async openTunnelConsole(ruleId: string): Promise<ConsoleLaunch> {
    return invoke<ConsoleLaunch>("open_tunnel_console", { ruleId });
  },

  async previewSshCommand(profileId: string): Promise<string> {
    return invoke<string>("preview_ssh_command", { profileId });
  },

  async getSettings(): Promise<AppSettings> {
    return invoke<AppSettings>("get_settings");
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    return invoke<AppSettings>("save_settings", { settings });
  },

  async getStorageInfo(): Promise<StorageInfo> {
    return invoke<StorageInfo>("get_storage_info");
  },

  /** Opens the default web browser pointed at the specified URL. */
  async openInBrowser(url: string): Promise<void> {
    if (isTauri) {
      return invoke("open_in_browser", { url });
    } else {
      window.open(url, "_blank");
    }
  },

  /** No-op in production build. */
  async resetDemo(): Promise<void> {
    // Production native build does not use demo datasets.
  },

  /** Subscribes to tunnel status changes from Rust. Returns the unlisten function. */
  async onStatus(listener: StatusListener): Promise<() => void> {
    const unlisten = await listen<TunnelStatus>("tunnel-status", (event) =>
      listener(event.payload)
    );
    return () => unlisten();
  },

  /** Subscribes to console launches from Rust. Returns the unlisten function. */
  async onConsole(listener: ConsoleListener): Promise<() => void> {
    const unlisten = await listen<ConsoleLaunch>("console-launched", (event) =>
      listener(event.payload)
    );
    return () => unlisten();
  },
};
