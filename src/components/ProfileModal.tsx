import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Lock, ShieldCheck, TerminalSquare } from "lucide-react";
import { Modal } from "./Modal";
import { Field, Segmented, SwitchRow, inputCls } from "./form";
import { cn } from "../utils/cn";
import { sshCommandLine, uid } from "../lib/format";
import type { AppSettings, SshProfile } from "../types";

interface ProfileModalProps {
  /** Profile being edited; `null` to create a new one. */
  initial: SshProfile | null;
  settings: AppSettings;
  onClose: () => void;
  onSave: (
    profile: SshProfile,
    password?: string,
    passphrase?: string
  ) => Promise<void>;
  /** Saves (if needed) and opens a PowerShell SSH console for this profile. */
  onOpenConsole?: (profile: SshProfile) => void;
}

type AuthMode = "password" | "key_file";

export function ProfileModal({
  initial,
  settings,
  onClose,
  onSave,
  onOpenConsole,
}: ProfileModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(
    initial?.auth_method.type === "key_file" ? "key_file" : "password"
  );
  const [keyPath, setKeyPath] = useState(
    initial?.auth_method.type === "key_file" ? initial.auth_method.path : ""
  );
  const [hasPassphrase, setHasPassphrase] = useState(
    initial?.auth_method.type === "key_file" ? initial.auth_method.has_passphrase : false
  );
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = initial !== null;

  const draftProfile = (): SshProfile => ({
    id: initial?.id ?? uid(),
    name: name.trim() || "Untitled server",
    host: host.trim(),
    port: Number.parseInt(port, 10) || 22,
    username: username.trim(),
    auth_method:
      authMode === "password"
        ? { type: "password" }
        : { type: "key_file", path: keyPath.trim(), has_passphrase: hasPassphrase },
    created_at: initial?.created_at ?? Date.now(),
  });

  const preview = sshCommandLine(draftProfile(), settings);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const nextErrors: Record<string, string> = {};
    const parsedPort = Number.parseInt(port, 10);

    if (!name.trim()) nextErrors.name = "Give this server a recognizable name.";
    if (!host.trim()) nextErrors.host = "Host or IP address is required.";
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      nextErrors.port = "Must be a number between 1 and 65535.";
    }
    if (!username.trim()) nextErrors.username = "Remote username is required.";
    if (authMode === "key_file" && !keyPath.trim()) {
      nextErrors.keyPath = "Enter the absolute path to the private key file.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const profile: SshProfile = { ...draftProfile(), name: name.trim(), port: parsedPort };

    setSaving(true);
    try {
      await onSave(
        profile,
        authMode === "password" && password ? password : undefined,
        authMode === "key_file" && hasPassphrase && passphrase ? passphrase : undefined
      );
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndConnect = async () => {
    const parsedPort = Number.parseInt(port, 10);
    if (!host.trim() || !username.trim() || !Number.isInteger(parsedPort)) {
      setSubmitError("Fill in host, port and username before opening a console.");
      return;
    }
    const profile: SshProfile = { ...draftProfile(), port: parsedPort };
    setSaving(true);
    try {
      await onSave(
        profile,
        authMode === "password" && password ? password : undefined,
        authMode === "key_file" && hasPassphrase && passphrase ? passphrase : undefined
      );
      onOpenConsole?.(profile);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit SSH server" : "New SSH server"}
      subtitle={
        isEdit
          ? `${initial.host}:${initial.port} · created ${new Date(initial.created_at).toLocaleDateString("en-US")}`
          : "credentials are encrypted in the Windows Credential Manager"
      }
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
            placeholder="Production — API"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Host / IP" error={errors.host}>
            <input
              className={cn(inputCls, "font-mono", errors.host && "border-alert-400/60")}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="api.tunnex.io"
            />
          </Field>
          <Field label="Port" error={errors.port}>
            <input
              className={cn(inputCls, "font-mono", errors.port && "border-alert-400/60")}
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="22"
              inputMode="numeric"
            />
          </Field>
        </div>

        <Field label="Username" error={errors.username}>
          <input
            className={cn(inputCls, "font-mono", errors.username && "border-alert-400/60")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="deploy"
          />
        </Field>

        <div>
          <p className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Authentication
          </p>
          <Segmented<AuthMode>
            value={authMode}
            onChange={setAuthMode}
            options={[
              { value: "password", label: "Password", icon: <Lock size={13} /> },
              { value: "key_file", label: "Private key", icon: <KeyRound size={13} /> },
            ]}
          />
        </div>

        {authMode === "password" ? (
          <Field
            label={isEdit ? "Password" : "Password *"}
            hint={
              isEdit
                ? "Leave blank to keep the stored password."
                : "Stored encrypted in the Credential Manager, never in the JSON file."
            }
          >
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "•••••••• (unchanged)" : "SSH password"}
              autoComplete="new-password"
            />
          </Field>
        ) : (
          <>
            <Field
              label="Private key path"
              error={errors.keyPath}
              hint="OpenSSH, PKCS#8 and PEM formats. Read at connection time."
            >
              <input
                className={cn(inputCls, "font-mono", errors.keyPath && "border-alert-400/60")}
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder={"C:\\Users\\you\\.ssh\\id_ed25519"}
              />
            </Field>

            <SwitchRow
              checked={hasPassphrase}
              onChange={setHasPassphrase}
              title="Key is passphrase protected"
              description="The passphrase is stored in the Credential Manager too."
            />

            {hasPassphrase && (
              <Field
                label={isEdit ? "Passphrase" : "Passphrase *"}
                hint={isEdit ? "Leave blank to keep the current one." : undefined}
              >
                <input
                  type="password"
                  className={inputCls}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={isEdit ? "•••••••• (unchanged)" : "private key passphrase"}
                  autoComplete="new-password"
                />
              </Field>
            )}
          </>
        )}

        {/* Console command preview */}
        <div className="rounded-md border border-line bg-ink-900/70 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-fog-600">
            <TerminalSquare size={11} />
            PowerShell command
          </p>
          <p className="truncate font-mono text-[11.5px] text-warn-300" title={preview}>
            {preview}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-[11px] text-fog-600">
            <ShieldCheck size={13} className="text-live-400" />
            No plaintext secrets
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-fog-300 transition-colors hover:border-line-strong hover:bg-ink-750 hover:text-fog-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndConnect}
              disabled={saving}
              title="Save the server and open a PowerShell SSH session"
              className="flex items-center gap-1.5 rounded-md border border-signal-500/50 bg-signal-500/10 px-3.5 py-2 text-[12.5px] font-medium text-signal-300 transition-colors hover:bg-signal-500/20 disabled:opacity-60"
            >
              <TerminalSquare size={13} />
              Save &amp; open console
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-signal-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 shadow-[0_2px_14px_rgba(255,102,54,0.25)] transition-all hover:bg-signal-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {isEdit ? "Save changes" : "Add server"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
