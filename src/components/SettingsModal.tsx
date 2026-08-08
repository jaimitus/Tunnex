import { useEffect, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  KeySquare,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { Modal } from "./Modal";
import { Segmented, SwitchRow } from "./form";
import { cn } from "../utils/cn";
import { api, isTauri } from "../services/api";
import type { AppSettings, StorageInfo, TerminalKind } from "../types";
import { TERMINAL_EXECUTABLES, TERMINAL_LABELS } from "../types";

export type SettingsTab = "console" | "storage";

interface SettingsModalProps {
  settings: AppSettings;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onResetDemo: () => Promise<void>;
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-ink-900/60 px-3 py-2.5">
      <span className="mt-0.5 text-fog-500">{icon}</span>
      <div className="min-w-0">
        <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog-600">
          {label}
        </p>
        <div className="mt-0.5 break-all font-mono text-[12px] leading-relaxed text-fog-300">
          {value}
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({
  settings,
  initialTab = "console",
  onClose,
  onSaveSettings,
  onResetDemo,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getStorageInfo()
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveSettings(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await onResetDemo();
      onClose();
    } finally {
      setResetting(false);
    }
  };

  return (
    <Modal
      title="Settings"
      subtitle="console behaviour, storage location and credential protection"
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-5">
        <Segmented<SettingsTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "console", label: "Console", icon: <TerminalSquare size={13} /> },
            { value: "storage", label: "Storage", icon: <HardDrive size={13} /> },
          ]}
        />

        {error && (
          <p className="rounded-md border border-alert-400/40 bg-alert-400/10 px-3 py-2 text-[12px] text-alert-300">
            {error}
          </p>
        )}

        {tab === "console" ? (
          <>
            <section className="space-y-2">
              <h3 className="font-display text-[13px] font-semibold text-fog-100">
                Terminal host
              </h3>
              <Segmented<TerminalKind>
                value={draft.terminal}
                onChange={(terminal) => setDraft({ ...draft, terminal })}
                columns={3}
                options={(Object.keys(TERMINAL_LABELS) as TerminalKind[]).map((kind) => ({
                  value: kind,
                  label: TERMINAL_LABELS[kind],
                }))}
              />
              <p className="font-mono text-[11px] text-fog-600">
                spawns{" "}
                <span className="text-signal-300">
                  {TERMINAL_EXECUTABLES[draft.terminal]}
                </span>{" "}
                with CREATE_NEW_CONSOLE
              </p>
            </section>

            <section className="space-y-2">
              <SwitchRow
                checked={draft.open_console_on_connect}
                onChange={(open_console_on_connect) =>
                  setDraft({ ...draft, open_console_on_connect })
                }
                title="Open PowerShell when a tunnel connects"
                description="As soon as the SSH session is up, Tunnex launches an interactive ssh window for that host."
              />
              <SwitchRow
                checked={draft.keep_console_open}
                onChange={(keep_console_open) => setDraft({ ...draft, keep_console_open })}
                title="Keep the window open after the session ends"
                description="Adds -NoExit so you can read the output when ssh disconnects."
              />
              <SwitchRow
                checked={draft.accept_new_host_keys}
                onChange={(accept_new_host_keys) =>
                  setDraft({ ...draft, accept_new_host_keys })
                }
                title="Accept new host keys automatically"
                description="Passes -o StrictHostKeyChecking=accept-new so first-time hosts do not block the prompt."
              />
            </section>

            <section className="rounded-md border border-line bg-ink-900/70 px-3 py-2.5">
              <p className="mb-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog-600">
                Example command
              </p>
              <p className="font-mono text-[11.5px] leading-relaxed text-warn-300">
                ssh -p 2222{" "}
                {draft.accept_new_host_keys ? "-o StrictHostKeyChecking=accept-new " : ""}
                ops@staging.eu.tunnex.io
              </p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h3 className="mb-2 font-display text-[13px] font-semibold text-fog-100">
                Runtime mode
              </h3>
              <div
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2.5",
                  isTauri
                    ? "border-live-500/40 bg-live-500/5"
                    : "border-warn-400/40 bg-warn-400/5"
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    isTauri ? "dot-pulse bg-live-400" : "animate-pulse bg-warn-400"
                  )}
                />
                <p className="text-[12.5px] leading-snug text-fog-300">
                  {isTauri ? (
                    <>
                      <span className="font-semibold text-live-300">Native (Tauri v2).</span>{" "}
                      Real SSH tunnels through <span className="font-mono">russh</span> +{" "}
                      <span className="font-mono">tokio</span>; credentials stored in the
                      Windows Credential Manager.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-warn-300">Browser demo.</span>{" "}
                      The tunnel engine and PowerShell launcher are simulated so you can
                      explore the interface. Run{" "}
                      <span className="font-mono">npx tauri dev</span> for the real thing.
                    </>
                  )}
                </p>
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-[13px] font-semibold text-fog-100">
                <HardDrive size={14} className="text-signal-400" />
                Storage
              </h3>

              {!info && !error && (
                <div className="space-y-2">
                  <div className="skeleton h-[52px] rounded-md" />
                  <div className="skeleton h-[52px] rounded-md" />
                </div>
              )}

              {info && (
                <div className="space-y-2">
                  <InfoRow
                    icon={<FolderOpen size={14} />}
                    label="Configuration file"
                    value={info.config_path}
                  />
                  <InfoRow
                    icon={<KeySquare size={14} />}
                    label="Credentials (passwords and passphrases)"
                    value={
                      <>
                        Windows Credential Manager · service{" "}
                        <span className="text-signal-300">{info.keyring_service}</span>
                      </>
                    }
                  />
                  <InfoRow
                    icon={<Info size={14} />}
                    label="Current contents"
                    value={
                      <>
                        {info.profiles} profiles · {info.rules} rules ·{" "}
                        <span className={info.active_tunnels > 0 ? "text-live-300" : undefined}>
                          {info.active_tunnels} active tunnels
                        </span>
                      </>
                    }
                  />
                </div>
              )}
            </section>

            <section className="flex items-start gap-2.5 rounded-md border border-line bg-ink-850 px-3 py-2.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-live-400" />
              <p className="text-[11.5px] leading-relaxed text-fog-500">
                <span className="font-mono text-fog-300">config.json</span> only holds
                hosts, ports and names. Passwords and passphrases are never written to
                disk in plaintext: they are delegated to Windows DPAPI through the
                Credential Manager.
              </p>
            </section>

            {!isTauri && (
              <section className="rounded-md border border-alert-400/30 bg-alert-400/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-[13px] font-semibold text-alert-300">
                      Demo zone
                    </h3>
                    <p className="mt-0.5 text-[11.5px] text-fog-500">
                      Restore profiles, rules and statuses to the sample dataset.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetting}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-alert-400/50 px-3 py-1.5 text-[12px] font-medium text-alert-300 transition-colors hover:bg-alert-400/15 disabled:opacity-60"
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="font-mono text-[10.5px] leading-relaxed text-fog-600">
            Tunnex v1.0.0 · Tauri v2 + Rust · React 19 · Windows 10/11 x64
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                api.openInBrowser("https://github.com/jaimitus/Tunnex");
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-ink-800 px-2.5 py-1.5 text-[11.5px] font-medium text-fog-200 transition-all hover:border-signal-500/50 hover:bg-ink-700 hover:text-signal-300 cursor-pointer pointer-events-auto"
              title="Open GitHub Repository"
            >
              <span>GitHub</span>
              <ExternalLink size={11} className="opacity-70" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3.5 py-1.5 text-[12px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex items-center gap-1.5 rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 transition-all hover:bg-signal-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save settings
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
