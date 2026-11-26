import {
  PORTAL_PASSWORD_MAX_LENGTH,
  PORTAL_PASSWORD_MIN_LENGTH,
} from "../shared/portal-password";
import {
  DEFAULT_ECH_PUBLIC_NAME,
  DEFAULT_HYSTERIA_VERSION,
  DEFAULT_TLS_SNI,
  MIN_BBR_VERSION,
  MIN_ECH_VERSION,
  MIN_PINNED_TLS_VERSION,
  compareHysteriaVersion,
  isValidDnsName,
  type TlsSecurityMode,
} from "../shared/tls";
import { asUiError, type UiError, localizeError, t as translate } from "./i18n";
import {
  ArrowLeft,
  ArrowUpRight,
  FileCode2,
  Moon,
  Radio,
  Server,
  Sun,
  Users,
} from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { api, fmt } from "./client";
import {
  Badge,
  BrandMark,
  BrandWordmark,
  ScrollArea,
  Button,
  Checkbox,
  Chip,
  ChipPicker,
  Confirm,
  DateTimePicker,
  Field,
  Input,
  Modal,
  ModalBody,
  SegmentedControl,
  Select,
  Stage,
  SwitchPill,
  TemplateAuthoringHelp,
  TextArea,
} from "./components";
import {
  formatLabel,
  operationLabel,
  TEMPLATE_FORMATS,
  templateSyntaxLabel,
} from "./labels";
import type { Row, Session, State, TemplateFormat } from "./types";

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
  languageControl,
}: {
  onLogin: (session: Session) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  languageControl: ReactNode;
}) {
  const [step, setStep] = useState<"username" | "password">("username"),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState<UiError>(""),
    [busy, setBusy] = useState(false);

  const trimmedName = name.trim();

  return (
    <div className="login-page">
      <div className="login-toolbar">
        {languageControl}
        {onToggleTheme && (
          <button
            aria-label={
              theme === "dark"
                ? translate("Switch to light mode")
                : translate("Switch to dark mode")
            }
            className="icon-button login-theme-toggle"
            onClick={onToggleTheme}
            title={
              theme === "dark"
                ? translate("Light mode")
                : translate("Dark mode")
            }
            type="button"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>
      <div className="login-wrap">
        <div className="login-brand">
          <span className="brand">
            <BrandMark size={22} />
            <BrandWordmark />
          </span>
        </div>
        <div className="login-card">
          {step === "username" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!trimmedName) {
                  setError("Enter your username.");
                  return;
                }
                setError("");
                setPassword("");
                setStep("password");
              }}
            >
              <h2>{translate("Sign in")}</h2>
              <p>{translate("Enter your username to continue.")}</p>
              <Field label={translate("Username")} htmlFor="login-username">
                <Input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  enterKeyHint="next"
                  required
                  autoFocus
                  aria-invalid={error ? "true" : "false"}
                  aria-describedby={error ? "login-step1-error" : undefined}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError("");
                  }}
                />
              </Field>
              {error && (
                <p id="login-step1-error" className="form-error" role="alert">
                  {localizeError(error)}
                </p>
              )}
              <Button variant="primary" type="submit">
                {translate("Continue")}
                <ArrowUpRight size={16} />
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                api("login", "POST", { username: trimmedName, password })
                  .then((x) => onLogin({ username: x.username, role: x.role }))
                  .catch((err) => setError(asUiError(err)))
                  .finally(() => setBusy(false));
              }}
            >
              <div className="login-step-head">
                <button
                  type="button"
                  className="text-button login-back-btn"
                  onClick={() => {
                    setStep("username");
                    setPassword("");
                    setError("");
                  }}
                >
                  <ArrowLeft size={13} />
                  {translate("Change user")}
                </button>
                <Chip mono>{trimmedName}</Chip>
              </div>
              <h2>{translate("Enter password")}</h2>
              <p>{translate("Sign in with your password.")}</p>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={trimmedName}
                readOnly
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
              <Field label={translate("Password")} htmlFor="login-password">
                <Input
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  type="password"
                  enterKeyHint="done"
                  required
                  autoFocus
                  aria-invalid={error ? "true" : "false"}
                  aria-describedby={error ? "login-step2-error" : undefined}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                />
              </Field>
              {error && (
                <p id="login-step2-error" className="form-error" role="alert">
                  {localizeError(error)}
                </p>
              )}
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? translate("Signing in…") : translate("Sign in")}
                <ArrowUpRight size={16} />
              </Button>
              <small className="login-guidance">
                {translate(
                  "First time signing in or forgot your password? Ask your administrator for a portal password link.",
                )}
              </small>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function SetPassword({
  onSuccess,
  onBackToSignIn,
  theme = "light",
  onToggleTheme,
  languageControl,
}: {
  onSuccess: (session: Session) => void;
  onBackToSignIn: () => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  languageControl: ReactNode;
}) {
  const [token] = useState(() => {
    const raw = window.location.hash;
    const stripped = raw.startsWith("#") ? raw.slice(1).trim() : "";
    if (!stripped) return "";
    try {
      return decodeURIComponent(stripped).trim();
    } catch {
      return stripped;
    }
  });
  const [verifying, setVerifying] = useState(true),
    [verifyError, setVerifyError] = useState<UiError>(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [submitError, setSubmitError] = useState<UiError>(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    if (!token) {
      setVerifyError(
        "Missing or invalid portal password link. Ask your administrator for a new link.",
      );
      setVerifying(false);
      return;
    }
    let cancelled = false;
    api("portal-password", "POST", { token })
      .then((res) => {
        if (cancelled) return;
        setUsername(res.username || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setVerifyError(
          err instanceof Error
            ? err
            : "This link is invalid or has expired. Ask your administrator for a new link.",
        );
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="login-page">
      <div className="login-toolbar">
        {languageControl}
        {onToggleTheme && (
          <button
            aria-label={
              theme === "dark"
                ? translate("Switch to light mode")
                : translate("Switch to dark mode")
            }
            className="icon-button login-theme-toggle"
            onClick={onToggleTheme}
            title={
              theme === "dark"
                ? translate("Light mode")
                : translate("Dark mode")
            }
            type="button"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>
      <div className="login-wrap">
        <div className="login-brand">
          <span className="brand">
            <BrandMark size={22} />
            <BrandWordmark />
          </span>
        </div>
        <div className="login-card">
          {verifying ? (
            <div className="set-password-state">
              <h2>{translate("Verifying link")}</h2>
              <p className="muted">
                {translate("Checking portal password link…")}
              </p>
            </div>
          ) : verifyError ? (
            <div className="set-password-state">
              <h2>{translate("Link unavailable")}</h2>
              <p className="form-error" role="alert">
                {localizeError(verifyError)}
              </p>
              <Button variant="primary" onClick={onBackToSignIn}>
                {translate("Back to sign in")}
                <ArrowUpRight size={16} />
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  password.length < PORTAL_PASSWORD_MIN_LENGTH ||
                  password.length > PORTAL_PASSWORD_MAX_LENGTH
                ) {
                  setSubmitError(
                    "Password must be between 6 and 1000 characters.",
                  );
                  return;
                }
                setBusy(true);
                setSubmitError("");
                api("portal-password", "POST", { token, password })
                  .then((res) =>
                    onSuccess({
                      username: res.username || username,
                      role: res.role || "subscriber",
                    }),
                  )
                  .catch((err) => setSubmitError(asUiError(err)))
                  .finally(() => setBusy(false));
              }}
            >
              <div className="login-step-head">
                <Chip>{translate("Portal Password")}</Chip>
                <Chip mono>{username}</Chip>
              </div>
              <h2>{translate("Set password")}</h2>
              <p>
                {translate(
                  "Choose a password for your subscription portal account.",
                )}
              </p>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                readOnly
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
              <Field
                label={translate("New password")}
                htmlFor="set-password-input"
                hint={translate("6–1000 characters.")}
                hintAbove
                hintId="set-password-hint"
              >
                <Input
                  id="set-password-input"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={PORTAL_PASSWORD_MIN_LENGTH}
                  maxLength={PORTAL_PASSWORD_MAX_LENGTH}
                  enterKeyHint="done"
                  required
                  autoFocus
                  aria-invalid={submitError ? "true" : "false"}
                  aria-describedby={
                    submitError
                      ? "set-password-hint set-password-error"
                      : "set-password-hint"
                  }
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (submitError) setSubmitError("");
                  }}
                />
              </Field>
              {submitError && (
                <p id="set-password-error" className="form-error" role="alert">
                  {localizeError(submitError)}
                </p>
              )}
              <Button variant="primary" type="submit" disabled={busy}>
                {busy
                  ? translate("Saving password…")
                  : translate("Set password & sign in")}
                <ArrowUpRight size={16} />
              </Button>
              <div className="set-password-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={onBackToSignIn}
                >
                  {translate("Back to sign in")}
                </button>
              </div>
            </form>
          )}
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
        <h2>{translate("Traffic allowance")}</h2>
        <SegmentedControl
          value={value.direction}
          options={[
            ["both", translate("Both")],
            ["out", translate("Out")],
            ["in", translate("In")],
          ]}
          onChange={(direction) => onChange({ ...value, direction })}
        />
      </div>
      <div className="form-grid">
        <Field
          label={translate("Limit")}
          hint={translate("Empty = unlimited · 0 = block")}
        >
          <div className="input-combo">
            <Input
              type="number"
              min="0"
              step="any"
              placeholder={translate("Unlimited")}
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
        <Field label={translate("Reset cycle")}>
          <SegmentedControl
            fullWidth
            value={reset.kind}
            options={[
              ["monthly", translate("Monthly")],
              ["interval", translate("Every N days")],
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
            <Field label={translate("Day of month")}>
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
            <Field label={translate("Hour (HKT)")}>
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
            <Field label={translate("Interval (days)")}>
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
            <Field label={translate("Anchor (HKT)")}>
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
  const [data, setData] = useState<Row>(() => {
    if (kind === "hosts") {
      return {
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
      };
    }
    if (kind === "nodes") {
      return {
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
        enabled: true,
        ...row,
      };
    }
    const published = state.templates.filter((t) => t.published);
    const defaultFor = (format: TemplateFormat) =>
      published.find((t) => t.format === format && t.builtin)?.id ||
      published.find((t) => t.format === format)?.id ||
      "";
    const defaultTemplates: Record<TemplateFormat, string> = {
      mihomo: row?.defaultTemplates?.mihomo || defaultFor("mihomo"),
      "sing-box":
        row?.defaultTemplates?.["sing-box"] || defaultFor("sing-box"),
    };
    const templateIds: string[] = row?.templateIds
      ? [...row.templateIds]
      : Array.from(
          new Set(
            [defaultTemplates.mihomo, defaultTemplates["sing-box"]].filter(
              Boolean,
            ),
          ),
        );
    return {
      name: "",
      username: "",
      note: "",
      enabled: true,
      expires: null,
      quota: newQuota(),
      nodeIds: [],
      ...row,
      templateIds,
      defaultTemplates,
    };
  });
  const [error, setError] = useState<UiError>(""),
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
    kind === "hosts"
      ? "VPS"
      : kind === "nodes"
        ? translate("Node")
        : translate("User");
  const formId = `entity-form-${kind}`;
  const selectedHost =
    kind === "nodes"
      ? state.hosts.find((h) => h.id === data.hostId)?.name ||
        translate("Unassigned")
      : "";
  return (
    <Stage
      title={row ? data.name || row.name : translate("New {0}", entityTag)}
      tag={
        row
          ? translate("Edit {0}", entityTag)
          : translate("Create {0}", entityTag)
      }
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            {translate("Cancel")}
          </button>
          <button
            className="primary"
            disabled={busy}
            form={formId}
            type="submit"
          >
            {busy
              ? translate("Saving…")
              : row
                ? translate("Save changes")
                : translate("Create {0}", entityTag)}
          </button>
        </>
      }
    >
      <div className="studio-grid">
        <aside className="studio-preview">
          <div className="studio-card preview-card">
            <span className="kpi-label">{translate("LIVE PREVIEW")}</span>
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
                  {data.name || translate("Untitled {0}", entityTag)}
                </strong>
                <small className="mono">
                  {kind === "users"
                    ? [
                        data.username ? `@${data.username}` : null,
                        data.note || null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || translate("No username")
                    : `${data.address || "0.0.0.0"}:${data.port || 22}`}
                </small>
              </div>
              <Badge tone={data.enabled ? "good" : "neutral"}>
                {data.enabled ? translate("Enabled") : translate("Disabled")}
              </Badge>
            </div>
            <div className="preview-meta">
              {kind === "hosts" && (
                <>
                  <span className="chip mono">
                    {data.username || "root"} ·{" "}
                    {translate(
                      data.authType === "key" ? "Private key" : "Password",
                    )}
                  </span>
                  <span className="chip mono">
                    {data.quota?.limit === null
                      ? translate("∞ Unlimited")
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
                    {translate("{0} nodes", data.nodeIds?.length || 0)}
                  </span>
                  <span className="chip mono">
                    {translate("{0} templates", data.templateIds?.length || 0)}
                  </span>
                  <span className="chip mono">
                    {data.quota?.limit === null
                      ? translate("∞ Unlimited")
                      : fmt(data.quota.limit)}
                  </span>
                </>
              )}
            </div>
          </div>
          {kind === "nodes" && (
            <div className="form-note">
              {translate(
                "Native Hysteria 2 · self-signed cert with forced SNI & pinSHA256. Network changes require a reapply operation.",
              )}
            </div>
          )}
        </aside>
        <form
          id={formId}
          className="studio-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              kind === "users" &&
              !/^[A-Za-z0-9._-]{1,100}$/.test((data.username || "").trim())
            ) {
              setError(
                "Sign-in username must be 1–100 characters using ASCII letters, digits, ., _, or -.",
              );
              return;
            }
            if (kind === "users") {
              const selectedIds: string[] = data.templateIds || [];
              const defaults = data.defaultTemplates || {};
              const hasAllDefaults = TEMPLATE_FORMATS.every((fmt) => {
                const tid = defaults[fmt];
                return (
                  typeof tid === "string" &&
                  selectedIds.includes(tid) &&
                  state.templates.some((t) => t.id === tid && t.format === fmt)
                );
              });
              if (!selectedIds.length || !hasAllDefaults) {
                setError(
                  "Select at least one published template and a default for both mihomo and sing-box.",
                );
                return;
              }
            }
            if (
              kind !== "nodes" &&
              data.quota?.reset?.kind === "interval" &&
              !Number.isFinite(Date.parse(data.quota.reset.anchor || ""))
            ) {
              setError("Anchor (HKT) must be a valid date and time.");
              return;
            }
            setBusy(true);
            setError("");
            const payload =
              kind === "users"
                ? { ...data, username: (data.username || "").trim() }
                : kind === "nodes"
                  ? {
                      hostId: data.hostId,
                      name: data.name,
                      address: data.address,
                      port: data.port,
                      hopping: data.hopping,
                      hopInterval: data.hopInterval,
                      enabled: data.enabled,
                    }
                  : data;
            onSave(payload)
              .catch((e) => setError(asUiError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="studio-card">
            <div className="studio-card-head">
              <h2>
                {kind === "users"
                  ? translate("Profile")
                  : translate("Connection")}
              </h2>
              <SwitchPill
                checked={data.enabled}
                onChange={(next) => set("enabled", next)}
              />
            </div>
            <div className="form-grid">
              {input("name", translate("Display name"))}
              {kind === "hosts" && (
                <>
                  {input("address", translate("SSH address"))}
                  {input("port", translate("SSH port"), "number")}
                  {input("username", translate("SSH username"))}
                  <Field label={translate("Authentication")}>
                    <SegmentedControl
                      fullWidth
                      value={data.authType}
                      options={[
                        ["key", translate("Private key")],
                        ["password", translate("Password")],
                      ]}
                      onChange={(t) => set("authType", t)}
                    />
                  </Field>
                  <div className="full">
                    <Field
                      label={
                        data.authType === "key"
                          ? translate("Private key")
                          : translate("SSH password")
                      }
                      hint={
                        row
                          ? translate(
                              "Leave empty to retain current credential.",
                            )
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
                      {input(
                        "passphrase",
                        translate("Key passphrase"),
                        "password",
                      )}
                    </div>
                  )}
                  {!row && (
                    <>
                      {input(
                        "initialIn",
                        translate("Initial inbound bytes"),
                        "number",
                      )}
                      {input(
                        "initialOut",
                        translate("Initial outbound bytes"),
                        "number",
                      )}
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
                      placeholder={translate("Select trusted VPS")}
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
                  {input("address", translate("Advertised IP / domain"))}
                  {input(
                    "port",
                    translate("UDP listen port"),
                    "number",
                    undefined,
                    {
                      min: 1,
                      max: 65535,
                      step: 1,
                    },
                  )}
                  {input(
                    "hopping",
                    translate("Hopping range"),
                    "text",
                    "e.g. 20000-50000",
                  )}
                  {input(
                    "hopInterval",
                    translate("Hop interval (sec)"),
                    "number",
                    undefined,
                    { min: 5, step: 1 },
                  )}
                </>
              )}
              {kind === "users" && (
                <>
                  {input(
                    "username",
                    translate("Sign-in username"),
                    "text",
                    translate("ASCII letters, digits, . _ - (max 100)"),
                    {
                      autoComplete: "off",
                      spellCheck: false,
                      autoCapitalize: "none",
                      autoCorrect: "off",
                      maxLength: 100,
                      pattern: "[A-Za-z0-9._-]{1,100}",
                    },
                  )}
                  {input("note", translate("Note"))}
                  <Field
                    label={translate("Expires (HKT)")}
                    hint={translate("Empty = never")}
                  >
                    <DateTimePicker
                      value={toDatetimeLocal(data.expires)}
                      placeholder={translate("Never expires")}
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
                <h2>{translate("Access Matrix")}</h2>
                <Button
                  variant="text"
                  onClick={() =>
                    set(
                      "nodeIds",
                      state.nodes.filter((n) => !n.deleting).map((n) => n.id),
                    )
                  }
                >
                  {translate("Select all nodes")}
                </Button>
              </div>
              <div className="matrix-section">
                <span className="kpi-label">
                  {translate("AUTHORIZED NODES")}
                </span>
                <ChipPicker
                  options={state.nodes
                    .filter((n) => !n.deleting)
                    .map((n) => ({ id: n.id, label: n.name }))}
                  selected={data.nodeIds}
                  emptyText={translate("No nodes yet.")}
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
                <span className="kpi-label">{translate("TEMPLATES")}</span>
                <ChipPicker
                  options={state.templates
                    .filter((t) => t.published)
                    .map((t) => ({
                      id: t.id,
                      label: t.name,
                      tag: t.builtin
                        ? `${formatLabel(t.format)} · ${translate("Built-in")}`
                        : formatLabel(t.format),
                    }))}
                  selected={data.templateIds}
                  emptyText={translate("No published templates.")}
                  onToggle={(id) => {
                    const toggled = state.templates.find((t) => t.id === id);
                    const format = toggled?.format as TemplateFormat | undefined;
                    setData((prev) => {
                      const active = prev.templateIds.includes(id);
                      const nextTemplateIds = active
                        ? prev.templateIds.filter((x: string) => x !== id)
                        : [...prev.templateIds, id];
                      const prevDefaults = prev.defaultTemplates || {};
                      const nextDefaults = { ...prevDefaults };
                      if (format) {
                        if (active) {
                          if (nextDefaults[format] === id) {
                            nextDefaults[format] =
                              nextTemplateIds.find(
                                (tid: string) =>
                                  state.templates.find((t) => t.id === tid)
                                    ?.format === format,
                              ) || "";
                          }
                        } else if (!nextDefaults[format]) {
                          nextDefaults[format] = id;
                        }
                      }
                      return {
                        ...prev,
                        templateIds: nextTemplateIds,
                        defaultTemplates: nextDefaults,
                      };
                    });
                  }}
                />
              </div>
              <div className="form-grid">
                {TEMPLATE_FORMATS.map((fmt) => (
                  <Field
                    key={fmt}
                    label={translate("Default {0} template", formatLabel(fmt))}
                  >
                    <Select
                      value={data.defaultTemplates?.[fmt] || ""}
                      placeholder={translate("Choose template")}
                      options={state.templates
                        .filter(
                          (t) =>
                            data.templateIds.includes(t.id) && t.format === fmt,
                        )
                        .map((t) => ({
                          value: t.id,
                          label: t.builtin
                            ? `${t.name} (${translate("Built-in")})`
                            : t.name,
                        }))}
                      onChange={(v) =>
                        set("defaultTemplates", {
                          ...data.defaultTemplates,
                          [fmt]: v,
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
          {error && <p className="form-error">{localizeError(error)}</p>}
        </form>
      </div>
    </Stage>
  );
}

export type NodeOperationPayload = {
  version: string;
  protocol: "hysteria2";
  tuning: boolean;
  congestion: "brutal" | "bbr";
  tlsSecurity: TlsSecurityMode;
  sni: string;
  ech: boolean;
  echPublicName: string;
};

export function OperationForm({
  node,
  kind,
  onClose,
  onSubmit,
}: {
  node: Row;
  kind: string;
  onClose: () => void;
  onSubmit: (payload: NodeOperationPayload) => Promise<void>;
}) {
  const hasDeployOptions =
    kind === "deploy" || kind === "command" || kind === "upgrade";
  const isVerified = node.status
    ? node.status !== "draft"
    : Boolean(node.version);
  const currentTlsSecurity: TlsSecurityMode =
    isVerified && node.tlsSecurity === "pinned" ? "pinned" : "legacy";
  const defaultVersion =
    kind === "upgrade" &&
    node.version &&
    /^v2\.\d+\.\d+$/.test(node.version) &&
    compareHysteriaVersion(node.version, DEFAULT_HYSTERIA_VERSION) < 0
      ? DEFAULT_HYSTERIA_VERSION
      : node.version || DEFAULT_HYSTERIA_VERSION;
  const [version, setVersion] = useState(defaultVersion),
    [congestion, setCongestion] = useState<"brutal" | "bbr">(
      isVerified && node.congestion === "bbr" ? "bbr" : "brutal",
    ),
    [tuning, setTuning] = useState<boolean>(
      isVerified ? Boolean(node.tuning) : false,
    ),
    [tlsSecurity, setTlsSecurity] = useState<TlsSecurityMode>(
      hasDeployOptions ? "pinned" : currentTlsSecurity,
    ),
    [sni, setSni] = useState<string>(
      isVerified && typeof node.sni === "string" ? node.sni : "",
    ),
    [ech, setEch] = useState<boolean>(
      isVerified && currentTlsSecurity === "pinned" ? Boolean(node.ech) : false,
    ),
    [echPublicName, setEchPublicName] = useState<string>(
      isVerified && typeof node.echPublicName === "string"
        ? node.echPublicName
        : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<UiError>("");
  const versionId = useId();
  const versionHintId = useId();
  const congestionId = useId();
  const congestionHintId = useId();
  const tlsSecurityId = useId();
  const tlsSecurityHintId = useId();
  const sniId = useId();
  const sniHintId = useId();
  const echPublicNameId = useId();
  const echPublicNameHintId = useId();
  const effectiveTlsSecurity = hasDeployOptions
    ? tlsSecurity
    : currentTlsSecurity;
  const effectiveEch = effectiveTlsSecurity === "pinned" && ech;
  const versionHints = [
    hasDeployOptions || effectiveTlsSecurity === "pinned"
      ? translate("Forced SNI + pinSHA256 requires Hysteria 2 v2.6.4 or later.")
      : "",
    hasDeployOptions || congestion === "bbr"
      ? translate("BBR requires Hysteria 2 v2.8.0 or later.")
      : "",
    hasDeployOptions || effectiveEch
      ? translate("ECH requires Hysteria 2 v2.12.3 or later.")
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const resolvedSni =
    effectiveTlsSecurity === "pinned"
      ? sni.trim().toLowerCase() || DEFAULT_TLS_SNI
      : "";
  const resolvedEchPublicName = effectiveEch
    ? echPublicName.trim().toLowerCase() || DEFAULT_ECH_PUBLIC_NAME
    : "";
  const currentSni =
    currentTlsSecurity === "pinned"
      ? (typeof node.sni === "string" && node.sni.trim().toLowerCase()) ||
        DEFAULT_TLS_SNI
      : "";
  const currentEch = currentTlsSecurity === "pinned" && Boolean(node.ech);
  const currentEchPublicName = currentEch
    ? (typeof node.echPublicName === "string" &&
        node.echPublicName.trim().toLowerCase()) ||
      DEFAULT_ECH_PUBLIC_NAME
    : "";
  const tlsInvalidatesCachedProfiles =
    hasDeployOptions &&
    isVerified &&
    (effectiveTlsSecurity !== currentTlsSecurity ||
      resolvedSni !== currentSni ||
      effectiveEch !== currentEch ||
      resolvedEchPublicName !== currentEchPublicName);

  return (
    <Modal
      title={node.name}
      tag={
        kind === "command" ? translate("Deploy command") : operationLabel(kind)
      }
      onClose={onClose}
      className={hasDeployOptions ? "operation-dialog" : ""}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmedVersion = version.trim();
          const nextSni =
            effectiveTlsSecurity === "pinned" ? sni.trim().toLowerCase() : "";
          const nextEch = effectiveTlsSecurity === "pinned" && ech;
          const nextEchPublicName = nextEch
            ? echPublicName.trim().toLowerCase()
            : "";
          if (!/^v2\.\d+\.\d+$/.test(trimmedVersion)) {
            setError("Specify an explicit Hysteria 2 version");
            return;
          }
          if (
            effectiveTlsSecurity === "pinned" &&
            compareHysteriaVersion(trimmedVersion, MIN_PINNED_TLS_VERSION) < 0
          ) {
            setError(
              "Forced SNI and pinSHA256 require Hysteria 2 v2.6.4 or later",
            );
            return;
          }
          if (
            congestion === "bbr" &&
            compareHysteriaVersion(trimmedVersion, MIN_BBR_VERSION) < 0
          ) {
            setError("BBR mode requires Hysteria 2 v2.8.0 or later");
            return;
          }
          if (
            nextEch &&
            compareHysteriaVersion(trimmedVersion, MIN_ECH_VERSION) < 0
          ) {
            setError("ECH requires Hysteria 2 v2.12.3 or later");
            return;
          }
          if (nextSni && !isValidDnsName(nextSni)) {
            setError("Enter a valid domain name");
            return;
          }
          if (nextEchPublicName && !isValidDnsName(nextEchPublicName)) {
            setError("Enter a valid domain name");
            return;
          }
          setBusy(true);
          setError("");
          onSubmit({
            version: trimmedVersion,
            protocol: "hysteria2",
            tuning,
            congestion,
            tlsSecurity: effectiveTlsSecurity,
            sni: nextSni,
            ech: nextEch,
            echPublicName: nextEchPublicName,
          })
            .catch((e) => setError(asUiError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <ModalBody>
          <p className="muted">
            {translate(
              "Service changes may interrupt active connections on this node.",
            )}
          </p>
          <div className="deploy-options">
            <div className={hasDeployOptions ? "deploy-row" : undefined}>
              <Field
                label={translate("Target Hysteria 2 version")}
                htmlFor={versionId}
                hint={versionHints || undefined}
                hintId={versionHintId}
              >
                <Input
                  id={versionId}
                  className="mono"
                  value={version}
                  required
                  pattern="v2\.\d+\.\d+"
                  aria-describedby={versionHints ? versionHintId : undefined}
                  autoFocus
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    if (error) setError("");
                  }}
                />
              </Field>
              {hasDeployOptions && (
                <Field
                  label={translate("Protocol")}
                  hint={translate("Only Hysteria 2 is supported.")}
                >
                  <p className="field-readonly">Hysteria 2</p>
                </Field>
              )}
            </div>
            {hasDeployOptions && (
              <>
                <section className="deploy-section">
                  <span className="kpi-label">
                    {translate("TLS & SECURITY")}
                  </span>
                  <Field
                    label={translate("TLS security")}
                    htmlFor={tlsSecurityId}
                    hint={translate(
                      "Pinned mode enforces SNI matching on the server and pins the self-signed certificate in subscriptions. Legacy mode preserves older verification-skipping deployments.",
                    )}
                    hintId={tlsSecurityHintId}
                  >
                    <Select
                      id={tlsSecurityId}
                      aria-describedby={tlsSecurityHintId}
                      value={tlsSecurity}
                      options={[
                        {
                          value: "pinned",
                          label: translate("Forced SNI + pinSHA256 (Recommended)"),
                        },
                        {
                          value: "legacy",
                          label: translate("Legacy (skip-cert-verify)"),
                        },
                      ]}
                      onChange={(v) => {
                        const next = v as TlsSecurityMode;
                        setTlsSecurity(next);
                        if (next !== "pinned") setEch(false);
                        if (error) setError("");
                      }}
                    />
                  </Field>
                  {tlsSecurity === "pinned" && (
                    <Field
                      label={translate("Forced SNI")}
                      htmlFor={sniId}
                      hint={translate(
                        "Optional. Leave blank to use the default SNI ({0}). Changing SNI re-issues the self-signed certificate.",
                        DEFAULT_TLS_SNI,
                      )}
                      hintId={sniHintId}
                    >
                      <Input
                        id={sniId}
                        className="mono"
                        value={sni}
                        placeholder={DEFAULT_TLS_SNI}
                        aria-describedby={sniHintId}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => {
                          setSni(e.target.value);
                          if (error) setError("");
                        }}
                      />
                    </Field>
                  )}
                  <Field
                    label={translate("Encrypted Client Hello (ECH)")}
                    hint={
                      tlsSecurity === "pinned"
                        ? translate(
                            "Optional and independent. Hides the inner SNI behind an outer decoy domain; private keys stay on the VPS.",
                          )
                        : translate(
                            "Requires Forced SNI + pinSHA256 TLS security.",
                          )
                    }
                  >
                    <Checkbox
                      checked={tlsSecurity === "pinned" && ech}
                      disabled={tlsSecurity !== "pinned"}
                      onChange={(checked) => {
                        setEch(checked);
                        if (error) setError("");
                      }}
                    >
                      {translate("Enable ECH")}
                    </Checkbox>
                  </Field>
                  {tlsSecurity === "pinned" && ech && (
                    <Field
                      label={translate("ECH public name")}
                      htmlFor={echPublicNameId}
                      hint={translate(
                        "Optional outer decoy SNI visible on the network. Leave blank to use {0}.",
                        DEFAULT_ECH_PUBLIC_NAME,
                      )}
                      hintId={echPublicNameHintId}
                    >
                      <Input
                        id={echPublicNameId}
                        className="mono"
                        value={echPublicName}
                        placeholder={DEFAULT_ECH_PUBLIC_NAME}
                        aria-describedby={echPublicNameHintId}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => {
                          setEchPublicName(e.target.value);
                          if (error) setError("");
                        }}
                      />
                    </Field>
                  )}
                </section>
                <section className="deploy-section">
                  <span className="kpi-label">
                    {translate("TRANSPORT & TUNING")}
                  </span>
                  <Field
                    label={translate("Congestion control")}
                    htmlFor={congestionId}
                    hint={translate(
                      "Brutal is the default. Changes publish to subscriptions after deployment or installation detection succeeds.",
                    )}
                    hintId={congestionHintId}
                  >
                    <Select
                      id={congestionId}
                      aria-describedby={congestionHintId}
                      value={congestion}
                      options={[
                        { value: "brutal", label: "Brutal" },
                        { value: "bbr", label: "BBR" },
                      ]}
                      onChange={(v) => {
                        setCongestion(v as "brutal" | "bbr");
                        if (error) setError("");
                      }}
                    />
                  </Field>
                  <Field
                    label={translate("Adaptive performance tuning")}
                    hint={translate(
                      "Optional and off by default. May raise low UDP socket buffers and add swap on low-memory VPS when host conditions allow; applied changes stay if disabled later.",
                    )}
                  >
                    <Checkbox checked={tuning} onChange={setTuning}>
                      {translate("Enable adaptive performance tuning")}
                    </Checkbox>
                  </Field>
                </section>
              </>
            )}
          </div>
          {tlsInvalidatesCachedProfiles && (
            <p className="form-note warning">
              {kind === "command"
                ? translate(
                    "Changing TLS mode, SNI, or ECH updates server certificates or ECH keys. After running the command and detecting the installation, subscribers must refresh their subscription.",
                  )
                : translate(
                    "Changing TLS mode, SNI, or ECH updates server certificates or ECH keys. Subscribers must refresh their subscription after the verified settings are published.",
                  )}
            </p>
          )}
          {kind === "reapply" && (
            <p className="form-note">
              {translate(
                "Replaces remote configuration with platform settings, including manual edits.",
              )}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {localizeError(error)}
            </p>
          )}
        </ModalBody>
        <div className="modal-foot">
          <Button onClick={onClose}>{translate("Cancel")}</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy
              ? translate("Working…")
              : kind === "command"
                ? translate("Generate command")
                : translate("Queue operation")}
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
    [error, setError] = useState<UiError>(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={host.name}
      tag={translate("Usage correction")}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          onSave(v)
            .catch((e) => setError(asUiError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <ModalBody>
          <div className="form-grid">
            {(["inbound", "outbound"] as const).map((k) => (
              <Field
                key={k}
                label={translate(
                  "{0} bytes",
                  translate(k === "inbound" ? "Inbound" : "Outbound"),
                )}
              >
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
          <Field label={translate("Reason")}>
            <Input
              required
              value={v.reason}
              onChange={(e) => setV({ ...v, reason: e.target.value })}
            />
          </Field>
          {error && <p className="form-error">{localizeError(error)}</p>}
        </ModalBody>
        <div className="modal-foot">
          <Button onClick={onClose}>{translate("Cancel")}</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {translate("Apply correction")}
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
      title={translate("Force remove {0}?", host.name)}
      danger
      action={translate("Force remove")}
      onClose={onClose}
      onConfirm={async () => {
        if (!checked) throw Error("Confirm independent remote cleanup first.");
        await onSave();
      }}
    >
      <p>
        {translate(
          "Remote cleanup will be recorded as unverified. Running services may remain on the server.",
        )}
      </p>
      <Checkbox checked={checked} onChange={setChecked}>
        {translate(
          "The host is destroyed, or I will handle remote services independently.",
        )}
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
    [format, setFormat] = useState<TemplateFormat>(
      template?.format === "sing-box" ? "sing-box" : "mihomo",
    ),
    [body, setBody] = useState(template?.draft ?? template?.body ?? ""),
    [userId, setUserId] = useState(state.users[0]?.id || ""),
    [preview, setPreview] = useState(""),
    [error, setError] = useState<UiError>(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const formatLocked = Boolean(id);
  const isBuiltin = Boolean(template?.builtin);
  const save = async () => {
    if (id) {
      await api(`templates/${id}`, "PUT", { name, body });
      return id;
    }
    const t = await api("templates", "POST", { name, body, format });
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
      setError(asUiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stage
      title={
        name ||
        (template ? translate("Edit template") : translate("New template"))
      }
      tag={`${translate("Template Studio")} · ${formatLabel(format)}`}
      onClose={onClose}
      actions={
        <>
          {id && !isBuiltin && (
            <Button
              variant="danger-text"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              {translate("Delete")}
            </Button>
          )}
          <Button disabled={busy || !name} onClick={() => void action("save")}>
            {translate("Save draft")}
          </Button>
          <Button
            disabled={busy || !userId || !name}
            onClick={() => void action("preview")}
          >
            {translate("Validate & preview")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !userId || !name || !preview}
            onClick={() => void action("publish")}
          >
            {busy ? translate("Working…") : translate("Publish")}
          </Button>
        </>
      }
    >
      {confirmDelete && (
        <Confirm
          title={translate("Delete {0}?", name || translate("Template"))}
          action={translate("Delete")}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api(`templates/${id}`, "DELETE");
            await refresh();
            setConfirmDelete(false);
            onClose();
          }}
        >
          <p>{translate("Only unassigned templates can be deleted.")}</p>
        </Confirm>
      )}
      {error && <p className="form-error">{localizeError(error)}</p>}
      <TemplateAuthoringHelp
        format={format}
        canInsertStarter={!body.trim()}
        disabled={busy}
        onInsertStarter={(starter) => {
          setBody(starter);
          setPreview("");
        }}
      />
      <div className="ide-grid">
        <div className="studio-card ide-pane">
          <div className="studio-card-head">
            <Input
              className="ide-name-input"
              placeholder={translate("Template name…")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="chip-group">
              {!formatLocked ? (
                <SegmentedControl
                  value={format}
                  options={[
                    ["mihomo", "mihomo"],
                    ["sing-box", "sing-box"],
                  ]}
                  onChange={(next) => {
                    setFormat(next);
                    setPreview("");
                  }}
                />
              ) : (
                <Chip mono>{formatLabel(format)}</Chip>
              )}
              <Chip mono>{templateSyntaxLabel(format)}</Chip>
              {isBuiltin && <Chip>{translate("Built-in")}</Chip>}
            </div>
          </div>
          <TextArea
            className="template-source ide-editor"
            aria-label={translate("Template source")}
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
                placeholder={translate("Preview as user…")}
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
            <div className="chip-group">
              <Chip mono>{format === "sing-box" ? "JSON" : "YAML"}</Chip>
              {preview && <Badge tone="good">{translate("Validated")}</Badge>}
            </div>
          </div>
          {preview ? (
            <ScrollArea className="code-output ide-output">
              <pre>{preview}</pre>
            </ScrollArea>
          ) : (
            <div className="ide-empty">
              <p className="muted">
                {translate(
                  "Select Validate & preview to render output for the selected user.",
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </Stage>
  );
}
