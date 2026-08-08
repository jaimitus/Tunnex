import {
  Database,
  Layers,
  Pencil,
  Plus,
  Server,
  Settings,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { PortForwardRule, SshProfile, TunnelStatus } from "../types";
import { isTauri } from "../services/api";

export type View = { kind: "all" } | { kind: "profile"; id: string };

interface SidebarProps {
  profiles: SshProfile[];
  rules: PortForwardRule[];
  statuses: Record<string, TunnelStatus>;
  view: View;
  onSelectView: (view: View) => void;
  onNewProfile: () => void;
  onEditProfile: (profile: SshProfile) => void;
  onDeleteProfile: (profile: SshProfile) => void;
  onOpenConsole: (profile: SshProfile) => void;
  onOpenSettings: () => void;
  onOpenStorage: () => void;
}

type DotKind = "live" | "warn" | "alert" | "idle";

/** Aggregated server state derived from the state of its tunnels. */
function profileDot(
  profileId: string,
  rules: PortForwardRule[],
  statuses: Record<string, TunnelStatus>
): DotKind {
  const owned = rules.filter((r) => r.profile_id === profileId);
  const states = owned.map((r) => statuses[r.id]?.state ?? "inactive");
  if (states.includes("active")) return "live";
  if (states.includes("connecting") || states.includes("stopping")) return "warn";
  if (states.includes("error")) return "alert";
  return "idle";
}

function Dot({ kind, small }: { kind: DotKind; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full",
        small ? "h-1.5 w-1.5" : "h-2 w-2",
        kind === "live" && "dot-pulse bg-live-400",
        kind === "warn" && "animate-pulse bg-warn-400",
        kind === "alert" && "bg-alert-400",
        kind === "idle" && "bg-fog-600/70"
      )}
    />
  );
}

/** Tunnex logo: tunnel ring + data arrow. */
function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-ink-750)" />
      <rect
        width="31"
        height="31"
        x="0.5"
        y="0.5"
        rx="7.5"
        fill="none"
        stroke="var(--color-line-strong)"
        strokeOpacity="0.6"
      />
      <circle cx="12" cy="16" r="6.2" fill="none" stroke="var(--color-signal-500)" strokeWidth="2.3" />
      <circle cx="12" cy="16" r="2.1" fill="none" stroke="var(--color-signal-500)" strokeWidth="1.3" opacity="0.5" />
      <path d="M14.5 16h10" stroke="var(--color-link-400)" strokeWidth="2.3" strokeLinecap="round" />
      <path
        d="M21.5 12.6l4.2 3.4-4.2 3.4"
        fill="none"
        stroke="var(--color-link-400)"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  profiles,
  rules,
  statuses,
  view,
  onSelectView,
  onNewProfile,
  onEditProfile,
  onDeleteProfile,
  onOpenConsole,
  onOpenSettings,
  onOpenStorage,
}: SidebarProps) {
  const totalActive = Object.values(statuses).filter(
    (s) => s.state === "active" || s.state === "connecting"
  ).length;

  return (
    <aside className="relative z-10 flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-ink-850/85 backdrop-blur-sm">
      {/* Brand header */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <Logo />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold leading-none tracking-[0.22em] text-fog-100">
            TUNNEX
          </p>
          <p className="mt-1 font-mono text-[10px] leading-none text-fog-600">
            ssh tunnel manager
          </p>
        </div>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fog-500">
          v1.0
        </span>
      </div>

      {/* Navigation */}
      <nav className="scrollbar-slim flex-1 overflow-y-auto px-3 py-3">
        <button
          type="button"
          onClick={() => onSelectView({ kind: "all" })}
          className={cn(
            "group relative flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors duration-150",
            view.kind === "all"
              ? "bg-ink-700/80 text-fog-100"
              : "text-fog-300 hover:bg-ink-750 hover:text-fog-100"
          )}
        >
          {view.kind === "all" && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal-500" />
          )}
          <Layers size={15} className={cn(view.kind === "all" ? "text-signal-400" : "text-fog-500")} />
          <span className="flex-1 text-[13px] font-medium">All tunnels</span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none",
              totalActive > 0
                ? "border-live-500/40 text-live-300"
                : "border-line text-fog-500"
            )}
          >
            {totalActive}/{rules.length}
          </span>
        </button>

        <p className="mb-1.5 mt-5 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-fog-600">
          Servers
        </p>

        {profiles.length === 0 && (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-fog-600">
            No servers yet. Add your first SSH host to start forwarding ports.
          </p>
        )}

        <ul className="space-y-0.5">
          {profiles.map((profile) => {
            const selected = view.kind === "profile" && view.id === profile.id;
            const ownedRules = rules.filter((r) => r.profile_id === profile.id);
            const activeCount = ownedRules.filter(
              (r) => statuses[r.id]?.state === "active"
            ).length;
            const dot = profileDot(profile.id, rules, statuses);

            return (
              <li key={profile.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelectView({ kind: "profile", id: profile.id })}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors duration-150",
                    selected ? "bg-ink-700/80" : "hover:bg-ink-750"
                  )}
                >
                  {selected && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal-500" />
                  )}
                  <Dot kind={dot} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13px] font-medium leading-tight",
                        selected ? "text-fog-100" : "text-fog-300 group-hover:text-fog-100"
                      )}
                    >
                      {profile.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 font-mono text-[10.5px] leading-none text-fog-600">
                      <Server size={10} className="shrink-0" />
                      <span className="truncate">
                        {profile.host}:{profile.port}
                      </span>
                    </span>
                  </span>

                  {/* Counter swaps for quick actions on hover */}
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none transition-opacity group-hover:hidden",
                      activeCount > 0
                        ? "border-live-500/40 text-live-300"
                        : "border-line text-fog-500"
                    )}
                  >
                    {activeCount}/{ownedRules.length}
                  </span>
                  <span className="hidden items-center gap-0.5 group-hover:flex">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Open PowerShell SSH console for ${profile.name}`}
                      title="Open PowerShell (ssh)"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenConsole(profile);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onOpenConsole(profile);
                        }
                      }}
                      className="rounded p-1 text-fog-500 transition-colors hover:bg-signal-500/15 hover:text-signal-300"
                    >
                      <TerminalSquare size={12} />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit ${profile.name}`}
                      title="Edit server"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditProfile(profile);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onEditProfile(profile);
                        }
                      }}
                      className="rounded p-1 text-fog-500 transition-colors hover:bg-ink-700 hover:text-fog-100"
                    >
                      <Pencil size={12} />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete ${profile.name}`}
                      title="Delete server"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProfile(profile);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onDeleteProfile(profile);
                        }
                      }}
                      className="rounded p-1 text-fog-500 transition-colors hover:bg-alert-400/15 hover:text-alert-300"
                    >
                      <Trash2 size={12} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: global actions */}
      <div className="space-y-2 border-t border-line p-3">
        <button
          type="button"
          onClick={onNewProfile}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong py-2 text-[12.5px] font-medium text-fog-500 transition-colors hover:border-signal-500/60 hover:bg-signal-500/5 hover:text-signal-300"
        >
          <Plus size={14} />
          New server
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-[12px] font-medium text-fog-500 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
          >
            <Settings size={13} />
            Settings
          </button>
          <button
            type="button"
            onClick={onOpenStorage}
            className="flex items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-[12px] font-medium text-fog-500 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
          >
            <Database size={13} />
            Storage
          </button>
        </div>

        <div
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px]",
            isTauri
              ? "border-live-500/30 bg-live-500/5 text-live-300"
              : "border-warn-400/30 bg-warn-400/5 text-warn-300"
          )}
        >
          <Dot kind={isTauri ? "live" : "warn"} small />
          <span>{isTauri ? "v1.0.0 · NATIVE ENGINE" : "DEMO MODE"}</span>
        </div>
      </div>
    </aside>
  );
}
