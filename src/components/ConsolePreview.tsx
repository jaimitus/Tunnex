import { useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../utils/cn";
import type { ConsoleLaunch } from "../types";
import { isTauri } from "../services/api";

interface ConsolePreviewProps {
  launch: ConsoleLaunch;
  onClose: () => void;
}

/**
 * Shows the PowerShell window Tunnex spawned (or would spawn in browser demo
 * mode), rendered as a faithful console mock with a copy-to-clipboard action.
 */
export function ConsolePreview({ launch, onClose }: ConsolePreviewProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(launch.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      title={isTauri ? "PowerShell console launched" : "PowerShell console (preview)"}
      subtitle={`${launch.terminal} · ${launch.title}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        {!isTauri && (
          <p className="rounded-md border border-warn-400/40 bg-warn-400/5 px-3 py-2 text-[12px] leading-snug text-warn-300">
            Browser demo: Tunnex cannot spawn native windows here. This is the
            exact console the packaged Windows build opens.
          </p>
        )}

        {/* Console chrome */}
        <div className="overflow-hidden rounded-md border border-line-strong bg-[#012456] shadow-[0_18px_50px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#0b1c3d] px-3 py-1.5">
            <TerminalSquare size={13} className="text-white/60" />
            <span className="truncate font-mono text-[11px] text-white/80">
              {launch.title}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-sm bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-sm bg-[#e81123]/70" />
            </span>
          </div>
          <pre className="scrollbar-slim overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-[#eeedf0]">
            <span className="bg-[#c19c00] px-1 font-semibold text-black">
              {" TUNNEX "}
            </span>
            {"\n"}
            <span className="text-[#3a96dd]">{launch.title}</span>
            {"\n\n"}
            <span className="text-[#c19c00]">PS C:\Users\you&gt; </span>
            <span className="text-[#eeedf0]">{launch.command}</span>
            {"\n"}
            <span className="text-white/45">
              {isTauri
                ? "  session running in its own window…"
                : "  (this command runs for real in the native Windows build)"}
            </span>
            <span className="caret-blink ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] bg-[#eeedf0]" />
          </pre>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11.5px] leading-snug text-fog-600">
            The window is independent from Tunnex: closing the app leaves your
            shell untouched.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12.5px] font-medium transition-colors",
                copied
                  ? "border-live-500/50 bg-live-500/10 text-live-300"
                  : "border-line text-fog-300 hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
              )}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy command"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 transition-all hover:bg-signal-400 active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
