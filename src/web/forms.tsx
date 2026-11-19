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
  Network,
  Radio,
  Repeat,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { api } from "./client";
import {
  Badge,
  Confirm,
  Dialog,
  DialogDismissButton,
  Field,
  SwitchField,
} from "./components";
import type { Row, State } from "./types";

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

export function Login({ onLogin }: { onLogin: (name: string) => void }) {
  const [name, setName] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-page">
      <section className="login-hero" aria-label="About Jetyet">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <Network size={24} />
          </span>
          <span className="brand-text">
            jetyet<span className="brand-dot">.</span>
          </span>
        </div>

        <div className="login-hero-copy">
          <p className="hero-eyebrow">PERSONAL HYSTERIA 2 CONTROL</p>
          <h1>Run your own VPN.</h1>
          <p className="hero-lead">
            Connect VPS hosts, deploy Hysteria 2 nodes, and share private mihomo
            subscriptions with friends.
          </p>

          <ol className="hero-flow" aria-label="How Jetyet works">
            <li>
              <span className="flow-badge" aria-hidden="true">
                <Server size={18} />
              </span>
              <div>
                <strong>1. Connect VPS</strong>
                <span className="flow-desc">
                  Trust SSH identity & set host quota
                </span>
              </div>
            </li>
            <li>
              <span className="flow-badge" aria-hidden="true">
                <Radio size={18} />
              </span>
              <div>
                <strong>2. Deploy node</strong>
                <span className="flow-desc">One Hysteria 2 service per host</span>
              </div>
            </li>
            <li>
              <span className="flow-badge" aria-hidden="true">
                <Users size={18} />
              </span>
              <div>
                <strong>3. Share links</strong>
                <span className="flow-desc">
                  Per-user mihomo URLs & allowances
                </span>
              </div>
            </li>
          </ol>
        </div>

        <p className="hero-foot">HYSTERIA 2 · MIHOMO · ASIA/HONG_KONG</p>
      </section>

      <main className="login-panel">
        <form
          className="login-card"
          aria-labelledby="login-heading"
          onSubmit={(e) => {
            e.preventDefault();
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
          <p className="login-subtitle">Open your network workspace.</p>

          <Field label="Username" htmlFor="login-username" required>
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
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required>
            <div className="password-wrap">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="done"
                required
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

          <button type="submit" className="primary login-submit" disabled={busy}>
            <span>{busy ? "Signing in…" : "Sign in"}</span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </button>

          <small className="login-footnote">
            Credentials are set in your server configuration.
          </small>
        </form>
      </main>
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
  const [unit, setUnit] = useState(() => inferQuotaUnit(value.limit));
  const factor = unit === "GB" ? 1e9 : unit === "TiB" ? 1024 ** 4 : 1024 ** 3;
  const reset = value.reset;

  return (
    <fieldset className="form-section">
      <legend>Traffic allowance</legend>
      <div className="form-grid">
        <Field
          label="Limit"
          htmlFor={`${uid}-limit`}
          hint="Empty means unlimited. Zero blocks all counted traffic."
          hintId={`${uid}-limit-hint`}
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
              value={value.limit === null ? "" : value.limit / factor}
              onChange={(e) =>
                onChange({
                  ...value,
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
                  checked={value.direction === dir}
                  onChange={() => onChange({ ...value, direction: dir })}
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
                    ...value,
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
                    ...value,
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
              required
            >
              <input
                id={`${uid}-day`}
                type="number"
                min="1"
                max="31"
                required
                aria-describedby={`${uid}-day-hint`}
                value={reset.day}
                onChange={(e) =>
                  onChange({
                    ...value,
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
            >
              <input
                id={`${uid}-hour`}
                type="number"
                min="0"
                max="23"
                aria-describedby={`${uid}-hour-hint`}
                value={reset.hour}
                onChange={(e) =>
                  onChange({
                    ...value,
                    reset: { ...reset, hour: Number(e.target.value) },
                  })
                }
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Interval in days" htmlFor={`${uid}-days`} required>
              <input
                id={`${uid}-days`}
                type="number"
                min="1"
                max="3650"
                required
                value={reset.days}
                onChange={(e) =>
                  onChange({
                    ...value,
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
              required
            >
              <input
                id={`${uid}-anchor`}
                type="datetime-local"
                required
                aria-describedby={`${uid}-anchor-hint`}
                value={toDatetimeLocal(reset.anchor)}
                onChange={(e) =>
                  onChange({
                    ...value,
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

export const newQuota = () => ({
  limit: null,
  direction: "both",
  reset: { kind: "monthly", day: 1, hour: 0 },
});

export function EntityForm({
  kind,
  row,
  state,
  onClose,
  onSave,
}: {
  kind: string;
  row?: Row;
  state: State;
  onClose: () => void;
  onSave: (v: Row) => Promise<void>;
}) {
  const uid = useId();
  const [data, setData] = useState<Row>(() =>
    kind === "hosts"
      ? {
          name: "",
          address: "",
          port: 22,
          username: "root",
          authType: "key",
          enabled: true,
          quota: newQuota(),
          initialIn: 0,
          initialOut: 0,
          ...row,
          credential: "",
          passphrase: "",
        }
      : kind === "nodes"
        ? {
            hostId:
              state.hosts.find(
                (h) =>
                  h.fingerprint && !state.nodes.some((n) => n.hostId === h.id),
              )?.id || "",
            name: "",
            address: "",
            port: 443,
            hopping: "",
            hopInterval: 30,
            upMbps: 0,
            downMbps: 0,
            enabled: true,
            ...row,
          }
        : {
            name: "",
            note: "",
            enabled: true,
            expires: null,
            quota: newQuota(),
            nodeIds: [],
            templateIds: state.templates
              .filter((t) => t.published)
              .slice(0, 1)
              .map((t) => t.id),
            defaultTemplate: state.templates.find((t) => t.published)?.id || "",
            ...row,
          },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: any) => setData({ ...data, [k]: v });

  const renderInput = (
    key: string,
    label: string,
    type = "text",
    hint?: string,
    extra?: InputHTMLAttributes<HTMLInputElement>,
    className = "",
  ) => {
    const inputId = `${uid}-${key}`;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const isRequired = ![
      "note",
      "credential",
      "passphrase",
      "hopping",
    ].includes(key);
    return (
      <Field
        label={label}
        htmlFor={inputId}
        hint={hint}
        hintId={hintId}
        required={isRequired}
        className={className}
      >
        <input
          id={inputId}
          name={key}
          type={type}
          aria-describedby={hintId}
          value={data[key] ?? ""}
          onChange={(e) =>
            set(key, type === "number" ? Number(e.target.value) : e.target.value)
          }
          required={isRequired}
          {...extra}
        />
      </Field>
    );
  };

  const title = `${row ? "Edit" : "Add"} ${
    kind === "hosts" ? "VPS" : kind === "nodes" ? "node" : "subscription user"
  }`;
  const availableNodes = state.nodes.filter((n) => !n.deleting);
  const publishedTemplates = state.templates.filter((t) => t.published);

  return (
    <Dialog
      title={title}
      subtitle={
        kind === "hosts"
          ? "SSH connection and host-level traffic allowance."
          : kind === "nodes"
            ? "One native Hysteria 2 endpoint per trusted VPS."
            : "Subscription link, allowed nodes, and shared quota."
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            kind !== "nodes" &&
            data.quota?.reset?.kind === "interval" &&
            !Number.isFinite(Date.parse(data.quota.reset.anchor || ""))
          ) {
            setError("Anchor (UTC) must be a valid date and time.");
            return;
          }
          setBusy(true);
          setError("");
          onSave(data)
            .catch((err) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body form-body">
          <div className="form-grid">
            {renderInput("name", "Display name", "text", undefined, {
              autoFocus: true,
              ...({ "data-autofocus": "true" } as any),
            })}

            {kind === "hosts" && (
              <>
                {renderInput(
                  "address",
                  "SSH address",
                  "text",
                  "IP address or hostname.",
                  {
                    autoCorrect: "off",
                    autoCapitalize: "none",
                    spellCheck: false,
                  },
                )}
                {renderInput("port", "SSH port", "number", undefined, {
                  min: 1,
                  max: 65535,
                  step: 1,
                })}
                {renderInput("username", "SSH username", "text", undefined, {
                  autoCorrect: "off",
                  autoCapitalize: "none",
                  spellCheck: false,
                })}

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
                  label={
                    data.authType === "key" ? "Private key" : "SSH password"
                  }
                  htmlFor={`${uid}-credential`}
                  hint={
                    row
                      ? "Leave empty to keep the stored credential."
                      : data.authType === "key"
                        ? "Paste PEM or OpenSSH private key."
                        : "Stored encrypted with the server master key."
                  }
                  hintId={`${uid}-cred-hint`}
                  required={!row}
                  className="full"
                >
                  {data.authType === "key" ? (
                    <textarea
                      id={`${uid}-credential`}
                      rows={4}
                      aria-describedby={`${uid}-cred-hint`}
                      value={data.credential}
                      onChange={(e) => set("credential", e.target.value)}
                      required={!row}
                    />
                  ) : (
                    <input
                      id={`${uid}-credential`}
                      type="password"
                      autoComplete="new-password"
                      aria-describedby={`${uid}-cred-hint`}
                      value={data.credential}
                      onChange={(e) => set("credential", e.target.value)}
                      required={!row}
                    />
                  )}
                </Field>

                {data.authType === "key" &&
                  renderInput(
                    "passphrase",
                    "Key passphrase",
                    "password",
                    "Optional if the private key is unencrypted.",
                    { autoComplete: "new-password" },
                    "full",
                  )}

                {!row && (
                  <>
                    {renderInput(
                      "initialIn",
                      "Initial inbound bytes",
                      "number",
                      "Baseline bytes already billed this period.",
                      { min: 0, step: 1 },
                    )}
                    {renderInput(
                      "initialOut",
                      "Initial outbound bytes",
                      "number",
                      "Baseline bytes already billed this period.",
                      { min: 0, step: 1 },
                    )}
                  </>
                )}
              </>
            )}

            {kind === "nodes" && (
              <>
                <Field label="VPS" htmlFor={`${uid}-hostId`} required>
                  <select
                    id={`${uid}-hostId`}
                    value={data.hostId}
                    onChange={(e) => set("hostId", e.target.value)}
                    required
                    disabled={!!row}
                  >
                    <option value="">Select trusted VPS</option>
                    {state.hosts
                      .filter(
                        (h) =>
                          h.fingerprint &&
                          (h.id === data.hostId ||
                            !state.nodes.some((n) => n.hostId === h.id)),
                      )
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                  </select>
                </Field>

                {renderInput(
                  "address",
                  "Advertised IP address",
                  "text",
                  "Public IPv4 or IPv6 for client configs.",
                  {
                    autoCorrect: "off",
                    autoCapitalize: "none",
                    spellCheck: false,
                  },
                )}
                {renderInput("port", "UDP listen port", "number", undefined, {
                  min: 1,
                  max: 65535,
                  step: 1,
                })}
                {renderInput(
                  "hopping",
                  "Hopping range",
                  "text",
                  "Optional, e.g. 20000-50000. Open this UDP range in your provider firewall.",
                )}
                {renderInput(
                  "hopInterval",
                  "Hop interval (seconds)",
                  "number",
                  undefined,
                  { min: 5, step: 1 },
                )}
                {renderInput(
                  "upMbps",
                  "Client upload hint (Mbps)",
                  "number",
                  "0 disables bandwidth hint.",
                  { min: 0, step: 1 },
                )}
                {renderInput(
                  "downMbps",
                  "Client download hint (Mbps)",
                  "number",
                  "0 disables bandwidth hint.",
                  { min: 0, step: 1 },
                )}

                <p className="notice-banner full">
                  <Radio size={18} aria-hidden="true" />
                  <span>
                    Native Hysteria 2 · self-signed certificate ·{" "}
                    <code>skip-cert-verify</code> enabled. Network edits require{" "}
                    <strong>Reapply configuration</strong>.
                  </span>
                </p>
              </>
            )}

            {kind === "users" && (
              <>
                {renderInput("note", "Note")}
                <Field
                  label="Expires (UTC)"
                  htmlFor={`${uid}-expires`}
                  hint="Leave empty for no expiration."
                  hintId={`${uid}-expires-hint`}
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
              </>
            )}

            <div className="full">
              <SwitchField
                id={`${uid}-enabled`}
                label="Enabled"
                detail={
                  kind === "hosts"
                    ? "Allow VPN services and include host in active management."
                    : kind === "nodes"
                      ? "Run service and include node in user subscriptions."
                      : "Allow subscription retrieval and VPN authentication."
                }
                checked={!!data.enabled}
                onChange={(checked) => set("enabled", checked)}
              />
            </div>
          </div>

          {kind !== "nodes" && (
            <QuotaFields value={data.quota} onChange={(q) => set("quota", q)} />
          )}

          {kind === "users" && (
            <>
              <fieldset className="form-section">
                <legend>Authorized nodes</legend>
                <div className="fieldset-bar">
                  <span className="muted-copy">
                    {data.nodeIds.length} of {availableNodes.length} selected
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
                      const checked = data.nodeIds.includes(n.id);
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
                                  ? [...data.nodeIds, n.id]
                                  : data.nodeIds.filter(
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
                    const checked = data.templateIds.includes(t.id);
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
                              const nextTemplateIds = isChecked
                                ? prev.templateIds.includes(t.id)
                                  ? prev.templateIds
                                  : [...prev.templateIds, t.id]
                                : prev.templateIds.filter(
                                    (id: string) => id !== t.id,
                                  );
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
                  required
                >
                  <select
                    id={`${uid}-defaultTemplate`}
                    value={data.defaultTemplate}
                    onChange={(e) => set("defaultTemplate", e.target.value)}
                    required
                  >
                    <option value="">Choose template</option>
                    {state.templates
                      .filter((t) => data.templateIds.includes(t.id))
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
        </div>

        <div className="dialog-footer">
          <DialogDismissButton>Cancel</DialogDismissButton>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function OperationForm({
  node,
  kind,
  onClose,
  onSubmit,
}: {
  node: Row;
  kind: string;
  onClose: () => void;
  onSubmit: (v: string) => Promise<void>;
}) {
  const uid = useId();
  const [version, setVersion] = useState(node.version || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const labelMap: Record<string, string> = {
    deploy: "Deploy node",
    upgrade: "Upgrade Hysteria 2",
    reapply: "Reapply configuration",
    command: "Generate deployment script",
  };

  return (
    <Dialog
      title={labelMap[kind] || `${kind} operation`}
      subtitle={node.name}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          onSubmit(version)
            .catch((err) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          <p className="body-copy">
            Service changes may interrupt active users on this node. Existing
            configuration is preserved before replacement.
          </p>

          <Field
            label="Target Hysteria 2 version"
            htmlFor={`${uid}-version`}
            hint="Use an exact release tag, e.g. v2.6.5."
            hintId={`${uid}-version-hint`}
            required
          >
            <input
              id={`${uid}-version`}
              value={version}
              required
              autoFocus
              data-autofocus="true"
              pattern="v2\.\d+\.\d+"
              placeholder="v2.6.5"
              aria-describedby={`${uid}-version-hint`}
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>

          {kind === "reapply" && (
            <p className="notice-banner warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                Explicitly replaces remote configuration with platform settings,
                overwriting manual edits. Inspect configuration drift first.
              </span>
            </p>
          )}

          {error && (
            <p className="form-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <div className="dialog-footer">
          <DialogDismissButton>Cancel</DialogDismissButton>
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? "Working…"
              : kind === "command"
                ? "Generate command"
                : "Queue operation"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Correction({
  host,
  onClose,
  onSave,
}: {
  host: Row;
  onClose: () => void;
  onSave: (v: Row) => Promise<void>;
}) {
  const uid = useId();
  const [v, setV] = useState({
    inbound: host.usage.inbound,
    outbound: host.usage.outbound,
    reason: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      title="Correct current-period usage"
      subtitle={host.name}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          onSave(v)
            .catch((err) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          <p className="body-copy">
            Replace current-period directional byte totals without modifying
            historical samples or scheduled reset dates.
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
          </div>
          <Field
            label="Reason"
            htmlFor={`${uid}-reason`}
            hint="Recorded in the permanent audit trail."
            hintId={`${uid}-reason-hint`}
            required
          >
            <input
              id={`${uid}-reason`}
              required
              autoFocus
              data-autofocus="true"
              aria-describedby={`${uid}-reason-hint`}
              value={v.reason}
              onChange={(e) => setV({ ...v, reason: e.target.value })}
            />
          </Field>

          {error && (
            <p className="form-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <DialogDismissButton>Cancel</DialogDismissButton>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Applying…" : "Apply correction"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ForceRemove({
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

export function TemplateEditor({
  template,
  state,
  onClose,
  refresh,
}: {
  template?: Row;
  state: State;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const uid = useId();
  const [id, setId] = useState(template?.id || "");
  const [name, setName] = useState(template?.name || "");
  const [body, setBody] = useState(template?.draft ?? template?.body ?? "");
  const [userId, setUserId] = useState(state.users[0]?.id || "");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    if (id) {
      await api(`templates/${id}`, "PUT", { name, body });
      return id;
    }
    const t = await api("templates", "POST", { name, body });
    setId(t.id);
    return t.id;
  };

  const action = async (kind: string) => {
    setBusy(true);
    setError("");
    try {
      const target = await save();
      if (kind === "preview") {
        const result = await api(`templates/${target}/preview`, "POST", {
          userId,
          body,
        });
        setPreview(result.text);
      } else if (kind === "publish") {
        await api(`templates/${target}/publish`, "POST", { userId });
        await refresh();
        onClose();
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={template ? "Edit template" : "New template"}
      subtitle="Complete mihomo YAML rendered via Liquid data tags."
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        <Field label="Template name" htmlFor={`${uid}-name`} required>
          <input
            id={`${uid}-name`}
            required
            autoFocus
            data-autofocus="true"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="token-strip" aria-label="Available template variables">
          <span className="token-label">Data variables:</span>
          <code>proxies</code>
          <code>choices</code>
          <code>nodes</code>
          <code>user.name</code>
          <span className="token-label">Filters:</span>
          <code>yaml</code>
          <code>indent</code>
        </div>

        <Field
          label="Liquid template (YAML)"
          htmlFor={`${uid}-source`}
          hint="Data-only rendering. File loading and scripts are disabled."
          hintId={`${uid}-source-hint`}
        >
          <textarea
            id={`${uid}-source`}
            className="template-source"
            spellCheck={false}
            rows={15}
            aria-describedby={`${uid}-source-hint`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setPreview("");
            }}
          />
        </Field>

        <Field
          label="Preview as user"
          htmlFor={`${uid}-preview-user`}
          hint="Preview and mihomo validation are required before publishing."
          hintId={`${uid}-preview-hint`}
        >
          <select
            id={`${uid}-preview-user`}
            aria-describedby={`${uid}-preview-hint`}
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPreview("");
            }}
          >
            <option value="">Choose user</option>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>

        {!state.users.length && (
          <p className="notice-banner warning">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>
              Create a subscription user first to validate and publish this
              template.
            </span>
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {preview && (
          <div className="preview-block">
            <Badge tone="good" icon={<ShieldCheck size={14} />}>
              Validated · credentials hidden
            </Badge>
            <pre className="code-output">{preview}</pre>
          </div>
        )}
      </div>

      <div className="dialog-footer">
        {id && (
          <div className="footer-danger-group">
            {!confirmDelete ? (
              <button
                type="button"
                className="danger-outline"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>Delete</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void api(`templates/${id}`, "DELETE")
                      .then(refresh)
                      .then(onClose)
                      .catch((err) => {
                        setError(err.message);
                        setConfirmDelete(false);
                        setBusy(false);
                      });
                  }}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </button>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={busy || !name}
          onClick={() => void action("save")}
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy || !userId || !name}
          onClick={() => void action("preview")}
        >
          Validate & preview
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !userId || !name || !preview}
          onClick={() => void action("publish")}
        >
          {busy ? "Working…" : "Publish"}
        </button>
      </div>
    </Dialog>
  );
}
