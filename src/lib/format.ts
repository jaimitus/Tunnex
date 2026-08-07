/** Shared formatters used across the dashboard. */

import type { AppSettings, SshProfile } from "../types";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 1234567 -> "1.2 MB" */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

/** bytes per second -> "84.2 KB/s" */
export function fmtRate(bytesPerSecond: number): string {
  return `${fmtBytes(bytesPerSecond)}/s`;
}

/** epoch ms -> "02:14:09" or "3d 04:12" */
export function fmtUptime(startedAt: number | null): string {
  if (startedAt === null) return "—";
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Date -> "14:03:52" */
export function fmtClock(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** epoch ms -> "Mar 12, 2026" */
export function fmtDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "127.0.0.1:5432" */
export function fmtEndpoint(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Builds the `ssh` command line for a profile — mirrors
 * `console::ssh_command_line` in the Rust backend so the UI can preview
 * exactly what will run inside the PowerShell window.
 */
export function sshCommandLine(profile: SshProfile, settings: AppSettings): string {
  const parts: string[] = ["ssh"];
  if (profile.port !== 22) parts.push("-p", String(profile.port));
  if (profile.auth_method.type === "key_file" && profile.auth_method.path.trim()) {
    const path = profile.auth_method.path;
    parts.push("-i", path.includes(" ") ? `"${path}"` : path);
  }
  if (settings.accept_new_host_keys) {
    parts.push("-o", "StrictHostKeyChecking=accept-new");
  }
  parts.push(`${profile.username}@${profile.host}`);
  return parts.join(" ");
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
