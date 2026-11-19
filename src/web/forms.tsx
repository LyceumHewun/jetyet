import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Radio,
  Repeat,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { api } from "./client";
import {
  BrandMark,
  BrushWord,
  Confirm,
  Field,
  SwitchField,
} from "./components";
import type { Row, State } from "./types";

const reservedNodeNames = new Set([
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "PASS",
  "COMPATIBLE",
]);

function toDatetimeLocal(iso: string | null | undefined): string {
  const ms = Date.parse(iso || "");
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : "";
}

function fromDatetimeLocal(val: string): string | null {
  if (!val) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)
    ? val + ":00Z"
    : val.endsWith("Z")
      ? val
      : val + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function inferQuotaUnit(limit: unknown): string {
  if (typeof limit === "number" && Number.isInteger(limit) && limit > 0) {
    if (limit % 1024 ** 4 === 0) return "TiB";
    if (limit % 1024 ** 3 === 0) return "GiB";
    if (limit % 1e9 === 0) return "GB";
  }
  return "GiB";
}

function focusFirstInvalid(form: HTMLFormElement) {
  const invalid = form.querySelector<HTMLElement>(
    ":invalid, [aria-invalid='true']",
  );
  invalid?.focus();
}

export const newQuota = () => ({
  limit: null as number | null,
  direction: "both",
  reset: { kind: "monthly", day: 1, hour: 0 } as Row,
});

export function Login({ onLogin }: { onLogin: (name: string) => void }) {
  const [name, setName] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-page">
      <div className="ambient-backdrop" aria-hidden="true" />
      <div className="login-shell">
        <section className="login-hero" aria-label="About Jetyet">
          <div className="login-brand-row">
            <BrandMark size="lg" />
            <span className="pill-tag">HYSTERIA 2 · MIHOMO</span>
          </div>

          <div className="login-hero-copy">
            <h1>
              Private VPN control,{" "}
              <BrushWord>without the clutter.</BrushWord>
            </h1>
            <p className="hero-lead">
              Verify VPS SSH keys explicitly, deploy native Hysteria 2 nodes,
              and share individual mihomo subscription links with friends.
            </p>
          </div>

          <div className="login-story-card">
            <div className="story-head">
              <span className="story-dots" aria-hidden="true">
                <i className="dot-r" />
                <i className="dot-y" />
                <i className="dot-g" />
              </span>
              <span className="mono">Guided deployment flow</span>
            </div>
            <ol className="hero-flow" aria-label="How Jetyet works">
              <li>
                <span className="flow-medallion orchid" aria-hidden="true">
                  <Server size={18} />
                </span>
                <div>
                  <strong>1. Onboard VPS & trust SSH</strong>
                  <span className="flow-desc">
                    Inspect SHA-256 host key before any remote execution
                  </span>
                </div>
              </li>
              <li>
                <span className="flow-medallion lavender" aria-hidden="true">
                  <Radio size={18} />
                </span>
                <div>
                  <strong>2. Plan & deploy Hysteria 2</strong>
                  <span className="flow-desc">
                    Automated SSH deploy or manual root script + detection
                  </span>
                </div>
              </li>
              <li>
                <span className="flow-medallion good" aria-hidden="true">
                  <Users size={18} />
                </span>
                <div>
                  <strong>3. Share mihomo subscriptions</strong>
                  <span className="flow-desc">
                    Per-user allowances, node sets, and one-click link copy
                  </span>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <main className="login-panel">
          <form
            className="login-card"
            aria-labelledby="login-heading"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!e.currentTarget.checkValidity()) {
                e.currentTarget.reportValidity();
                focusFirstInvalid(e.currentTarget);
                return;
              }
              setBusy(true);
              setError("");
              api("login", "POST", { username: name, password })
                .then((x) => onLogin(x.username))
                .catch((err) => setError(err.message))
                .finally(() => setBusy(false));
            }}
          >
            <p className="eyebrow">ADMINISTRATOR ACCESS</p>
            <h2 id="login-heading">Sign in</h2>
            <p className="login-subtitle">Open your control workspace.</p>

            <Field
              label="Username"
              htmlFor="login-username"
              required
              errorText="Enter your administrator username."
              errorId="login-username-err"
            >
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                required
                autoFocus
                data-error="login-username-err"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field
              label="Password"
              htmlFor="login-password"
              required
              errorText="Enter your administrator password."
              errorId="login-password-err"
            >
              <div className="password-wrap">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  data-error="login-password-err"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff size={20} aria-hidden="true" />
                  ) : (
                    <Eye size={20} aria-hidden="true" />
                  )}
                </button>
              </div>
            </Field>

            {error && (
              <p className="form-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}

            <button
              type="submit"
              className="primary login-submit"
              disabled={busy}
            >
              <span>{busy ? "Signing in…" : "Sign in"}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </button>

            <small className="login-footnote">
              Credentials are configured in your server config file.
            </small>
          </form>
        </main>
      </div>
    </div>
  );
}

export function QuotaFields({
  value,
  onChange,
}: {
  value: Row;
  onChange: (q: Row) => void;
}) {
  const uid = useId();
  const safeValue = value || newQuota();
  const [unit, setUnit] = useState(() => inferQuotaUnit(safeValue.limit));
  const factor = unit === "GB" ? 1e9 : unit === "TiB" ? 1024 ** 4 : 1024 ** 3;
  const reset = safeValue.reset || { kind: "monthly", day: 1, hour: 0 };

  return (
    <fieldset className="form-section">
      <legend>Traffic allowance</legend>
      <div className="form-grid">
        <Field
          label="Limit"
          htmlFor={`${uid}-limit`}
          hint="Empty means unlimited. Zero blocks all counted traffic."
          hintId={`${uid}-limit-hint`}
          errorText="Enter a non-negative allowance or leave empty for unlimited."
          errorId={`${uid}-limit-err`}
          className="full"
        >
          <div className="input-combo">
            <input
              id={`${uid}-limit`}
              type="number"
              min="0"
              step="any"
              placeholder="Unlimited"
              aria-describedby={`${uid}-limit-hint`}
              data-error={`${uid}-limit-err`}
              value={safeValue.limit === null ? "" : safeValue.limit / factor}
              onChange={(e) =>
                onChange({
                  ...safeValue,
                  limit:
                    e.target.value === ""
                      ? null
                      : Math.round(Number(e.target.value) * factor),
                })
              }
            />
            <select
              aria-label="Allowance unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="GiB">GiB</option>
              <option value="TiB">TiB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </Field>

        <fieldset className="radio-fieldset full">
          <legend>Counted direction</legend>
          <p className="field-hint">
            Measured from the VPS network perspective.
          </p>
          <div className="segmented-grid three">
            {(
              [
                ["both", "Both", ArrowUpDown],
                ["out", "Outbound", ArrowUp],
                ["in", "Inbound", ArrowDown],
              ] as const
            ).map(([dir, label, Icon]) => (
              <label key={dir} className="segment-option">
                <input
                  type="radio"
                  name={`${uid}-direction`}
                  value={dir}
                  checked={safeValue.direction === dir}
                  onChange={() => onChange({ ...safeValue, direction: dir })}
                />
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="radio-fieldset full">
          <legend>Reset policy</legend>
          <div className="segmented-grid two">
            <label className="segment-option">
              <input
                type="radio"
                name={`${uid}-reset-kind`}
                value="monthly"
                checked={reset.kind === "monthly"}
                onChange={() =>
                  onChange({
                    ...safeValue,
                    reset: { kind: "monthly", day: 1, hour: 0 },
                  })
                }
              />
              <Calendar size={16} aria-hidden="true" />
              <span>Monthly date</span>
            </label>
            <label className="segment-option">
              <input
                type="radio"
                name={`${uid}-reset-kind`}
                value="interval"
                checked={reset.kind === "interval"}
                onChange={() =>
                  onChange({
                    ...safeValue,
                    reset: {
                      kind: "interval",
                      days: 30,
                      anchor: new Date().toISOString(),
                    },
                  })
                }
              />
              <Repeat size={16} aria-hidden="true" />
              <span>Every N days</span>
            </label>
          </div>
        </fieldset>

        {reset.kind === "monthly" ? (
          <>
            <Field
              label="Day of month"
              htmlFor={`${uid}-day`}
              hint="1–31 (clamps to month end)."
              hintId={`${uid}-day-hint`}
              errorText="Enter a day from 1 to 31."
              errorId={`${uid}-day-err`}
              required
            >
              <input
                id={`${uid}-day`}
                type="number"
                min="1"
                max="31"
                required
                aria-describedby={`${uid}-day-hint`}
                data-error={`${uid}-day-err`}
                value={reset.day}
                onChange={(e) =>
                  onChange({
                    ...safeValue,
                    reset: { ...reset, day: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field
              label="Hour (Hong Kong)"
              htmlFor={`${uid}-hour`}
              hint="0–23 in Asia/Hong_Kong."
              hintId={`${uid}-hour-hint`}
              errorText="Enter an hour from 0 to 23."
              errorId={`${uid}-hour-err`}
            >
              <input
                id={`${uid}-hour`}
                type="number"
                min="0"
                max="23"
                aria-describedby={`${uid}-hour-hint`}
                data-error={`${uid}-hour-err`}
                value={reset.hour ?? 0}
                onChange={(e) =>
                  onChange({
                    ...safeValue,
                    reset: { ...reset, hour: Number(e.target.value) },
                  })
                }
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="Interval in days"
              htmlFor={`${uid}-days`}
              errorText="Enter an interval between 1 and 3650 days."
              errorId={`${uid}-days-err`}
              required
            >
              <input
                id={`${uid}-days`}
                type="number"
                min="1"
                max="3650"
                required
                data-error={`${uid}-days-err`}
                value={reset.days}
                onChange={(e) =>
                  onChange({
                    ...safeValue,
                    reset: { ...reset, days: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field
              label="Anchor (UTC)"
              htmlFor={`${uid}-anchor`}
              hint="Schedule reference time in UTC."
              hintId={`${uid}-anchor-hint`}
              errorText="Enter a valid UTC date and time."
              errorId={`${uid}-anchor-err`}
              required
            >
              <input
                id={`${uid}-anchor`}
                type="datetime-local"
                required
                aria-describedby={`${uid}-anchor-hint`}
                data-error={`${uid}-anchor-err`}
                value={toDatetimeLocal(reset.anchor)}
                onChange={(e) =>
                  onChange({
                    ...safeValue,
                    reset: {
                      ...reset,
                      anchor: fromDatetimeLocal(e.target.value) ?? "",
                    },
                  })
                }
              />
            </Field>
          </>
        )}
      </div>
    </fieldset>
  );
}

export function HostFormPanel({
  host,
  onSave,
  onCancel,
  submitLabel,
}: {
  host?: Row;
  onSave: (v: Row) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [data, setData] = useState<Row>(() => ({
    name: "",
    address: "",
    port: 22,
    username: "root",
    authType: "key",
    enabled: true,
    quota: newQuota(),
    initialIn: 0,
    initialOut: 0,
    ...host,
    credential: "",
    passphrase: "",
  }));
  const [showSshSecret, setShowSshSecret] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setData((prev) => ({ ...prev, [k]: v }));
  const changingAuth = Boolean(host && host.authType !== data.authType);
  const credentialRequired = !host || changingAuth;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      focusFirstInvalid(e.currentTarget);
      return;
    }
    if (
      data.quota?.reset?.kind === "interval" &&
      !Number.isFinite(Date.parse(data.quota.reset.anchor || ""))
    ) {
      setError("Anchor (UTC) must be a valid date and time.");
      return;
    }
    setBusy(true);
    onSave(data)
      .catch((err) => setError(err instanceof Error ? err.message : "Save failed"))
      .finally(() => setBusy(false));
  };

  return (
    <form ref={formRef} className="inline-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <Field
          label="Display name"
          htmlFor={`${uid}-name`}
          errorText="Enter a VPS display name."
          errorId={`${uid}-name-err`}
          required
        >
          <input
            id={`${uid}-name`}
            name="name"
            required
            data-error={`${uid}-name-err`}
            placeholder="e.g. Tokyo-01"
            value={data.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field
          label="SSH address"
          htmlFor={`${uid}-address`}
          hint="IPv4, IPv6, or hostname. Changing address resets SSH trust."
          hintId={`${uid}-address-hint`}
          errorText="Enter a valid IP address or hostname."
          errorId={`${uid}-address-err`}
          required
        >
          <input
            id={`${uid}-address`}
            name="address"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${uid}-address-hint`}
            data-error={`${uid}-address-err`}
            placeholder="198.51.100.10"
            value={data.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>

        <Field
          label="SSH port"
          htmlFor={`${uid}-port`}
          errorText="Enter a port between 1 and 65535."
          errorId={`${uid}-port-err`}
          required
        >
          <input
            id={`${uid}-port`}
            name="port"
            type="number"
            min="1"
            max="65535"
            step="1"
            required
            data-error={`${uid}-port-err`}
            value={data.port}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </Field>

        <Field
          label="SSH username"
          htmlFor={`${uid}-username`}
          hint="Non-root users require passwordless sudo."
          hintId={`${uid}-user-hint`}
          errorText="Enter a valid Linux username."
          errorId={`${uid}-user-err`}
          required
        >
          <input
            id={`${uid}-username`}
            name="username"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${uid}-user-hint`}
            data-error={`${uid}-user-err`}
            value={data.username}
            onChange={(e) => set("username", e.target.value)}
          />
        </Field>

        <fieldset className="radio-fieldset full">
          <legend>SSH authentication</legend>
          <div className="segmented-grid two">
            <label className="segment-option">
              <input
                type="radio"
                name={`${uid}-authType`}
                value="key"
                checked={data.authType === "key"}
                onChange={() => set("authType", "key")}
              />
              <KeyRound size={16} aria-hidden="true" />
              <span>Private key</span>
            </label>
            <label className="segment-option">
              <input
                type="radio"
                name={`${uid}-authType`}
                value="password"
                checked={data.authType === "password"}
                onChange={() => set("authType", "password")}
              />
              <Lock size={16} aria-hidden="true" />
              <span>Password</span>
            </label>
          </div>
        </fieldset>

        <Field
          label={data.authType === "key" ? "Private key" : "SSH password"}
          htmlFor={`${uid}-credential`}
          hint={
            host && !changingAuth
              ? "Leave empty to keep the stored encrypted credential."
              : data.authType === "key"
                ? "Paste PEM or OpenSSH private key."
                : "Encrypted at rest with the server master key."
          }
          hintId={`${uid}-cred-hint`}
          errorText={
            data.authType === "key"
              ? "Paste the SSH private key."
              : "Enter the SSH password."
          }
          errorId={`${uid}-cred-err`}
          required={credentialRequired}
          className="full"
        >
          {data.authType === "key" ? (
            <textarea
              id={`${uid}-credential`}
              name="credential"
              rows={4}
              aria-describedby={`${uid}-cred-hint`}
              data-error={`${uid}-cred-err`}
              value={data.credential}
              onChange={(e) => set("credential", e.target.value)}
              required={credentialRequired}
            />
          ) : (
            <div className="password-wrap">
              <input
                id={`${uid}-credential`}
                name="credential"
                type={showSshSecret ? "text" : "password"}
                autoComplete="new-password"
                aria-describedby={`${uid}-cred-hint`}
                data-error={`${uid}-cred-err`}
                value={data.credential}
                onChange={(e) => set("credential", e.target.value)}
                required={credentialRequired}
              />
              <button
                type="button"
                className="password-toggle"
                aria-pressed={showSshSecret}
                aria-label={
                  showSshSecret ? "Hide SSH password" : "Show SSH password"
                }
                onClick={() => setShowSshSecret((v) => !v)}
              >
                {showSshSecret ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </Field>

        {data.authType === "key" && (
          <Field
            label="Key passphrase"
            htmlFor={`${uid}-passphrase`}
            hint="Optional if the private key has no passphrase."
            hintId={`${uid}-pass-hint`}
            className="full"
          >
            <input
              id={`${uid}-passphrase`}
              name="passphrase"
              type="password"
              autoComplete="new-password"
              aria-describedby={`${uid}-pass-hint`}
              value={data.passphrase}
              onChange={(e) => set("passphrase", e.target.value)}
            />
          </Field>
        )}

        <div className="full">
          <SwitchField
            id={`${uid}-enabled`}
            label="VPS enabled"
            detail="Allow VPN services and include host in active management."
            checked={!!data.enabled}
            onChange={(checked) => set("enabled", checked)}
          />
        </div>
      </div>

      <QuotaFields value={data.quota} onChange={(q) => set("quota", q)} />

      {!host && (
        <details className="disclosure-block">
          <summary>Advanced: pre-onboarding traffic baseline</summary>
          <div className="disclosure-body form-grid">
            <Field
              label="Initial inbound bytes"
              htmlFor={`${uid}-initialIn`}
              hint="Bytes already counted by your provider this period."
              hintId={`${uid}-initialIn-hint`}
            >
              <input
                id={`${uid}-initialIn`}
                type="number"
                min="0"
                step="1"
                aria-describedby={`${uid}-initialIn-hint`}
                value={data.initialIn}
                onChange={(e) => set("initialIn", Number(e.target.value))}
              />
            </Field>
            <Field
              label="Initial outbound bytes"
              htmlFor={`${uid}-initialOut`}
              hint="Bytes already counted by your provider this period."
              hintId={`${uid}-initialOut-hint`}
            >
              <input
                id={`${uid}-initialOut`}
                type="number"
                min="0"
                step="1"
                aria-describedby={`${uid}-initialOut-hint`}
                value={data.initialOut}
                onChange={(e) => set("initialOut", Number(e.target.value))}
              />
            </Field>
          </div>
        </details>
      )}

      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel || (host ? "Save VPS settings" : "Save VPS")}
        </button>
      </div>
    </form>
  );
}

export function NodeFormPanel({
  node,
  state,
  lockedHost,
  initialName = "",
  initialAddress = "",
  onSave,
  onCancel,
  submitLabel,
}: {
  node?: Row;
  state: State;
  lockedHost?: Row;
  initialName?: string;
  initialAddress?: string;
  onSave: (v: Row) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const uid = useId();
  const [data, setData] = useState<Row>(() => ({
    hostId:
      lockedHost?.id ||
      node?.hostId ||
      state.hosts.find(
        (h) =>
          h.fingerprint &&
          !h.deleting &&
          !state.nodes.some((n) => n.hostId === h.id),
      )?.id ||
      "",
    name: initialName,
    address: initialAddress,
    port: 443,
    hopping: "",
    hopInterval: 30,
    upMbps: 0,
    downMbps: 0,
    enabled: true,
    ...node,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setData((prev) => ({ ...prev, [k]: v }));

  const eligibleHosts = state.hosts.filter(
    (h) =>
      h.fingerprint &&
      !h.deleting &&
      (h.id === data.hostId || !state.nodes.some((n) => n.hostId === h.id)),
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      focusFirstInvalid(e.currentTarget);
      return;
    }
    if (reservedNodeNames.has(String(data.name || "").trim().toUpperCase())) {
      setError(
        "Node name cannot use a reserved mihomo proxy name (DIRECT, REJECT, PASS, COMPATIBLE).",
      );
      return;
    }
    setBusy(true);
    onSave(data)
      .catch((err) => setError(err instanceof Error ? err.message : "Save failed"))
      .finally(() => setBusy(false));
  };

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        {!lockedHost ? (
          <Field
            label="Trusted VPS"
            htmlFor={`${uid}-hostId`}
            errorText="Select a trusted VPS without an existing node."
            errorId={`${uid}-host-err`}
            required
          >
            <select
              id={`${uid}-hostId`}
              value={data.hostId}
              onChange={(e) => set("hostId", e.target.value)}
              required
              disabled={!!node}
              data-error={`${uid}-host-err`}
            >
              <option value="">Select trusted VPS</option>
              {eligibleHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.address})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="field">
            <span className="label-row">
              <strong>Target VPS</strong>
            </span>
            <div className="static-pill-box">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                {lockedHost.name} · <span className="mono">{lockedHost.address}</span>
              </span>
            </div>
          </div>
        )}

        <Field
          label="Display name"
          htmlFor={`${uid}-name`}
          hint="Appears in client mihomo proxy lists. Avoid DIRECT/REJECT."
          hintId={`${uid}-name-hint`}
          errorText="Enter a unique node display name."
          errorId={`${uid}-name-err`}
          required
        >
          <input
            id={`${uid}-name`}
            required
            aria-describedby={`${uid}-name-hint`}
            data-error={`${uid}-name-err`}
            placeholder="e.g. JP · Tokyo"
            value={data.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field
          label="Advertised IP address"
          htmlFor={`${uid}-address`}
          hint="Public IPv4 or IPv6 literal for client configs."
          hintId={`${uid}-address-hint`}
          errorText="Enter a public IPv4 or IPv6 address."
          errorId={`${uid}-address-err`}
          required
        >
          <input
            id={`${uid}-address`}
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${uid}-address-hint`}
            data-error={`${uid}-address-err`}
            placeholder="203.0.113.22"
            value={data.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>

        <Field
          label="UDP listen port"
          htmlFor={`${uid}-port`}
          errorText="Enter a UDP port between 1 and 65535."
          errorId={`${uid}-port-err`}
          required
        >
          <input
            id={`${uid}-port`}
            type="number"
            min="1"
            max="65535"
            step="1"
            required
            data-error={`${uid}-port-err`}
            value={data.port}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </Field>

        <Field
          label="Port hopping range"
          htmlFor={`${uid}-hopping`}
          hint="Optional, e.g. 20000-50000. Open UDP range in firewall."
          hintId={`${uid}-hopping-hint`}
          errorText="Use start-end port range, e.g. 20000-50000."
          errorId={`${uid}-hopping-err`}
        >
          <input
            id={`${uid}-hopping`}
            pattern="^$|^\d{1,5}-\d{1,5}$"
            placeholder="20000-50000"
            aria-describedby={`${uid}-hopping-hint`}
            data-error={`${uid}-hopping-err`}
            value={data.hopping}
            onChange={(e) => set("hopping", e.target.value)}
          />
        </Field>

        <Field
          label="Hop interval (seconds)"
          htmlFor={`${uid}-hopInterval`}
          errorText="Minimum 5 seconds."
          errorId={`${uid}-hopint-err`}
          required
        >
          <input
            id={`${uid}-hopInterval`}
            type="number"
            min="5"
            max="3600"
            step="1"
            required
            data-error={`${uid}-hopint-err`}
            value={data.hopInterval}
            onChange={(e) => set("hopInterval", Number(e.target.value))}
          />
        </Field>

        <Field
          label="Client upload hint (Mbps)"
          htmlFor={`${uid}-upMbps`}
          hint="0 disables bandwidth hint."
          hintId={`${uid}-up-hint`}
        >
          <input
            id={`${uid}-upMbps`}
            type="number"
            min="0"
            max="100000"
            step="1"
            aria-describedby={`${uid}-up-hint`}
            value={data.upMbps}
            onChange={(e) => set("upMbps", Number(e.target.value))}
          />
        </Field>

        <Field
          label="Client download hint (Mbps)"
          htmlFor={`${uid}-downMbps`}
          hint="0 disables bandwidth hint."
          hintId={`${uid}-down-hint`}
        >
          <input
            id={`${uid}-downMbps`}
            type="number"
            min="0"
            max="100000"
            step="1"
            aria-describedby={`${uid}-down-hint`}
            value={data.downMbps}
            onChange={(e) => set("downMbps", Number(e.target.value))}
          />
        </Field>

        <div className="full">
          <SwitchField
            id={`${uid}-enabled`}
            label="Node enabled"
            detail="Run Hysteria 2 service and include node in user subscriptions."
            checked={!!data.enabled}
            onChange={(checked) => set("enabled", checked)}
          />
        </div>
      </div>

      <p className="notice-banner">
        <Radio size={18} aria-hidden="true" />
        <span>
          Native Hysteria 2 · self-signed cert ·{" "}
          <code>skip-cert-verify</code>. Port or address edits require{" "}
          <strong>Reapply configuration</strong>.
        </span>
      </p>

      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel || (node ? "Save node settings" : "Plan node")}
        </button>
      </div>
    </form>
  );
}

export function UserFormPanel({
  user,
  state,
  includeAccess = true,
  onSave,
  onCancel,
  submitLabel,
}: {
  user?: Row;
  state: State;
  includeAccess?: boolean;
  onSave: (v: Row) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const uid = useId();
  const publishedTemplates = state.templates.filter((t) => t.published);
  const availableNodes = state.nodes.filter((n) => !n.deleting);

  const [data, setData] = useState<Row>(() => ({
    name: "",
    note: "",
    enabled: true,
    expires: null,
    quota: newQuota(),
    nodeIds: [],
    templateIds: publishedTemplates.slice(0, 1).map((t) => t.id),
    defaultTemplate: publishedTemplates[0]?.id || "",
    ...user,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setData((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      focusFirstInvalid(e.currentTarget);
      return;
    }
    if (
      data.quota?.reset?.kind === "interval" &&
      !Number.isFinite(Date.parse(data.quota.reset.anchor || ""))
    ) {
      setError("Anchor (UTC) must be a valid date and time.");
      return;
    }
    if (!data.templateIds?.length || !data.defaultTemplate) {
      setError("Select at least one published template and a default template.");
      return;
    }
    setBusy(true);
    // Keep latest user nodeIds/templateIds when editing profile/quota from Settings tab.
    const payload = includeAccess || !user
      ? data
      : {
          ...data,
          nodeIds: user.nodeIds ?? data.nodeIds,
          templateIds: user.templateIds ?? data.templateIds,
          defaultTemplate: user.defaultTemplate || data.defaultTemplate,
        };
    onSave(payload)
      .catch((err) => setError(err instanceof Error ? err.message : "Save failed"))
      .finally(() => setBusy(false));
  };

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <Field
          label="Display name"
          htmlFor={`${uid}-name`}
          errorText="Enter a user display name."
          errorId={`${uid}-name-err`}
          required
        >
          <input
            id={`${uid}-name`}
            required
            data-error={`${uid}-name-err`}
            placeholder="e.g. Alex"
            value={data.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field label="Note" htmlFor={`${uid}-note`}>
          <input
            id={`${uid}-note`}
            placeholder="Devices or owner note"
            value={data.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>

        <Field
          label="Expires (UTC)"
          htmlFor={`${uid}-expires`}
          hint="Leave empty for no expiration."
          hintId={`${uid}-expires-hint`}
          className="full"
        >
          <input
            id={`${uid}-expires`}
            type="datetime-local"
            aria-describedby={`${uid}-expires-hint`}
            value={toDatetimeLocal(data.expires)}
            onChange={(e) =>
              set("expires", fromDatetimeLocal(e.target.value))
            }
          />
        </Field>

        <div className="full">
          <SwitchField
            id={`${uid}-enabled`}
            label="Access enabled"
            detail="Allow subscription retrieval and VPN authentication."
            checked={!!data.enabled}
            onChange={(checked) => set("enabled", checked)}
          />
        </div>
      </div>

      <QuotaFields value={data.quota} onChange={(q) => set("quota", q)} />

      {includeAccess && (
        <>
          <fieldset className="form-section">
            <legend>Authorized nodes</legend>
            <div className="fieldset-bar">
              <span className="muted-copy">
                {(data.nodeIds || []).length} of {availableNodes.length} selected
              </span>
              {availableNodes.length > 0 && (
                <button
                  type="button"
                  className="compact-button"
                  onClick={() =>
                    set(
                      "nodeIds",
                      availableNodes.map((n) => n.id),
                    )
                  }
                >
                  Select current nodes
                </button>
              )}
            </div>
            {availableNodes.length ? (
              <div className="check-grid">
                {availableNodes.map((n) => {
                  const checked = (data.nodeIds || []).includes(n.id);
                  return (
                    <label
                      key={n.id}
                      className={`check-card ${checked ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          set(
                            "nodeIds",
                            e.target.checked
                              ? [...(data.nodeIds || []), n.id]
                              : (data.nodeIds || []).filter(
                                  (id: string) => id !== n.id,
                                ),
                          )
                        }
                      />
                      <span>
                        <strong>{n.name}</strong>
                        <small className="mono">
                          {n.address}:{n.port}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="muted-copy">
                No nodes yet. You can assign them later.
              </p>
            )}
          </fieldset>

          <fieldset className="form-section">
            <legend>Available templates</legend>
            <div className="check-grid">
              {publishedTemplates.map((t) => {
                const checked = (data.templateIds || []).includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`check-card ${checked ? "checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setData((prev) => {
                          const cur = prev.templateIds || [];
                          const nextTemplateIds = isChecked
                            ? cur.includes(t.id)
                              ? cur
                              : [...cur, t.id]
                            : cur.filter((id: string) => id !== t.id);
                          const nextDefault = !isChecked
                            ? prev.defaultTemplate === t.id
                              ? nextTemplateIds[0] || ""
                              : prev.defaultTemplate
                            : prev.defaultTemplate || t.id;
                          return {
                            ...prev,
                            templateIds: nextTemplateIds,
                            defaultTemplate: nextDefault,
                          };
                        });
                      }}
                    />
                    <span>
                      <strong>{t.name}</strong>
                      <small>mihomo configuration</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <Field
              label="Default template"
              htmlFor={`${uid}-defaultTemplate`}
              errorText="Select a default template."
              errorId={`${uid}-def-tpl-err`}
              required
            >
              <select
                id={`${uid}-defaultTemplate`}
                value={data.defaultTemplate}
                onChange={(e) => set("defaultTemplate", e.target.value)}
                required
                data-error={`${uid}-def-tpl-err`}
              >
                <option value="">Choose template</option>
                {state.templates
                  .filter((t) => (data.templateIds || []).includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
          </fieldset>
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel || (user ? "Save user settings" : "Create user")}
        </button>
      </div>
    </form>
  );
}

export function UsageCorrectionPanel({
  host,
  onSave,
}: {
  host: Row;
  onSave: (v: Row) => Promise<void>;
}) {
  const uid = useId();
  const [v, setV] = useState({
    inbound: host.usage?.inbound ?? 0,
    outbound: host.usage?.outbound ?? 0,
    reason: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (!e.currentTarget.checkValidity()) {
          e.currentTarget.reportValidity();
          focusFirstInvalid(e.currentTarget);
          return;
        }
        setBusy(true);
        onSave(v)
          .then(() => setV((prev) => ({ ...prev, reason: "" })))
          .catch((err) =>
            setError(err instanceof Error ? err.message : "Correction failed"),
          )
          .finally(() => setBusy(false));
      }}
    >
      <p className="muted-copy">
        Replace current-period directional byte totals without modifying
        historical samples or reset dates.
      </p>
      <div className="form-grid">
        {(["inbound", "outbound"] as const).map((k) => (
          <Field
            key={k}
            label={`${k === "inbound" ? "Inbound" : "Outbound"} bytes`}
            htmlFor={`${uid}-${k}`}
            required
          >
            <input
              id={`${uid}-${k}`}
              type="number"
              min="0"
              step="1"
              required
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
            />
          </Field>
        ))}
        <Field
          label="Reason"
          htmlFor={`${uid}-reason`}
          hint="Recorded permanently in the event trail."
          hintId={`${uid}-reason-hint`}
          errorText="Provide a reason for this usage correction."
          errorId={`${uid}-reason-err`}
          className="full"
          required
        >
          <input
            id={`${uid}-reason`}
            required
            aria-describedby={`${uid}-reason-hint`}
            data-error={`${uid}-reason-err`}
            placeholder="e.g. Align with provider billing counter"
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
          />
        </Field>
      </div>
      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Applying…" : "Apply correction"}
        </button>
      </div>
    </form>
  );
}

export function ForceRemoveDialog({
  host,
  onClose,
  onSave,
}: {
  host: Row;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const uid = useId();
  const [checked, setChecked] = useState(false);

  return (
    <Confirm
      title={`Force remove ${host.name}?`}
      danger
      action="Force remove"
      onClose={onClose}
      onConfirm={async () => {
        if (!checked) throw Error("Confirm independent remote cleanup first.");
        await onSave();
      }}
    >
      <p className="notice-banner danger">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>
          Remote cleanup will be recorded as unverified. Running VPN services
          may remain on the server.
        </span>
      </p>
      <label htmlFor={`${uid}-ack`} className="check-card danger-card">
        <input
          id={`${uid}-ack`}
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          <strong>
            The host is destroyed, or I will handle remote services
            independently.
          </strong>
        </span>
      </label>
    </Confirm>
  );
}
