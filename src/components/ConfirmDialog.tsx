import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { useState } from "react";

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);

  const handleConfirm = async () => {
    setWorking(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md border border-alert-400/40 bg-alert-400/10 p-1.5 text-alert-300">
          <AlertTriangle size={15} />
        </span>
        <p className="text-[13px] leading-relaxed text-fog-300">{message}</p>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={working}
          className="rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={working}
          className="flex items-center gap-1.5 rounded-md bg-alert-400 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 transition-all hover:bg-alert-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
        >
          {working && <Loader2 size={13} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
