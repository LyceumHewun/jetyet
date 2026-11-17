import { ArrowUpRight, Network } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { api } from "./client";
import { Badge, Confirm, Dialog, Field } from "./components";
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
  const [name, setName] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-intro">
        <span className="brand">
          <span className="brand-symbol">
            <Network size={22} />
          </span>
          jetyet.
        </span>
        <div>
          <div className="eyebrow">YOUR PRIVATE INFRASTRUCTURE</div>
          <h1>
            A quiet place
            <br />
            to run your network.
          </h1>
          <p>
            Manage your hosts. Share your connections.
            <br />
            Keep access in your hands.
          </p>
        </div>
        <small>HYSTERIA 2 / MIHOMO</small>
      </div>
      <div className="login-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            api("login", "POST", { username: name, password })
              .then((x) => onLogin(x.username))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <span className="eyebrow">ADMINISTRATOR ACCESS</span>
          <h2>Welcome back.</h2>
          <p>Sign in to your network workspace.</p>
          <Field label="Username">
            <input
              autoComplete="username"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowUpRight size={16} />
          </button>
          <small>Credentials are managed in your server configuration.</small>
        </form>
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
  const [unit, setUnit] = useState(() => inferQuotaUnit(value.limit));
  const factor = unit === "GB" ? 1e9 : unit === "TiB" ? 1024 ** 4 : 1024 ** 3;
  const reset = value.reset;
  return (
    <fieldset>
      <legend>Traffic allowance</legend>
      <div className="form-grid">
        <Field
          label="Limit"
          hint="Empty means unlimited. Zero blocks all counted traffic."
        >
          <div className="input-combo">
            <input
              type="number"
              min="0"
              step="any"
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
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option>GiB</option>
              <option>TiB</option>
              <option>GB</option>
            </select>
          </div>
        </Field>
        <Field
          label="Counted direction"
          hint="Directions are from the VPS perspective."
        >
          <select
            value={value.direction}
            onChange={(e) => onChange({ ...value, direction: e.target.value })}
          >
            <option value="both">Outbound + inbound</option>
            <option value="out">Outbound only</option>
            <option value="in">Inbound only</option>
          </select>
        </Field>
        <Field label="Reset policy">
          <select
            value={reset.kind}
            onChange={(e) =>
              onChange({
                ...value,
                reset:
                  e.target.value === "monthly"
                    ? { kind: "monthly", day: 1, hour: 0 }
                    : {
                        kind: "interval",
                        days: 30,
                        anchor: new Date().toISOString(),
                      },
              })
            }
          >
            <option value="monthly">Fixed monthly date</option>
            <option value="interval">Every N days</option>
          </select>
        </Field>
        {reset.kind === "monthly" ? (
          <>
            <Field label="Day of month">
              <input
                type="number"
                min="1"
                max="31"
                required
                value={reset.day}
                onChange={(e) =>
                  onChange({
                    ...value,
                    reset: { ...reset, day: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Hour (Hong Kong)">
              <input
                type="number"
                min="0"
                max="23"
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
            <Field label="Interval in days">
              <input
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
            <Field label="Anchor (UTC)">
              <input
                type="datetime-local"
                required
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
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setData({ ...data, [k]: v });
  const input = (
    key: string,
    label: string,
    type = "text",
    hint?: string,
    extra?: InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <Field label={label} hint={hint}>
      <input
        type={type}
        value={data[key] ?? ""}
        onChange={(e) =>
          set(key, type === "number" ? Number(e.target.value) : e.target.value)
        }
        required={
          !["note", "credential", "passphrase", "hopping"].includes(key)
        }
        {...extra}
      />
    </Field>
  );
  return (
    <Dialog
      title={`${row ? "Edit" : "Add"} ${kind === "hosts" ? "VPS" : kind === "nodes" ? "node" : "subscription user"}`}
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
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body form-body">
          <div className="form-grid">
            {input("name", "Display name")}
            {kind === "hosts" && (
              <>
                {input("address", "SSH address")}
                {input("port", "SSH port", "number")}
                {input("username", "SSH username")}
                <Field label="Authentication">
                  <select
                    value={data.authType}
                    onChange={(e) => set("authType", e.target.value)}
                  >
                    <option value="key">Private key</option>
                    <option value="password">Password</option>
                  </select>
                </Field>
                <Field
                  label={
                    data.authType === "key" ? "Private key" : "SSH password"
                  }
                  hint={
                    row
                      ? "Leave empty to retain the current credential."
                      : undefined
                  }
                >
                  {data.authType === "key" ? (
                    <textarea
                      rows={4}
                      value={data.credential}
                      onChange={(e) => set("credential", e.target.value)}
                      required={!row}
                    />
                  ) : (
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={data.credential}
                      onChange={(e) => set("credential", e.target.value)}
                      required={!row}
                    />
                  )}
                </Field>
                {data.authType === "key" &&
                  input("passphrase", "Key passphrase", "password")}
                {!row && (
                  <>
                    {input("initialIn", "Initial inbound bytes", "number")}
                    {input("initialOut", "Initial outbound bytes", "number")}
                  </>
                )}
              </>
            )}
            {kind === "nodes" && (
              <>
                <Field label="VPS">
                  <select
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
                {input("address", "Advertised IP address")}
                {input("port", "UDP listen port", "number", undefined, {
                  min: 1,
                  max: 65535,
                  step: 1,
                })}
                {input(
                  "hopping",
                  "Hopping range",
                  "text",
                  "Optional, e.g. 20000-50000. Open this UDP range in your provider firewall.",
                )}
                {input(
                  "hopInterval",
                  "Hop interval (seconds)",
                  "number",
                  undefined,
                  { min: 5, step: 1 },
                )}
                {input(
                  "upMbps",
                  "Client upload hint (Mbps)",
                  "number",
                  undefined,
                  { min: 0, step: 1 },
                )}
                {input(
                  "downMbps",
                  "Client download hint (Mbps)",
                  "number",
                  undefined,
                  { min: 0, step: 1 },
                )}
                <p className="form-note full">
                  Native Hysteria 2 · self-signed certificate · certificate
                  verification skipped. Network parameter changes require an
                  explicit reapply operation.
                </p>
              </>
            )}
            {kind === "users" && (
              <>
                {input("note", "Note")}
                <Field
                  label="Expires (UTC)"
                  hint="Leave empty for no expiration."
                >
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(data.expires)}
                    onChange={(e) =>
                      set("expires", fromDatetimeLocal(e.target.value))
                    }
                  />
                </Field>
              </>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              Enabled
            </label>
          </div>
          {kind !== "nodes" && (
            <QuotaFields value={data.quota} onChange={(q) => set("quota", q)} />
          )}
          {kind === "users" && (
            <>
              <fieldset>
                <legend>Authorized nodes</legend>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    set(
                      "nodeIds",
                      state.nodes.filter((n) => !n.deleting).map((n) => n.id),
                    )
                  }
                >
                  Select current nodes
                </button>
                <div className="check-grid">
                  {state.nodes
                    .filter((n) => !n.deleting)
                    .map((n) => (
                      <label key={n.id} className="check-field">
                        <input
                          type="checkbox"
                          checked={data.nodeIds.includes(n.id)}
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
                        {n.name}
                      </label>
                    ))}
                </div>
                {!state.nodes.length && (
                  <small>No nodes yet. You can assign them later.</small>
                )}
              </fieldset>
              <fieldset>
                <legend>Available templates</legend>
                <div className="check-grid">
                  {state.templates
                    .filter((t) => t.published)
                    .map((t) => (
                      <label key={t.id} className="check-field">
                        <input
                          type="checkbox"
                          checked={data.templateIds.includes(t.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setData((prev) => {
                              const nextTemplateIds = checked
                                ? prev.templateIds.includes(t.id)
                                  ? prev.templateIds
                                  : [...prev.templateIds, t.id]
                                : prev.templateIds.filter(
                                    (id: string) => id !== t.id,
                                  );
                              const nextDefault = !checked
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
                        {t.name}
                      </label>
                    ))}
                </div>
                <Field label="Default template">
                  <select
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
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
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
  const [version, setVersion] = useState(node.version || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={`${kind === "command" ? "Generate deployment command" : kind} · ${node.name}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          onSubmit(version)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          <p>
            Service changes may interrupt all users on this node. Configuration
            is preserved before replacement.
          </p>
          <Field label="Target Hysteria 2 version">
            <input
              value={version}
              required
              pattern="v2\.\d+\.\d+"
              placeholder="v2.x.y"
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>
          {kind === "reapply" && (
            <p className="form-note">
              Explicitly replaces remote configuration with platform settings,
              including any manual edits. Inspect the configuration drift before
              proceeding.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
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
  const [v, setV] = useState({
      inbound: host.usage.inbound,
      outbound: host.usage.outbound,
      reason: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="Correct current-period usage" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          onSave(v)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {(["inbound", "outbound"] as const).map((k) => (
            <Field key={k} label={`${k} bytes`}>
              <input
                type="number"
                min="0"
                required
                value={v[k]}
                onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
              />
            </Field>
          ))}
          <Field label="Reason">
            <input
              required
              value={v.reason}
              onChange={(e) => setV({ ...v, reason: e.target.value })}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Apply correction
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
      <p>
        Remote cleanup will be recorded as unverified. Running services may
        remain on the server.
      </p>
      <label className="check-field">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        The host is destroyed, or I will handle remote services independently.
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
  const [id, setId] = useState(template?.id || ""),
    [name, setName] = useState(template?.name || ""),
    [body, setBody] = useState(template?.draft ?? template?.body ?? ""),
    [userId, setUserId] = useState(state.users[0]?.id || ""),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        <Field label="Template name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="muted">
          Liquid data only. Available: proxies, choices, user.name. Use the yaml
          and indent filters. File loading and scripts are disabled.
        </p>
        <textarea
          className="template-source"
          spellCheck={false}
          rows={18}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setPreview("");
          }}
        />
        <Field label="Preview as user">
          <select
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
          <small>
            Create a user with the built-in template before publishing a custom
            template.
          </small>
        )}
        {error && <p className="form-error">{error}</p>}
        {preview && (
          <>
            <Badge tone="good">Validated · credentials hidden</Badge>
            <pre className="code-output">{preview}</pre>
          </>
        )}
      </div>
      <div className="dialog-footer">
        {id && (
          <button
            className="danger-text"
            disabled={busy}
            onClick={() => {
              if (confirm("Delete this unassigned template?"))
                void api(`templates/${id}`, "DELETE")
                  .then(refresh)
                  .then(onClose)
                  .catch((e) => setError(e.message));
            }}
          >
            Delete
          </button>
        )}
        <button disabled={busy || !name} onClick={() => void action("save")}>
          Save draft
        </button>
        <button
          disabled={busy || !userId || !name}
          onClick={() => void action("preview")}
        >
          Validate & preview
        </button>
        <button
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
