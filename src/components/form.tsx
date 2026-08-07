import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/** Base class shared by every form control. */
export const inputCls =
  "w-full rounded-md border border-line bg-ink-900 px-3 py-2 text-[13px] text-fog-100 placeholder:text-fog-600 outline-none transition-colors focus:border-signal-500/70 focus:ring-2 focus:ring-signal-500/15";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/** Label + control + error/hint, using the monospaced console aesthetic. */
export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] leading-snug text-alert-300">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] leading-snug text-fog-600">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  columns?: number;
}

/** Segmented control (e.g. Password | Private key). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  columns,
}: SegmentedProps<T>) {
  return (
    <div
      className="grid gap-0.5 rounded-md border border-line bg-ink-900 p-0.5"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150",
            value === option.value
              ? "bg-ink-700 text-fog-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              : "text-fog-500 hover:text-fog-300"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SwitchRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}

/** Row with a switch, used for auto-start, passphrase and settings toggles. */
export function SwitchRow({ checked, onChange, title, description }: SwitchRowProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center justify-between gap-4 rounded-md border border-line bg-ink-900 px-3 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fog-100">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-fog-600">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "relative h-[20px] w-[36px] shrink-0 rounded-full border transition-colors duration-200",
          checked ? "border-live-500/60 bg-live-500/80" : "border-line-strong bg-ink-700"
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all duration-200",
            checked ? "left-[18px] bg-ink-950" : "left-[2px] bg-fog-500"
          )}
        />
      </span>
    </button>
  );
}
