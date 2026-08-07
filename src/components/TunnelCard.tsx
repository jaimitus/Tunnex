import { useEffect, useRef } from "react";
import { ExternalLink, Pencil, RotateCw, Server, TerminalSquare, Trash2, Zap } from "lucide-react";
import { cn } from "../utils/cn";
import { api } from "../services/api";
import type {
  PortForwardRule,
  SshProfile,
  TunnelState,
  TunnelStatus,
} from "../types";
import { fmtBytes, fmtUptime } from "../lib/format";

const STATE_META: Record<TunnelState, { label: string; chip: string; dot: string }> = {
  inactive: {
    label: "Inactive",
    chip: "border-line text-fog-500",
    dot: "bg-fog-600",
  },
  connecting: {
    label: "Connecting…",
    chip: "border-warn-400/40 bg-warn-400/10 text-warn-300",
    dot: "animate-pulse bg-warn-400",
  },
  active: {
    label: "Active",
    chip: "border-live-500/40 bg-live-500/10 text-live-300",
    dot: "dot-pulse bg-live-400",
  },
  stopping: {
    label: "Stopping…",
    chip: "border-link-400/40 bg-link-400/10 text-link-300",
    dot: "animate-pulse bg-link-400",
  },
  error: {
    label: "Error",
    chip: "border-alert-400/40 bg-alert-400/10 text-alert-300",
    dot: "bg-alert-400",
  },
};

/** Throughput mini-chart (bytes received per tick). */
function Sparkline({ data, id }: { data: number[]; id: string }) {
  const width = 100;
  const height = 26;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((value, i) => {
    const x = i * step;
    const y = height - 2 - (value / max) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = points.join(" ");
  const area = `M0,${height} L${line.replace(/ /g, " L")} L${width},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-live-400)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-live-400)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {data.length > 1 && (
        <>
          <path d={area} fill={`url(#spark-${id})`} />
          <polyline
            points={line}
            fill="none"
            stroke="var(--color-live-400)"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

/** Connector between the local and remote endpoints, with travelling packets. */
function Connector({ state }: { state: TunnelState }) {
  const lineCls =
    state === "active"
      ? "border-live-500/60"
      : state === "connecting"
        ? "animate-pulse border-warn-400/60"
        : state === "error"
          ? "border-alert-400/60"
          : state === "stopping"
            ? "border-link-400/60"
            : "border-ink-600";
  const arrowFill =
    state === "active"
      ? "fill-live-400"
      : state === "connecting"
        ? "fill-warn-400"
        : state === "error"
          ? "fill-alert-400"
          : state === "stopping"
            ? "fill-link-400"
            : "fill-ink-600";

  return (
    <div className="relative mx-2.5 h-4 min-w-[56px] flex-1 md:min-w-[84px]">
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 border-t-2 border-dashed transition-colors duration-300",
          lineCls
        )}
      />
      {state === "active" &&
        [0, 1, 2].map((i) => (
          <span key={i} className="packet-dot" style={{ animationDelay: `${i * 0.55}s` }} />
        ))}
      <svg
        className="absolute -right-0.5 top-1/2 -translate-y-1/2"
        width="8"
        height="10"
        viewBox="0 0 8 10"
        aria-hidden="true"
      >
        <path d="M0 0 L8 5 L0 10 Z" className={cn("transition-colors duration-300", arrowFill)} />
      </svg>
    </div>
  );
}

function Endpoint({
  label,
  value,
  side,
  onOpenBrowser,
}: {
  label: string;
  value: string;
  side: "local" | "remote";
  onOpenBrowser?: () => void;
}) {
  return (
    <div
      onClick={side === "local" ? onOpenBrowser : undefined}
      className={cn(
        "min-w-0 shrink rounded-md border bg-ink-850 px-2.5 py-1.5 transition-colors",
        side === "local"
          ? "border-signal-500/35 cursor-pointer hover:border-signal-500/80 hover:bg-signal-500/5"
          : "border-link-400/35"
      )}
      title={side === "local" ? `Click to open http://${value} in browser` : value}
    >
      <div className="flex items-center justify-between gap-1">
        <p
          className={cn(
            "font-mono text-[9px] font-medium uppercase tracking-[0.16em]",
            side === "local" ? "text-signal-400" : "text-link-400"
          )}
        >
          {label}
        </p>
        {side === "local" && <ExternalLink size={9} className="text-signal-400 opacity-70" />}
      </div>
      <p className="truncate font-mono text-[12.5px] font-medium text-fog-100" title={value}>
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-fog-600">
        {label}
      </p>
      <p className={cn("mt-0.5 truncate font-mono text-[13px] font-medium", tone ?? "text-fog-100")}>
        {value}
      </p>
    </div>
  );
}

interface TunnelCardProps {
  rule: PortForwardRule;
  profile?: SshProfile;
  status: TunnelStatus;
  index: number;
  onToggle: (rule: PortForwardRule) => void;
  onRestart: (rule: PortForwardRule) => void;
  onEdit: (rule: PortForwardRule) => void;
  onDelete: (rule: PortForwardRule) => void;
  onConsole: (rule: PortForwardRule) => void;
}

export function TunnelCard({
  rule,
  profile,
  status,
  index,
  onToggle,
  onRestart,
  onEdit,
  onDelete,
  onConsole,
}: TunnelCardProps) {
  const meta = STATE_META[status.state];
  const active = status.state === "active";
  const busy = status.state === "connecting" || status.state === "stopping";
  const showingStats = status.state !== "inactive";

  const handleOpenBrowser = () => {
    const url = `http://127.0.0.1:${rule.local_port}`;
    api.openInBrowser(url);
  };

  // Throughput history for the sparkline (delta of received bytes per event).
  const historyRef = useRef<number[]>([]);
  const lastReceivedRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (lastReceivedRef.current !== null) {
        const delta = Math.max(0, status.bytes_received - lastReceivedRef.current);
        historyRef.current = [...historyRef.current.slice(-39), delta];
      }
      lastReceivedRef.current = status.bytes_received;
    } else if (status.state === "inactive" || status.state === "error") {
      historyRef.current = [];
      lastReceivedRef.current = null;
    }
  }, [status.bytes_received, status.state, active]);

  const iconBtn =
    "rounded-md p-1.5 text-fog-500 opacity-70 transition-all hover:bg-ink-700 hover:text-fog-100 hover:opacity-100";

  return (
    <article
      className={cn(
        "anim-rise group relative rounded-lg border bg-ink-800/95 p-4 transition-all duration-200",
        "hover:-translate-y-[2px] hover:shadow-[0_12px_38px_rgba(0,0,0,0.42)]",
        active
          ? "border-live-500/30 hover:border-live-500/50"
          : status.state === "error"
            ? "border-alert-400/40 hover:border-alert-400/60"
            : status.state === "connecting" || status.state === "stopping"
              ? "border-warn-400/25 hover:border-line-strong"
              : "border-line hover:border-line-strong"
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      {/* Power line on top while the tunnel is alive */}
      {(active || status.state === "error") && (
        <span
          className={cn(
            "pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
            active ? "via-live-400/80" : "via-alert-400/70"
          )}
        />
      )}

      {/* Name + toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold leading-tight text-fog-100">
            <span className="truncate">{rule.name}</span>
            {rule.auto_start && (
              <span className="flex shrink-0 items-center gap-0.5 rounded border border-line px-1 py-px font-mono text-[9px] uppercase tracking-wider text-fog-500">
                <Zap size={9} />
                auto
              </span>
            )}
          </h3>
          <p className="mt-1 flex items-center gap-1 font-mono text-[10.5px] text-fog-500">
            <Server size={10} className="shrink-0 text-fog-600" />
            <span className="truncate">
              {profile
                ? `${profile.name} · ${profile.username}@${profile.host}`
                : "profile deleted"}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggle(rule)}
          disabled={busy}
          aria-pressed={active}
          aria-label={active ? `Stop ${rule.name}` : `Start ${rule.name}`}
          title={active ? "Stop tunnel" : "Start tunnel"}
          className={cn(
            "relative mt-0.5 h-[22px] w-[40px] shrink-0 rounded-full border transition-all duration-300",
            active
              ? "border-live-500/70 bg-live-500/90 shadow-[0_0_14px_rgba(74,223,160,0.35)]"
              : busy
                ? "cursor-wait border-warn-400/60 bg-warn-400/70"
                : "border-line-strong bg-ink-700 hover:border-fog-600"
          )}
        >
          <span
            className={cn(
              "absolute top-[2.5px] h-[15px] w-[15px] rounded-full transition-all duration-300",
              active
                ? "left-[21px] bg-ink-950"
                : busy
                  ? "left-[11px] animate-pulse bg-ink-950/70"
                  : "left-[3px] bg-fog-500"
            )}
          />
        </button>
      </div>

      {/* Port map */}
      <div className="mt-4 flex items-center">
        <Endpoint
          label="Local"
          value={`127.0.0.1:${rule.local_port}`}
          side="local"
          onOpenBrowser={handleOpenBrowser}
        />
        <Connector state={status.state} />
        <Endpoint label="Remote" value={`${rule.remote_host}:${rule.remote_port}`} side="remote" />
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3">
        <Stat
          label="In"
          value={showingStats ? `↓ ${fmtBytes(status.bytes_received)}` : "—"}
          tone={active ? "text-live-300" : undefined}
        />
        <Stat
          label="Out"
          value={showingStats ? `↑ ${fmtBytes(status.bytes_sent)}` : "—"}
          tone={active ? "text-link-300" : undefined}
        />
        <Stat label="Conns" value={showingStats ? String(status.connections) : "—"} />
        <Stat label="Uptime" value={active ? fmtUptime(status.started_at) : "—"} />
      </div>

      {/* Traffic sparkline */}
      {historyRef.current.length > 1 && (
        <div className="mt-2">
          <Sparkline data={historyRef.current} id={rule.id} />
        </div>
      )}

      {/* Error */}
      {status.error && (
        <p className="mt-3 rounded-md border border-alert-400/30 bg-alert-400/10 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-alert-300">
          » {status.error}
        </p>
      )}

      {/* Footer: state + actions */}
      <div className="mt-3.5 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            meta.chip
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleOpenBrowser}
            className={cn(
              iconBtn,
              active ? "hover:bg-live-500/20 hover:text-live-300 opacity-90 text-live-400" : "hover:bg-link-400/15 hover:text-link-300"
            )}
            title={`Open http://127.0.0.1:${rule.local_port} in browser`}
            aria-label={`Open http://127.0.0.1:${rule.local_port} in browser`}
          >
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            onClick={() => onConsole(rule)}
            className={cn(iconBtn, "hover:bg-signal-500/15 hover:text-signal-300")}
            title="Open PowerShell console"
            aria-label={`Open PowerShell console for ${rule.name}`}
          >
            <TerminalSquare size={13} />
          </button>
          {(active || status.state === "error") && (
            <button
              type="button"
              onClick={() => onRestart(rule)}
              className={iconBtn}
              title="Restart tunnel"
              aria-label={`Restart ${rule.name}`}
            >
              <RotateCw size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(rule)}
            className={iconBtn}
            title="Edit rule"
            aria-label={`Edit ${rule.name}`}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule)}
            className={cn(iconBtn, "hover:bg-alert-400/15 hover:text-alert-300")}
            title="Delete rule"
            aria-label={`Delete ${rule.name}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
