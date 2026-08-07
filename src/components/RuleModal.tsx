import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { Field, SwitchRow, inputCls } from "./form";
import { cn } from "../utils/cn";
import { uid } from "../lib/format";
import type { PortForwardRule, SshProfile } from "../types";

interface RuleModalProps {
  /** Rule being edited; `null` to create a new one. */
  initial: PortForwardRule | null;
  profiles: SshProfile[];
  rules: PortForwardRule[];
  defaultProfileId?: string;
  onClose: () => void;
  onSave: (rule: PortForwardRule) => Promise<void>;
}

export function RuleModal({
  initial,
  profiles,
  rules,
  defaultProfileId,
  onClose,
  onSave,
}: RuleModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [profileId, setProfileId] = useState(
    initial?.profile_id ?? defaultProfileId ?? profiles[0]?.id ?? ""
  );
  const [localPort, setLocalPort] = useState(String(initial?.local_port ?? ""));
  const [remoteHost, setRemoteHost] = useState(initial?.remote_host ?? "");
  const [remotePort, setRemotePort] = useState(String(initial?.remote_port ?? ""));
  const [autoStart, setAutoStart] = useState(initial?.auto_start ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = initial !== null;

  const validatePort = (raw: string): number | null => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
    return parsed;
  };

  const privilegedWarning =
    validatePort(localPort) !== null && Number(localPort) <= 1024
      ? "Privileged port (≤ 1024): Tunnex must run as administrator to bind it."
      : undefined;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const nextErrors: Record<string, string> = {};
    const parsedLocal = validatePort(localPort);
    const parsedRemote = validatePort(remotePort);

    if (!name.trim()) nextErrors.name = "Give this rule a name.";
    if (!profileId) nextErrors.profile = "Select the SSH server.";
    if (parsedLocal === null) nextErrors.localPort = "Port between 1 and 65535.";
    if (!remoteHost.trim()) nextErrors.remoteHost = "Remote host is required.";
    if (parsedRemote === null) nextErrors.remotePort = "Port between 1 and 65535.";

    if (parsedLocal !== null) {
      const conflict = rules.find(
        (r) => r.local_port === parsedLocal && r.id !== initial?.id
      );
      if (conflict) {
        nextErrors.localPort = `Port ${parsedLocal} is already used by “${conflict.name}”.`;
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedLocal === null || parsedRemote === null) {
      return;
    }

    const rule: PortForwardRule = {
      id: initial?.id ?? uid(),
      profile_id: profileId,
      name: name.trim(),
      local_port: parsedLocal,
      remote_host: remoteHost.trim(),
      remote_port: parsedRemote,
      auto_start: autoStart,
    };

    setSaving(true);
    try {
      await onSave(rule);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (profiles.length === 0) {
    return (
      <Modal
        title="New forwarding rule"
        subtitle="at least one SSH server is required"
        onClose={onClose}
        maxWidth="max-w-md"
      >
        <p className="text-[13px] leading-relaxed text-fog-300">
          Port forwarding rules travel through an SSH tunnel, so you need a
          server first. Close this dialog and press{" "}
          <span className="font-mono text-signal-300">New server</span> in the
          sidebar.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={isEdit ? "Edit forwarding rule" : "New forwarding rule"}
      subtitle="127.0.0.1:<local> → <remote> through the SSH tunnel"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError && (
          <p className="rounded-md border border-alert-400/40 bg-alert-400/10 px-3 py-2 text-[12px] leading-snug text-alert-300">
            {submitError}
          </p>
        )}

        <Field label="Name" error={errors.name}>
          <input
            className={cn(inputCls, errors.name && "border-alert-400/60")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PostgreSQL Production"
            autoFocus
          />
        </Field>

        <Field label="SSH server" error={errors.profile}>
          <select
            className={cn(inputCls, "appearance-none", errors.profile && "border-alert-400/60")}
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id} className="bg-ink-800">
                {profile.name} — {profile.host}:{profile.port}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-[110px_1fr_110px] items-start gap-3">
          <Field label="Local port" error={errors.localPort} hint={privilegedWarning}>
            <input
              className={cn(inputCls, "font-mono", errors.localPort && "border-alert-400/60")}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="5432"
              inputMode="numeric"
            />
          </Field>
          <Field label="Remote host" error={errors.remoteHost}>
            <input
              className={cn(inputCls, "font-mono", errors.remoteHost && "border-alert-400/60")}
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
              placeholder="db.prod.internal"
            />
          </Field>
          <Field label="Remote port" error={errors.remotePort}>
            <input
              className={cn(inputCls, "font-mono", errors.remotePort && "border-alert-400/60")}
              value={remotePort}
              onChange={(e) => setRemotePort(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="5432"
              inputMode="numeric"
            />
          </Field>
        </div>

        <p className="rounded-md border border-line bg-ink-900/70 px-3 py-2 font-mono text-[11px] text-fog-500">
          <span className="text-signal-400">127.0.0.1:{localPort || "····"}</span>
          <span className="mx-1.5 text-fog-600">→</span>
          <span className="text-link-400">
            {remoteHost || "remote-host"}:{remotePort || "····"}
          </span>
        </p>

        <SwitchRow
          checked={autoStart}
          onChange={setAutoStart}
          title="Start automatically"
          description="This tunnel comes up on its own when Tunnex launches."
        />

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 shadow-[0_2px_14px_rgba(255,102,54,0.25)] transition-all hover:bg-signal-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? "Save rule" : "Create rule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
