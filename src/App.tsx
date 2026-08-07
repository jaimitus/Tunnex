import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Info,
  Network,
  Plus,
  Search,
  Server,
  TerminalSquare,
  X,
} from "lucide-react";
import { Sidebar, type View } from "./components/Sidebar";
import { TunnelCard } from "./components/TunnelCard";
import { ProfileModal } from "./components/ProfileModal";
import { RuleModal } from "./components/RuleModal";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ConsolePreview } from "./components/ConsolePreview";
import { api, isTauri } from "./services/api";
import { DEFAULT_SETTINGS, INACTIVE_STATUS } from "./types";
import type {
  AppSettings,
  ConsoleLaunch,
  PortForwardRule,
  SshProfile,
  TunnelStatus,
} from "./types";
import { fmtBytes, fmtClock, uid } from "./lib/format";
import { cn } from "./utils/cn";

/* ─────────────────────────────── UI types ─────────────────────────────── */

interface Toast {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}

interface ConfirmState {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  action: () => Promise<void>;
}

type ProfileModalState =
  | { mode: "create" }
  | { mode: "edit"; profile: SshProfile }
  | null;

type RuleModalState =
  | { mode: "create"; defaultProfileId?: string }
  | { mode: "edit"; rule: PortForwardRule }
  | null;

/* ─────────────────────────────── Small parts ──────────────────────────── */

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="tabular-nums">
      {fmtClock(now)}
      <span className="caret-blink ml-1.5 inline-block h-[10px] w-[5px] translate-y-[1px] bg-signal-500" />
    </span>
  );
}

function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "anim-pop pointer-events-auto flex items-start gap-2.5 rounded-md border bg-ink-800 px-3.5 py-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.5)]",
            toast.kind === "success" && "border-live-500/40",
            toast.kind === "error" && "border-alert-400/50",
            toast.kind === "info" && "border-link-400/40"
          )}
        >
          {toast.kind === "success" && (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-live-400" />
          )}
          {toast.kind === "error" && (
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-alert-400" />
          )}
          {toast.kind === "info" && <Info size={15} className="mt-0.5 shrink-0 text-link-400" />}
          <p className="flex-1 text-[12.5px] leading-snug text-fog-100">{toast.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 text-fog-600 transition-colors hover:text-fog-100"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-line bg-ink-800/60 p-4">
          <div className="flex items-center justify-between">
            <div className="skeleton h-4 w-40 rounded" />
            <div className="skeleton h-[22px] w-[40px] rounded-full" />
          </div>
          <div className="skeleton mt-4 h-11 rounded-md" />
          <div className="skeleton mt-4 h-8 rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  hasProfiles,
  onCreateRule,
  onCreateProfile,
}: {
  hasProfiles: boolean;
  onCreateRule: () => void;
  onCreateProfile: () => void;
}) {
  return (
    <div className="anim-rise flex flex-col items-center justify-center py-24 text-center">
      <svg width="150" height="72" viewBox="0 0 150 72" aria-hidden="true" className="mb-5">
        <circle cx="30" cy="36" r="20" fill="none" stroke="var(--color-ink-600)" strokeWidth="2" strokeDasharray="5 5" />
        <circle cx="30" cy="36" r="8" fill="none" stroke="var(--color-signal-500)" strokeWidth="2" opacity="0.55" />
        <path d="M44 36h72" stroke="var(--color-ink-600)" strokeWidth="2" strokeDasharray="6 6" />
        <path d="M112 28l12 8-12 8" fill="none" stroke="var(--color-link-400)" strokeWidth="2" opacity="0.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="132" cy="36" r="3.5" fill="var(--color-ink-600)" />
      </svg>
      <h2 className="font-display text-[19px] font-semibold text-fog-100">
        No tunnels in this view
      </h2>
      <p className="mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-fog-500">
        Create a forwarding rule to expose a remote service on your
        <span className="font-mono text-fog-300"> 127.0.0.1</span> through the SSH tunnel.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onCreateRule}
          disabled={!hasProfiles}
          className="flex items-center gap-1.5 rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 shadow-[0_2px_14px_rgba(255,102,54,0.25)] transition-all hover:bg-signal-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} />
          New rule
        </button>
        {!hasProfiles && (
          <button
            type="button"
            onClick={onCreateProfile}
            className="rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
          >
            Add a server first
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────── App ─────────────────────────────────── */

export default function App() {
  const [profiles, setProfiles] = useState<SshProfile[] | null>(null);
  const [rules, setRules] = useState<PortForwardRule[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, TunnelStatus>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [profileModal, setProfileModal] = useState<ProfileModalState>(null);
  const [ruleModal, setRuleModal] = useState<RuleModalState>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [consoleLaunch, setConsoleLaunch] = useState<ConsoleLaunch | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = uid();
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4600);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* Initial load + event subscriptions */
  useEffect(() => {
    let alive = true;
    let unlistenStatus: (() => void) | null = null;
    let unlistenConsole: (() => void) | null = null;

    (async () => {
      const unStatus = await api.onStatus((status) => {
        setStatuses((prev) => ({ ...prev, [status.rule_id]: status }));
      });
      const unConsole = await api.onConsole((launch) => {
        if (isTauri) {
          pushToast("success", `${launch.terminal} opened › ${launch.command}`);
        } else {
          setConsoleLaunch(launch);
        }
      });
      if (!alive) {
        unStatus();
        unConsole();
        return;
      }
      unlistenStatus = unStatus;
      unlistenConsole = unConsole;

      const [loadedProfiles, loadedRules, loadedSettings] = await Promise.all([
        api.getProfiles(),
        api.getRules(),
        api.getSettings(),
      ]);
      if (!alive) return;
      setProfiles(loadedProfiles);
      setRules(loadedRules);
      setSettings(loadedSettings);

      const snapshot = await api.getActiveTunnelsStatuses();
      if (!alive) return;
      setStatuses(Object.fromEntries(snapshot.map((s) => [s.rule_id, s])));

      await api.init();
    })().catch((error) => {
      if (!alive) return;
      setProfiles([]);
      setRules([]);
      pushToast("error", `Could not load the configuration: ${String(error)}`);
    });

    return () => {
      alive = false;
      unlistenStatus?.();
      unlistenConsole?.();
    };
  }, [pushToast]);

  /* ── Derived state ── */

  const loading = profiles === null || rules === null;

  const viewProfile = useMemo(() => {
    if (view.kind !== "profile" || !profiles) return null;
    return profiles.find((p) => p.id === view.id) ?? null;
  }, [view, profiles]);

  const visibleRules = useMemo(() => {
    const all = rules ?? [];
    const byView =
      view.kind === "all" ? all : all.filter((r) => r.profile_id === view.id);
    const q = query.trim().toLowerCase();
    if (!q) return byView;
    return byView.filter((rule) => {
      const profile = profiles?.find((p) => p.id === rule.profile_id);
      return [
        rule.name,
        rule.remote_host,
        String(rule.local_port),
        String(rule.remote_port),
        profile?.name ?? "",
        profile?.host ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rules, view, query, profiles]);

  const stats = useMemo(() => {
    const values = Object.values(statuses);
    return {
      active: values.filter((s) => s.state === "active" || s.state === "connecting").length,
      received: values.reduce((acc, s) => acc + s.bytes_received, 0),
      sent: values.reduce((acc, s) => acc + s.bytes_sent, 0),
      connections: values.reduce((acc, s) => acc + s.connections, 0),
    };
  }, [statuses]);

  const statusFor = useCallback(
    (ruleId: string): TunnelStatus => statuses[ruleId] ?? INACTIVE_STATUS(ruleId),
    [statuses]
  );

  /* ── Actions ── */

  const mergeStatus = useCallback((status: TunnelStatus) => {
    setStatuses((prev) => ({ ...prev, [status.rule_id]: status }));
  }, []);

  const handleToggle = useCallback(
    async (rule: PortForwardRule) => {
      try {
        mergeStatus(await api.toggleTunnel(rule.id));
      } catch (error) {
        pushToast("error", `Could not toggle “${rule.name}”: ${String(error)}`);
      }
    },
    [mergeStatus, pushToast]
  );

  const handleRestart = useCallback(
    async (rule: PortForwardRule) => {
      try {
        mergeStatus(await api.restartTunnel(rule.id));
        pushToast("info", `Restarting “${rule.name}”…`);
      } catch (error) {
        pushToast("error", `Could not restart “${rule.name}”: ${String(error)}`);
      }
    },
    [mergeStatus, pushToast]
  );

  /** Opens a Windows PowerShell window with an interactive SSH session. */
  const handleProfileConsole = useCallback(
    async (profile: SshProfile) => {
      try {
        const launch = await api.openSshConsole(profile.id);
        if (isTauri) {
          pushToast("success", `${launch.terminal} opened › ${launch.command}`);
        } else {
          setConsoleLaunch(launch);
        }
      } catch (error) {
        pushToast("error", `Could not open the console: ${String(error)}`);
      }
    },
    [pushToast]
  );

  /** Opens a local PowerShell window pointed at the forwarded port. */
  const handleRuleConsole = useCallback(
    async (rule: PortForwardRule) => {
      try {
        const launch = await api.openTunnelConsole(rule.id);
        if (isTauri) {
          pushToast("success", `${launch.terminal} opened › ${launch.command}`);
        } else {
          setConsoleLaunch(launch);
        }
      } catch (error) {
        pushToast("error", `Could not open the console: ${String(error)}`);
      }
    },
    [pushToast]
  );

  const handleSaveProfile = useCallback(
    async (profile: SshProfile, password?: string, passphrase?: string) => {
      const saved = await api.saveProfile(profile, password, passphrase);
      setProfiles((prev) => {
        const list = prev ?? [];
        const exists = list.some((p) => p.id === saved.id);
        return exists ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved];
      });
      pushToast("success", `Server “${saved.name}” saved.`);
    },
    [pushToast]
  );

  const requestDeleteProfile = useCallback(
    (profile: SshProfile) => {
      const ownedRules = (rules ?? []).filter((r) => r.profile_id === profile.id);
      setConfirm({
        title: "Delete server",
        confirmLabel: "Delete server",
        message: (
          <>
            Delete <span className="font-semibold text-fog-100">“{profile.name}”</span>?
            {ownedRules.length > 0 && (
              <>
                {" "}
                Its{" "}
                <span className="font-mono text-signal-300">{ownedRules.length}</span>{" "}
                {ownedRules.length === 1 ? "tunnel rule" : "tunnel rules"} will be stopped
                and removed, along with its credentials in the Credential Manager.
              </>
            )}
          </>
        ),
        action: async () => {
          const removedIds = await api.deleteProfile(profile.id);
          setProfiles((prev) => (prev ?? []).filter((p) => p.id !== profile.id));
          setRules((prev) => (prev ?? []).filter((r) => r.profile_id !== profile.id));
          setStatuses((prev) => {
            const next = { ...prev };
            removedIds.forEach((id) => delete next[id]);
            return next;
          });
          setView((prev) =>
            prev.kind === "profile" && prev.id === profile.id ? { kind: "all" } : prev
          );
          pushToast("success", `Server “${profile.name}” deleted.`);
        },
      });
    },
    [rules, pushToast]
  );

  const handleSaveRule = useCallback(
    async (rule: PortForwardRule) => {
      const saved = await api.saveRule(rule);
      setRules((prev) => {
        const list = prev ?? [];
        const exists = list.some((r) => r.id === saved.id);
        return exists ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved];
      });
      pushToast("success", `Rule “${saved.name}” saved.`);
    },
    [pushToast]
  );

  const requestDeleteRule = useCallback(
    (rule: PortForwardRule) => {
      setConfirm({
        title: "Delete rule",
        confirmLabel: "Delete rule",
        message: (
          <>
            Delete <span className="font-semibold text-fog-100">“{rule.name}”</span>? If the
            tunnel is running it stops immediately and local port{" "}
            <span className="font-mono text-signal-300">{rule.local_port}</span> is released.
          </>
        ),
        action: async () => {
          await api.deleteRule(rule.id);
          setRules((prev) => (prev ?? []).filter((r) => r.id !== rule.id));
          setStatuses((prev) => {
            const next = { ...prev };
            delete next[rule.id];
            return next;
          });
          pushToast("success", `Rule “${rule.name}” deleted.`);
        },
      });
    },
    [pushToast]
  );

  const handleSaveSettings = useCallback(
    async (next: AppSettings) => {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      pushToast("success", "Settings saved.");
    },
    [pushToast]
  );

  const handleResetDemo = useCallback(async () => {
    await api.resetDemo();
    const [freshProfiles, freshRules, freshStatuses, freshSettings] = await Promise.all([
      api.getProfiles(),
      api.getRules(),
      api.getActiveTunnelsStatuses(),
      api.getSettings(),
    ]);
    setProfiles(freshProfiles);
    setRules(freshRules);
    setSettings(freshSettings);
    setStatuses(Object.fromEntries(freshStatuses.map((s) => [s.rule_id, s])));
    setView({ kind: "all" });
    pushToast("success", "Demo data restored.");
  }, [pushToast]);

  /* ── Render ── */

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="app-backdrop" aria-hidden="true" />

      <Sidebar
        profiles={profiles ?? []}
        rules={rules ?? []}
        statuses={statuses}
        view={view}
        onSelectView={setView}
        onNewProfile={() => setProfileModal({ mode: "create" })}
        onEditProfile={(profile) => setProfileModal({ mode: "edit", profile })}
        onDeleteProfile={requestDeleteProfile}
        onOpenConsole={handleProfileConsole}
        onOpenSettings={() => setSettingsTab("console")}
        onOpenStorage={() => setSettingsTab("storage")}
      />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="border-b border-line bg-ink-850/50 px-6 pb-4 pt-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-display text-[24px] font-bold tracking-tight text-fog-100">
                {view.kind === "all" ? "All tunnels" : viewProfile?.name ?? "Server"}
              </h1>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-fog-500">
                {view.kind === "all" ? (
                  <>
                    <Network size={11} />
                    {(rules ?? []).length} rules · {(profiles ?? []).length} servers
                  </>
                ) : viewProfile ? (
                  <>
                    <Server size={11} />
                    {viewProfile.username}@{viewProfile.host}:{viewProfile.port}
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fog-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search rule, port, host…"
                  className="w-52 rounded-md border border-line bg-ink-800 py-2 pl-8 pr-3 text-[12.5px] text-fog-100 placeholder:text-fog-600 outline-none transition-colors focus:border-signal-500/60 focus:ring-2 focus:ring-signal-500/15"
                />
              </div>

              {viewProfile && (
                <button
                  type="button"
                  onClick={() => handleProfileConsole(viewProfile)}
                  title={`Open PowerShell and SSH into ${viewProfile.host}`}
                  className="flex items-center gap-1.5 rounded-md border border-signal-500/50 bg-signal-500/10 px-3.5 py-2 text-[12.5px] font-medium text-signal-300 transition-colors hover:bg-signal-500/20"
                >
                  <TerminalSquare size={14} />
                  PowerShell
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setRuleModal({
                    mode: "create",
                    defaultProfileId: view.kind === "profile" ? view.id : undefined,
                  })
                }
                className="flex items-center gap-1.5 rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 shadow-[0_2px_14px_rgba(255,102,54,0.25)] transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                <Plus size={14} />
                Rule
              </button>
              <button
                type="button"
                onClick={() => setProfileModal({ mode: "create" })}
                className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
              >
                <Plus size={14} />
                Server
              </button>
            </div>
          </div>

          {/* Global telemetry strip */}
          <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-md border border-line bg-ink-900/55 px-4 py-2.5">
            <span className="flex items-center gap-2 font-mono text-[12px]">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  stats.active > 0 ? "dot-pulse bg-live-400" : "bg-fog-600/70"
                )}
              />
              <span className={stats.active > 0 ? "text-live-300" : "text-fog-500"}>
                {stats.active} ACTIVE
              </span>
            </span>
            <span className="flex items-center gap-2 font-mono text-[12px] text-fog-300">
              <ArrowDownToLine size={12} className="text-live-400" />
              <span className="text-fog-600">IN</span>
              {fmtBytes(stats.received)}
            </span>
            <span className="flex items-center gap-2 font-mono text-[12px] text-fog-300">
              <ArrowUpFromLine size={12} className="text-link-400" />
              <span className="text-fog-600">OUT</span>
              {fmtBytes(stats.sent)}
            </span>
            <span className="flex items-center gap-2 font-mono text-[12px] text-fog-300">
              <Activity size={12} className="text-signal-400" />
              <span className="text-fog-600">CONNS</span>
              {stats.connections}
            </span>
            <span className="ml-auto hidden items-center gap-2 font-mono text-[11px] text-fog-600 lg:flex">
              <TerminalSquare size={11} />
              console on connect:{" "}
              <span className={settings.open_console_on_connect ? "text-live-300" : "text-fog-500"}>
                {settings.open_console_on_connect ? "ON" : "OFF"}
              </span>
            </span>
          </div>
        </header>

        {/* Content */}
        <div className="scrollbar-slim flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <SkeletonGrid />
          ) : visibleRules.length === 0 ? (
            <EmptyState
              hasProfiles={(profiles ?? []).length > 0}
              onCreateRule={() => setRuleModal({ mode: "create" })}
              onCreateProfile={() => setProfileModal({ mode: "create" })}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visibleRules.map((rule, index) => (
                <TunnelCard
                  key={rule.id}
                  rule={rule}
                  profile={profiles?.find((p) => p.id === rule.profile_id)}
                  status={statusFor(rule.id)}
                  index={index}
                  onToggle={handleToggle}
                  onRestart={handleRestart}
                  onEdit={(r) => setRuleModal({ mode: "edit", rule: r })}
                  onDelete={requestDeleteRule}
                  onConsole={handleRuleConsole}
                />
              ))}
            </div>
          )}
        </div>

        {/* Status bar */}
        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-line bg-ink-850/80 px-4 font-mono text-[10.5px] text-fog-600">
          <span>
            tunnex v1.1.0 ·{" "}
            {isTauri ? (
              <span className="text-live-300">native russh/tokio engine</span>
            ) : (
              <span className="text-warn-300">simulated engine (demo)</span>
            )}
          </span>
          <span className="flex items-center gap-3">
            <span>config: %APPDATA%/tunnex/config.json</span>
            <Clock />
          </span>
        </footer>
      </main>

      {/* Modals */}
      {profileModal && (
        <ProfileModal
          initial={profileModal.mode === "edit" ? profileModal.profile : null}
          settings={settings}
          onClose={() => setProfileModal(null)}
          onSave={handleSaveProfile}
          onOpenConsole={handleProfileConsole}
        />
      )}

      {ruleModal && (
        <RuleModal
          initial={ruleModal.mode === "edit" ? ruleModal.rule : null}
          profiles={profiles ?? []}
          rules={rules ?? []}
          defaultProfileId={
            ruleModal.mode === "create" ? ruleModal.defaultProfileId : undefined
          }
          onClose={() => setRuleModal(null)}
          onSave={handleSaveRule}
        />
      )}

      {settingsTab && (
        <SettingsModal
          settings={settings}
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
          onSaveSettings={handleSaveSettings}
          onResetDemo={handleResetDemo}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}

      {consoleLaunch && (
        <ConsolePreview launch={consoleLaunch} onClose={() => setConsoleLaunch(null)} />
      )}

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
