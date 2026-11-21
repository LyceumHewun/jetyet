import {
  ArrowUpRight,
  FileCode2,
  Moon,
  Network,
  Radio,
  Server,
  Sun,
  Users,
} from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { api, fmt } from "./client";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  ChipPicker,
  Confirm,
  DateTimePicker,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Stage,
  SwitchPill,
  TextArea,
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
export function Login({
  onLogin,
  theme = "light",
  onToggleTheme,
}: {
  onLogin: (name: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const [name, setName] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      {onToggleTheme && (
        <button
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          className="icon-button login-theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          type="button"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
      <div className="login-wrap">
        <div className="login-brand">
          <span className="brand">
            <span className="brand-symbol">
              <Network size={22} />
            </span>
            jetyet<span className="brand-period">.</span>
          </span>
        </div>
        <div className="login-card">
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
            <h2>Sign in</h2>
            <p>Sign in to your network workspace.</p>
            <Field label="Username">
              <Input
                autoComplete="username"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="form-error">{error}</p>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowUpRight size={16} />
            </Button>
            <small>Credentials are managed in your server configuration.</small>
          </form>
        </div>
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
    <div className="studio-card">
      <div className="studio-card-head">
        <h2>Traffic allowance</h2>
        <SegmentedControl
          value={value.direction}
          options={[
            ["both", "Both"],
            ["out", "Out"],
            ["in", "In"],
          ]}
          onChange={(direction) => onChange({ ...value, direction })}
        />
      </div>
      <div className="form-grid">
        <Field label="Limit" hint="Empty = unlimited · 0 = block">
          <div className="input-combo">
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Unlimited"
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
            <Select
              compact
              value={unit}
              options={[
                { value: "GiB", label: "GiB" },
                { value: "TiB", label: "TiB" },
                { value: "GB", label: "GB" },
              ]}
              onChange={setUnit}
            />
          </div>
        </Field>
        <Field label="Reset cycle">
          <SegmentedControl
            fullWidth
            value={reset.kind}
            options={[
              ["monthly", "Monthly"],
              ["interval", "Every N days"],
            ]}
            onChange={(k) =>
              onChange({
                ...value,
                reset:
                  k === "monthly"
                    ? { kind: "monthly", day: 1, hour: 0 }
                    : {
                        kind: "interval",
                        days: 30,
                        anchor: new Date().toISOString(),
                      },
              })
            }
          />
        </Field>
        {reset.kind === "monthly" ? (
          <>
            <Field label="Day of month">
              <Input
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
            <Field label="Hour (HKT)">
              <Input
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
            <Field label="Interval (days)">
              <Input
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
              <DateTimePicker
                value={toDatetimeLocal(reset.anchor)}
                allowClear={false}
                onChange={(val) =>
                  onChange({
                    ...value,
                    reset: {
                      ...reset,
                      anchor: fromDatetimeLocal(val) ?? "",
                    },
                  })
                }
              />
            </Field>
          </>
        )}
      </div>
    </div>
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
      <Input
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
  const entityTag =
    kind === "hosts" ? "VPS" : kind === "nodes" ? "Node" : "User";
  const formId = `entity-form-${kind}`;
  const selectedHost =
    kind === "nodes"
      ? state.hosts.find((h) => h.id === data.hostId)?.name || "Unassigned"
      : "";
  return (
    <Stage
      title={
        row
          ? data.name || row.name
          : `New ${kind === "hosts" ? "VPS" : kind === "nodes" ? "node" : "user"}`
      }
      tag={row ? `Edit ${entityTag}` : `Create ${entityTag}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy}
            form={formId}
            type="submit"
          >
            {busy ? "Saving…" : row ? "Save changes" : `Create ${entityTag}`}
          </button>
        </>
      }
    >
      <div className="studio-grid">
        <aside className="studio-preview">
          <div className="studio-card preview-card">
            <span className="kpi-label">LIVE PREVIEW</span>
            <div className="entity-card-head">
              <span className="host-icon">
                {kind === "hosts" ? (
                  <Server size={16} />
                ) : kind === "nodes" ? (
                  <Radio size={16} />
                ) : (
                  <Users size={16} />
                )}
              </span>
              <div className="entity-title">
                <strong className="preview-name">
                  {data.name || `Untitled ${entityTag}`}
                </strong>
                <small className="mono">
                  {kind === "users"
                    ? data.note || "No note"
                    : `${data.address || "0.0.0.0"}:${data.port || 22}`}
                </small>
              </div>
              <Badge tone={data.enabled ? "good" : "neutral"}>
                {data.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="preview-meta">
              {kind === "hosts" && (
                <>
                  <span className="chip mono">
                    {data.username || "root"} · {data.authType}
                  </span>
                  <span className="chip mono">
                    {data.quota?.limit === null
                      ? "∞ Unlimited"
                      : fmt(data.quota.limit)}
                  </span>
                </>
              )}
              {kind === "nodes" && (
                <>
                  <span className="chip">{selectedHost}</span>
                  {data.hopping && (
                    <span className="chip mono">UDP {data.hopping}</span>
                  )}
                </>
              )}
              {kind === "users" && (
                <>
                  <span className="chip mono">
                    {data.nodeIds?.length || 0} nodes
                  </span>
                  <span className="chip mono">
                    {data.templateIds?.length || 0} templates
                  </span>
                  <span className="chip mono">
                    {data.quota?.limit === null
                      ? "∞ Unlimited"
                      : fmt(data.quota.limit)}
                  </span>
                </>
              )}
            </div>
          </div>
          {kind === "nodes" && (
            <div className="form-note">
              Native Hysteria 2 · self-signed cert. Network changes require a
              reapply operation.
            </div>
          )}
        </aside>
        <form
          id={formId}
          className="studio-stack"
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
          <div className="studio-card">
            <div className="studio-card-head">
              <h2>{kind === "users" ? "Profile" : "Connection"}</h2>
              <SwitchPill
                checked={data.enabled}
                onChange={(next) => set("enabled", next)}
              />
            </div>
            <div className="form-grid">
              {input("name", "Display name")}
              {kind === "hosts" && (
                <>
                  {input("address", "SSH address")}
                  {input("port", "SSH port", "number")}
                  {input("username", "SSH username")}
                  <Field label="Authentication">
                    <SegmentedControl
                      fullWidth
                      value={data.authType}
                      options={[
                        ["key", "Private key"],
                        ["password", "Password"],
                      ]}
                      onChange={(t) => set("authType", t)}
                    />
                  </Field>
                  <div className="full">
                    <Field
                      label={
                        data.authType === "key" ? "Private key" : "SSH password"
                      }
                      hint={
                        row
                          ? "Leave empty to retain current credential."
                          : undefined
                      }
                    >
                      {data.authType === "key" ? (
                        <TextArea
                          rows={4}
                          value={data.credential}
                          onChange={(e) => set("credential", e.target.value)}
                          required={!row}
                        />
                      ) : (
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={data.credential}
                          onChange={(e) => set("credential", e.target.value)}
                          required={!row}
                        />
                      )}
                    </Field>
                  </div>
                  {data.authType === "key" && (
                    <div className="full">
                      {input("passphrase", "Key passphrase", "password")}
                    </div>
                  )}
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
                    <Select
                      value={data.hostId}
                      disabled={!!row}
                      placeholder="Select trusted VPS"
                      options={state.hosts
                        .filter(
                          (h) =>
                            h.fingerprint &&
                            (h.id === data.hostId ||
                              !state.nodes.some((n) => n.hostId === h.id)),
                        )
                        .map((h) => ({ value: h.id, label: h.name }))}
                      onChange={(v) => set("hostId", v)}
                    />
                  </Field>
                  {input("address", "Advertised IP / domain")}
                  {input("port", "UDP listen port", "number", undefined, {
                    min: 1,
                    max: 65535,
                    step: 1,
                  })}
                  {input(
                    "hopping",
                    "Hopping range",
                    "text",
                    "e.g. 20000-50000",
                  )}
                  {input(
                    "hopInterval",
                    "Hop interval (sec)",
                    "number",
                    undefined,
                    { min: 5, step: 1 },
                  )}
                  {input("upMbps", "Upload hint (Mbps)", "number", undefined, {
                    min: 0,
                    step: 1,
                  })}
                  {input(
                    "downMbps",
                    "Download hint (Mbps)",
                    "number",
                    undefined,
                    { min: 0, step: 1 },
                  )}
                </>
              )}
              {kind === "users" && (
                <>
                  {input("note", "Note")}
                  <Field label="Expires (UTC)" hint="Empty = never">
                    <DateTimePicker
                      value={toDatetimeLocal(data.expires)}
                      placeholder="Never expires"
                      onChange={(val) => set("expires", fromDatetimeLocal(val))}
                    />
                  </Field>
                </>
              )}
            </div>
          </div>
          {kind !== "nodes" && (
            <QuotaFields value={data.quota} onChange={(q) => set("quota", q)} />
          )}
          {kind === "users" && (
            <div className="studio-card">
              <div className="studio-card-head">
                <h2>Access Matrix</h2>
                <Button
                  variant="text"
                  onClick={() =>
                    set(
                      "nodeIds",
                      state.nodes.filter((n) => !n.deleting).map((n) => n.id),
                    )
                  }
                >
                  Select all nodes
                </Button>
              </div>
              <div className="matrix-section">
                <span className="kpi-label">AUTHORIZED NODES</span>
                <ChipPicker
                  options={state.nodes
                    .filter((n) => !n.deleting)
                    .map((n) => ({ id: n.id, label: n.name }))}
                  selected={data.nodeIds}
                  emptyText="No nodes yet."
                  onToggle={(id) =>
                    set(
                      "nodeIds",
                      data.nodeIds.includes(id)
                        ? data.nodeIds.filter((x: string) => x !== id)
                        : [...data.nodeIds, id],
                    )
                  }
                />
              </div>
              <div className="matrix-section">
                <span className="kpi-label">TEMPLATES</span>
                <ChipPicker
                  options={state.templates
                    .filter((t) => t.published)
                    .map((t) => ({ id: t.id, label: t.name }))}
                  selected={data.templateIds}
                  emptyText="No published templates."
                  onToggle={(id) => {
                    setData((prev) => {
                      const active = prev.templateIds.includes(id);
                      const nextTemplateIds = active
                        ? prev.templateIds.filter((x: string) => x !== id)
                        : [...prev.templateIds, id];
                      const nextDefault = active
                        ? prev.defaultTemplate === id
                          ? nextTemplateIds[0] || ""
                          : prev.defaultTemplate
                        : prev.defaultTemplate || id;
                      return {
                        ...prev,
                        templateIds: nextTemplateIds,
                        defaultTemplate: nextDefault,
                      };
                    });
                  }}
                />
              </div>
              <Field label="Default template">
                <Select
                  value={data.defaultTemplate}
                  placeholder="Choose template"
                  options={state.templates
                    .filter((t) => data.templateIds.includes(t.id))
                    .map((t) => ({ value: t.id, label: t.name }))}
                  onChange={(v) => set("defaultTemplate", v)}
                />
              </Field>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
        </form>
      </div>
    </Stage>
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
    <Modal
      title={node.name}
      tag={kind === "command" ? "Deploy command" : kind}
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
        <div className="modal-body">
          <p className="muted">
            Service changes may interrupt active connections on this node.
          </p>
          <Field label="Target Hysteria 2 version">
            <Input
              value={version}
              required
              pattern="v2\.\d+\.\d+"
              placeholder="v2.6.1"
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>
          {kind === "reapply" && (
            <p className="form-note">
              Replaces remote configuration with platform settings, including
              manual edits.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy
              ? "Working…"
              : kind === "command"
                ? "Generate command"
                : "Queue operation"}
          </Button>
        </div>
      </form>
    </Modal>
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
    <Modal title={host.name} tag="Usage correction" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          onSave(v)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            {(["inbound", "outbound"] as const).map((k) => (
              <Field key={k} label={`${k} bytes`}>
                <Input
                  type="number"
                  min="0"
                  required
                  value={v[k]}
                  onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <Field label="Reason">
            <Input
              required
              value={v.reason}
              onChange={(e) => setV({ ...v, reason: e.target.value })}
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Apply correction
          </Button>
        </div>
      </form>
    </Modal>
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
      <Checkbox checked={checked} onChange={setChecked}>
        The host is destroyed, or I will handle remote services independently.
      </Checkbox>
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
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
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
    <Stage
      title={name || (template ? "Edit template" : "New template")}
      tag="Template Studio"
      onClose={onClose}
      actions={
        <>
          {id && (
            <Button
              variant="danger-text"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          <Button disabled={busy || !name} onClick={() => void action("save")}>
            Save draft
          </Button>
          <Button
            disabled={busy || !userId || !name}
            onClick={() => void action("preview")}
          >
            Validate & preview
          </Button>
          <Button
            variant="primary"
            disabled={busy || !userId || !name || !preview}
            onClick={() => void action("publish")}
          >
            {busy ? "Working…" : "Publish"}
          </Button>
        </>
      }
    >
      {confirmDelete && (
        <Confirm
          title={`Delete ${name || "template"}?`}
          action="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api(`templates/${id}`, "DELETE");
            await refresh();
            setConfirmDelete(false);
            onClose();
          }}
        >
          <p>Only unassigned templates can be deleted.</p>
        </Confirm>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="ide-grid">
        <div className="studio-card ide-pane">
          <div className="studio-card-head">
            <Input
              className="ide-name-input"
              placeholder="Template name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Chip mono>Liquid · YAML</Chip>
          </div>
          <TextArea
            className="template-source ide-editor"
            spellCheck={false}
            rows={22}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setPreview("");
            }}
          />
        </div>
        <div className="studio-card ide-pane">
          <div className="studio-card-head">
            <div className="ide-preview-bar">
              <FileCode2 size={15} className="muted" />
              <Select
                value={userId}
                placeholder="Preview as user…"
                options={state.users.map((u) => ({
                  value: u.id,
                  label: u.name,
                }))}
                onChange={(v) => {
                  setUserId(v);
                  setPreview("");
                }}
              />
            </div>
            {preview && <Badge tone="good">Validated</Badge>}
          </div>
          {preview ? (
            <pre className="code-output ide-output">{preview}</pre>
          ) : (
            <div className="ide-empty">
              <p className="muted">
                Click <strong>Validate & preview</strong> to render output for
                the selected user.
              </p>
            </div>
          )}
        </div>
      </div>
    </Stage>
  );
}
