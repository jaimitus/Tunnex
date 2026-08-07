import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

/** Modal window with backdrop, Escape-to-close and an entrance animation. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink-950/75 backdrop-blur-[3px]"
        onMouseDown={onClose}
      />
      <div
        className={cn(
          "anim-pop relative w-full rounded-lg border border-line bg-ink-800 shadow-[0_24px_80px_rgba(0,0,0,0.55)]",
          maxWidth
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-semibold tracking-tight text-fog-100">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-fog-600">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-fog-500 transition-colors hover:bg-ink-700 hover:text-fog-100"
          >
            <X size={16} />
          </button>
        </header>
        <div className="scrollbar-slim max-h-[74vh] overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
