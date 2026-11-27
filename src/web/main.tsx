import {
  asUiError,
  type UiError,
  type Locale,
  formatNumber,
  setLocale,
  localizeError,
  localizeMessage,
  t as translate,
  useLocale,
} from "./i18n";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  RotateCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Terminal,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { api, formatUptime, when } from "./client";
import {
  Actions,
  Badge,
  BrandMark,
  BrandWordmark,
  Button,
  Chip,
  Confirm,
  DeployCommandModal,
  DriftModal,
  Empty,
  InlineTelemetry,
  initDocumentScrollbars,
  LanguageControl,
  LogsModal,
  MiniBar,
  Overview,
  PasswordLinkModal,
  QrCodeModal,
  QuotaBar,
  SearchInput,
  ScrollArea,
  SegmentedControl,
  Sparkline,
  Stage,
  Table,
  type QrCodeOption,
  type QrCodeTemplateOption,
} from "./components";
import {
  DEFAULT_ECH_PUBLIC_NAME,
  DEFAULT_TLS_SNI,
} from "../shared/tls";
import {
  Correction,
  EntityForm,
  ForceRemove,
  Login,
  OperationForm,
  SetPassword,
  TemplateEditor,
} from "./forms";
import { History } from "./history";
import { SubscriptionPortal } from "./portal";
import "./styles.css";
import {
  alertLabel,
  formatLabel,
  operationLabel,
  probeLabel,
  SUBSCRIPTION_FORMATS,
  taskLabel,
} from "./labels";
import type {
  PortalData,
  Row,
  Session,
  State,
  TemplateFormat,
} from "./types";

type AppRoute = "/" | "/portal" | "/set-password";

function readRoute(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/portal") return "/portal";
  if (path === "/set-password") return "/set-password";
  return "/";
}

function replaceRoute(to: AppRoute) {
  if (readRoute() !== to || window.location.hash) {
    window.history.replaceState(null, "", to);
  }
}

let spatialTransition: ViewTransition | undefined;

function transitionSpatialCards(update: () => void) {
  if (
    !document.startViewTransition ||
    !CSS.supports("view-transition-name", "match-element") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }

  const root = document.documentElement;
  root.classList.add("spatial-transition");
  const transition = document.startViewTransition(() => flushSync(update));
  spatialTransition = transition;
  const finish = () => {
    if (spatialTransition !== transition) return;
    spatialTransition = undefined;
    root.classList.remove("spatial-transition");
  };
  void transition.finished.then(finish, finish);
}

const initial: State = {
  controlPlane: null,
  hosts: [],
  nodes: [],
  users: [],
  templates: [],
  alerts: [],
  tasks: [],
  workers: [],
  origin: "",
};

const tabs = [
  ["Overview", LayoutDashboard],
  ["Infra", Server],
  ["Users", Users],
  ["Templates", FileCode2],
  ["Activity", Activity],
] as const;

type ConsoleView = {
  tab: (typeof tabs)[number][0];
  expandedHost: string | null;
  expandedUser: string | null;
};

const consoleViewKey = "jetyet-console-view";

function readConsoleView(): ConsoleView {
  try {
    const saved = JSON.parse(localStorage.getItem(consoleViewKey) ?? "null");
    return {
      tab: tabs.find(([tab]) => tab === saved?.tab)?.[0] ?? "Overview",
      expandedHost:
        typeof saved?.expandedHost === "string" ? saved.expandedHost : null,
      expandedUser:
        typeof saved?.expandedUser === "string" ? saved.expandedUser : null,
    };
  } catch {
    return { tab: "Overview", expandedHost: null, expandedUser: null };
  }
}

function useGridColumns(): 1 | 2 | 3 {
  const read = (): 1 | 2 | 3 => {
    if (typeof window === "undefined") return 3;
    if (window.matchMedia("(max-width: 640px)").matches) return 1;
    if (window.matchMedia("(max-width: 1080px)").matches) return 2;
    return 3;
  };
  const [cols, setCols] = useState<1 | 2 | 3>(read);
  useEffect(() => {
    const mqSm = window.matchMedia("(max-width: 640px)");
    const mqMd = window.matchMedia("(max-width: 1080px)");
    const update = () => setCols(read());
    mqSm.addEventListener("change", update);
    mqMd.addEventListener("change", update);
    return () => {
      mqSm.removeEventListener("change", update);
      mqMd.removeEventListener("change", update);
    };
  }, []);
  return cols;
}

const credentialRotation = {
  subscription: {
    label: "Rotate subscription link",
    title: "Rotate subscription link?",
    description: "The old subscription link will stop working.",
  },
  vpn: {
    label: "Rotate VPN credentials",
    title: "Rotate VPN credentials?",
    description:
      "Old VPN credentials will be revoked and active connections will be disconnected.",
  },
  both: {
    label: "Rotate both credentials",
    title: "Rotate subscription link and VPN credentials?",
    description:
      "The old subscription link and VPN credentials will stop working. Active connections will be disconnected.",
  },
} as const;

function hostSparkPoints(h: Row): number[] {
  const base = typeof h.cpu === "number" ? h.cpu : 24;
  const mem = typeof h.memory === "number" ? h.memory : 38;
  return [
    Math.max(5, base * 0.72),
    Math.max(5, base * 0.88),
    Math.max(5, (base + mem) * 0.45),
    Math.max(5, base * 1.05),
    Math.max(5, base * 0.92),
    Math.max(5, (base + mem) * 0.52),
    Math.max(5, base),
  ];
}

function ArchiveView({
  initialKind,
  onHistory,
  onClose,
}: {
  initialKind: "hosts" | "nodes" | "users";
  onHistory: (r: Row) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"hosts" | "nodes" | "users">(initialKind);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api("archive/" + kind)
      .then((res) => {
        if (!cancelled) {
          setRows(res || []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(asUiError(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return (
    <Stage
      title={translate("Archived records")}
      tag={translate("Archive")}
      onClose={onClose}
      actions={
        <SegmentedControl
          value={kind}
          options={[
            ["hosts", "VPS"],
            ["nodes", translate("Nodes")],
            ["users", translate("Users")],
          ]}
          onChange={setKind}
        />
      }
    >
      {error && <p className="form-error">{localizeError(error)}</p>}
      <section className="panel">
        {loading ? (
          <div className="chart-placeholder muted">
            {translate("Loading archive…")}
          </div>
        ) : rows.length ? (
          <Table
            headings={[
              translate("Name"),
              translate("Created"),
              translate("History"),
            ]}
          >
            {rows.map((r: Row) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{when(r.created)}</td>
                <td>
                  <Button onClick={() => onHistory(r)}>
                    {translate("View history")}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title={translate("No archived records")}>
            {translate("Deleted records retain their historical usage here.")}
          </Empty>
        )}
      </section>
    </Stage>
  );
}

function useAppView(locale: Locale) {
  const [renderView, setRenderView] = useState<(() => ReactNode) | null>(null);
  const view = useMemo(() => renderView?.(), [renderView, locale]);
  return [
    view,
    (render: (() => ReactNode) | null) => setRenderView(() => render),
  ] as const;
}

function App() {
  const locale = useLocale();
  const languageControl = (
    <LanguageControl
      locale={locale}
      onChange={setLocale}
      label={translate("Language")}
    />
  );
  useEffect(() => initDocumentScrollbars({ overflow: { x: "hidden" } }), []);
  const [stage, setStage] = useAppView(locale);
  const [modal, setModal] = useAppView(locale);
  const [verifyingHostId, setVerifyingHostId] = useState<string | null>(null);
  const verifyingHost = useRef(false);
  const gridCols = useGridColumns();
  const [consoleView, setConsoleView] = useState(readConsoleView);
  const { tab, expandedHost, expandedUser } = consoleView;
  const setTab = (tab: ConsoleView["tab"]) =>
    setConsoleView((view) => ({ ...view, tab }));
  const setExpandedHost = (expandedHost: string | null) =>
    setConsoleView((view) => ({ ...view, expandedHost }));
  const setExpandedUser = (expandedUser: string | null) =>
    setConsoleView((view) => ({ ...view, expandedUser }));
  const [route, setRoute] = useState<AppRoute>(readRoute),
    [session, setSession] = useState<Session | null>(null),
    [initialPortal, setInitialPortal] = useState<PortalData | null>(null),
    [checking, setChecking] = useState(() => readRoute() !== "/set-password"),
    [state, setState] = useState<State>(initial),
    [toast, setToast] = useState(""),
    [error, setError] = useState<UiError>(""),
    [search, setSearch] = useState(""),
    [inlineRange, setInlineRange] = useState("24"),
    [alertFilter, setAlertFilter] = useState<"all" | "open">("all"),
    [templateFormatFilter, setTemplateFormatFilter] = useState<
      "all" | TemplateFormat
    >("all"),
    [theme, setTheme] = useState<"light" | "dark">(() =>
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );

  useEffect(() => {
    try {
      localStorage.setItem(consoleViewKey, JSON.stringify(consoleView));
    } catch {}
  }, [consoleView]);

  useEffect(() => {
    const title =
      route === "/set-password"
        ? "Set password"
        : session?.role === "subscriber"
          ? "Subscription Portal"
          : session?.role === "admin"
            ? tab
            : "Sign in";
    document.title = `${translate(title)} · Jetyet`;
  }, [locale, route, session?.role, tab]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("jetyet-theme", next);
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "dark" ? "#111827" : "#f9fafb");
  };

  const refresh = async () => {
    try {
      const next: State = await api("state");
      setState(next);
      setConsoleView((view) => {
        const expandedHost =
          view.expandedHost === "control-plane" ||
          next.hosts.some((host) => host.id === view.expandedHost)
            ? view.expandedHost
            : null;
        const expandedUser = next.users.some(
          (user) => user.id === view.expandedUser,
        )
          ? view.expandedUser
          : null;
        return expandedHost === view.expandedHost &&
          expandedUser === view.expandedUser
          ? view
          : { ...view, expandedHost, expandedUser };
      });
      setError("");
    } catch (e) {
      setError(asUiError(e));
    }
  };

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (route === "/set-password") {
      setChecking(false);
    } else {
      api(route === "/portal" ? "session?portal=1" : "session")
        .then((x) => {
          if (x?.username && x?.role) {
            if (x.role === "subscriber") setInitialPortal(x.portal ?? null);
            setSession({ username: x.username, role: x.role });
          } else {
            setSession(null);
          }
        })
        .catch(() => {})
        .finally(() => setChecking(false));
    }
    const out = () => {
      setSession(null);
      setInitialPortal(null);
      setState(initial);
      setStage(null);
      setModal(null);
    };
    window.addEventListener("signedout", out);
    return () => window.removeEventListener("signedout", out);
  }, []);

  useEffect(() => {
    if (!session || route === "/set-password") return;
    const target: AppRoute = session.role === "admin" ? "/" : "/portal";
    if (route !== target) {
      replaceRoute(target);
      setRoute(target);
    }
  }, [session, route]);

  useEffect(() => {
    if (!session || session.role !== "admin" || route !== "/") return;
    void refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [session, route]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const run = async (fn: () => Promise<any>, message = "Saved") => {
    try {
      const result = await fn();
      await refresh();
      setToast(message);
      return result;
    } catch (e) {
      setError(asUiError(e));
      throw e;
    }
  };

  const act = (
    path: string,
    body?: unknown,
    method = "POST",
    message = "Queued",
  ) => void run(() => api(path, method, body), message).catch(() => {});

  const save = (kind: string, row?: Row) =>
    setStage(() => (
      <EntityForm
        key={row?.id || "new"}
        kind={kind}
        row={row}
        state={state}
        onClose={() => setStage(null)}
        onSave={async (data) => {
          await run(() =>
            api(kind + (row ? "/" + row.id : ""), row ? "PUT" : "POST", data),
          );
          setStage(null);
        }}
      />
    ));

  const operation = (n: Row, kind: string) => {
    if (kind === "detect") {
      act(`nodes/${n.id}/operation`, { kind });
      return;
    }
    setModal(() => (
      <OperationForm
        node={n}
        kind={kind}
        onClose={() => setModal(null)}
        onSubmit={async (payload) => {
          if (kind === "command") {
            const result = await api(`nodes/${n.id}/command`, "POST", payload);
            setModal(() => (
              <DeployCommandModal
                nodeName={n.name}
                command={result.command || ""}
                expiresAt={result.expiresAt || ""}
                congestion={payload.congestion}
                tuning={payload.tuning}
                tlsSecurity={payload.tlsSecurity}
                sni={payload.sni || DEFAULT_TLS_SNI}
                ech={payload.ech}
                echPublicName={payload.echPublicName || DEFAULT_ECH_PUBLIC_NAME}
                onDetect={() => {
                  setModal(null);
                  act(`nodes/${n.id}/operation`, { kind: "detect" });
                }}
                onClose={() => setModal(null)}
              />
            ));
          } else {
            const body =
              kind === "deploy" || kind === "upgrade"
                ? { kind, ...payload }
                : { kind, version: payload.version };
            await run(() => api(`nodes/${n.id}/operation`, "POST", body));
            setModal(null);
          }
        }}
      />
    ));
  };

  const links = async (u: Row) => {
    try {
      const data = await api(`users/${u.id}/links`);
      const options: QrCodeOption[] = [
        {
          value: "adaptive",
          label: translate("Adaptive"),
          url: data.default,
          tag: translate("Adaptive"),
        },
        ...SUBSCRIPTION_FORMATS.flatMap((fmt) =>
          data.formats?.[fmt]
            ? [
                {
                  value: fmt,
                  label: formatLabel(fmt),
                  url: data.formats[fmt],
                  tag: formatLabel(fmt),
                },
              ]
            : [],
        ),
      ];
      const templates: QrCodeTemplateOption[] = (data.templates || []).map(
        (t: Row) => {
          const tpl = state.templates.find((x) => x.id === t.id);
          const format = (tpl?.format ?? t.format) as
            | TemplateFormat
            | undefined;
          const isDefault = Boolean(
            format && u.defaultTemplates?.[format] === t.id,
          );
          return {
            value: t.id,
            label:
              `${tpl?.name || t.id}` +
              (format ? ` · ${formatLabel(format)}` : "") +
              (isDefault ? ` · ${translate("Default")}` : ""),
            format: format || "",
            group: "assigned",
            url: t.url,
            tag: format ? formatLabel(format) : undefined,
          };
        },
      );
      setModal(() => (
        <QrCodeModal
          title={translate("Subscription Links")}
          subtitle={translate(
            "Keep these links private. Share them only with {0}.",
            u.name,
          )}
          tag={translate("Adaptive")}
          url={data.default}
          options={options}
          templates={templates}
          onClose={() => setModal(null)}
        />
      ));
    } catch (e) {
      setError(asUiError(e));
    }
  };

  const passwordLink = async (u: Row) => {
    try {
      const data = (await api(`users/${u.id}/password-link`, "POST")) as {
        url: string;
        expires: number;
      };
      setModal(() => (
        <PasswordLinkModal
          userName={u.name}
          username={u.username}
          url={data.url}
          expires={data.expires}
          onClose={() => setModal(null)}
        />
      ));
    } catch (e) {
      setError(asUiError(e));
    }
  };

  const trust = async (h: Row) => {
    if (verifyingHost.current) return;
    verifyingHost.current = true;
    setVerifyingHostId(h.id);
    setError("");
    try {
      const result = await api(`hosts/${h.id}/fingerprint`, "POST");
      setModal(() => (
        <Confirm
          title={translate("Trust {0}'s SSH identity?", h.name)}
          action={translate("Trust host key")}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await run(
              () =>
                api(`hosts/${h.id}/trust`, "POST", {
                  fingerprint: result.fingerprint,
                }),
              "Host key trusted",
            );
            setModal(null);
          }}
        >
          <p>
            {translate(
              "Compare this fingerprint with your provider console before trusting the host:",
            )}
          </p>
          <ScrollArea className="code-output">
            <pre>{result.fingerprint}</pre>
          </ScrollArea>
        </Confirm>
      ));
    } catch (e) {
      setError(asUiError(e));
    } finally {
      verifyingHost.current = false;
      setVerifyingHostId(null);
    }
  };

  const remove = (kind: string, r: Row) =>
    setModal(() => (
      <Confirm
        title={translate("Delete {0}?", r.name)}
        action={translate("Delete")}
        danger
        onClose={() => setModal(null)}
        onConfirm={async () => {
          await run(() => api(`${kind}/${r.id}`, "DELETE"));
          setModal(null);
        }}
      >
        <p>
          {kind === "users"
            ? translate(
                "Subscription access is revoked immediately. Existing connections are queued for disconnection.",
              )
            : translate(
                "Nodes leave subscriptions immediately. Remote cleanup must succeed before deletion completes. The cloud server itself will not be destroyed.",
              )}{" "}
          {translate("Historical traffic is retained.")}
        </p>
      </Confirm>
    ));

  const history = (r: Row) =>
    setStage(() => <History entity={r} onClose={() => setStage(null)} />);

  const reset = (r: Row) =>
    setModal(() => (
      <Confirm
        title={translate("Reset {0}'s traffic?", r.name)}
        action={translate("Reset usage")}
        onClose={() => setModal(null)}
        onConfirm={async () => {
          await run(() => api(`usage/${r.id}/reset`, "POST"));
          setModal(null);
        }}
      >
        <p>
          {translate(
            "Start a new accounting period. History and scheduled reset times remain unchanged.",
          )}
        </p>
      </Confirm>
    ));

  const inspectDrift = (n: Row) =>
    void api(`nodes/${n.id}/drift`)
      .then((diff) =>
        setModal(() => (
          <DriftModal
            nodeName={n.name}
            desired={diff.desired || ""}
            observed={diff.observed || null}
            onReapply={() => operation(n, "reapply")}
            onClose={() => setModal(null)}
          />
        )),
      )
      .catch((e) => setError(asUiError(e)));

  if (route === "/set-password") {
    return (
      <SetPassword
        theme={theme}
        onToggleTheme={toggleTheme}
        languageControl={languageControl}
        onSuccess={(s) => {
          setSession(s);
          replaceRoute("/portal");
          setRoute("/portal");
        }}
        onBackToSignIn={() => {
          replaceRoute("/");
          setRoute("/");
        }}
      />
    );
  }
  if (checking)
    return <div className="loading">{translate("Loading Jetyet…")}</div>;
  if (!session)
    return (
      <Login
        onLogin={(s) => {
          setSession(s);
          const target: AppRoute = s.role === "admin" ? "/" : "/portal";
          replaceRoute(target);
          setRoute(target);
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
        languageControl={languageControl}
      />
    );
  if (session.role === "subscriber") {
    return (
      <SubscriptionPortal
        session={session}
        initialPortal={initialPortal}
        theme={theme}
        onToggleTheme={toggleTheme}
        languageControl={languageControl}
        onLogout={() =>
          void api("logout", "POST").then(() => {
            setSession(null);
            setInitialPortal(null);
            setState(initial);
          })
        }
      />
    );
  }

  const visible = (list: Row[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [
        r.name,
        r.username,
        r.address,
        r.note,
        r.kind,
        r.message,
        r.code,
        r.format,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  };

  const activeAlerts = state.alerts.filter((a) => !a.closed),
    nodeHealthy = state.nodes.filter(
      (n) =>
        n.enabled &&
        !n.deleting &&
        state.hosts.find((h) => h.id === n.hostId)?.enabled &&
        n.probe === "healthy" &&
        Date.now() - (n.probed || 0) < 600000 &&
        !state.hosts.find((h) => h.id === n.hostId)?.exhausted,
    ).length;

  const nodeTone = (node: Row, host: Row) => {
    if (
      node.deleting ||
      host.deleting ||
      !node.enabled ||
      !host.enabled ||
      host.exhausted
    )
      return "warning";
    if (node.status === "draft") return "neutral";
    return node.service ? "good" : "warning";
  };

  const hostsReachable = state.hosts.filter((h) => h.reachable).length;
  const totalOnline = state.nodes.reduce(
    (sum, n) =>
      sum +
      (Object.values(n.online || {}).reduce(
        (a: any, b: any) => a + b,
        0,
      ) as number),
    0,
  );
  const runningTasks = state.tasks.filter((t) =>
    ["queued", "running"].includes(t.state),
  ).length;

  const tabCount: Record<string, number> = {
    Overview: 0,
    Infra: state.hosts.length,
    Users: state.users.length,
    Templates: state.templates.length,
    Activity: activeAlerts.length + runningTasks,
  };

  const openArchive = (kind: "hosts" | "nodes" | "users") =>
    setStage(() => (
      <ArchiveView
        initialKind={kind}
        onHistory={(r) => history(r)}
        onClose={() => setStage(null)}
      />
    ));

  const controlPlaneEntity: Row = state.controlPlane
    ? {
        ...state.controlPlane,
        id: "control-plane",
        kind: "control-plane",
        name: translate("Control Plane"),
      }
    : {
        id: "control-plane",
        kind: "control-plane",
        name: translate("Control Plane"),
        reachable: false,
        uptime: null,
        cpu: null,
        memory: null,
        disk: null,
        interfaces: [],
      };
  const controlPlaneFresh =
    !!controlPlaneEntity.lastSeen &&
    Date.now() - controlPlaneEntity.lastSeen <= 180000;
  const workerAlive = (name: string) => {
    const hb = state.workers.find((w) => w.name === name);
    return !!hb && Date.now() - hb.at <= 30000;
  };

  const searchLower = search.trim().toLowerCase();
  const showControlPlane =
    !searchLower ||
    [
      controlPlaneEntity.name,
      controlPlaneEntity.hostname,
      "control plane",
      "control-plane",
      "local",
      "本机",
      "面板",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(searchLower);

  const visibleHosts = visible(state.hosts);
  const infraItems = showControlPlane
    ? [controlPlaneEntity, ...visibleHosts]
    : visibleHosts;
  const expandedInfraIdx = infraItems.findIndex((i) => i.id === expandedHost);
  const infraInsertAfter =
    expandedInfraIdx >= 0
      ? Math.min(
          infraItems.length - 1,
          Math.floor(expandedInfraIdx / gridCols) * gridCols + gridCols - 1,
        )
      : -1;

  const visibleUsers = visible(state.users);
  const expandedUserIdx = visibleUsers.findIndex((u) => u.id === expandedUser);
  const userInsertAfter =
    expandedUserIdx >= 0
      ? Math.min(
          visibleUsers.length - 1,
          Math.floor(expandedUserIdx / gridCols) * gridCols + gridCols - 1,
        )
      : -1;

  const inlineRangeOptions: [string, string][] = [
    ["1", translate("1h")],
    ["24", translate("24h")],
    ["168", translate("7d")],
    ["720", translate("30d")],
  ];

  const jumpToHost = (hostId: string) => {
    setStage(null);
    setSearch("");
    setConsoleView((view) => ({
      ...view,
      tab: "Infra",
      expandedHost: hostId,
    }));
  };

  const jumpToUser = (userId: string) => {
    setStage(null);
    setSearch("");
    setConsoleView((view) => ({
      ...view,
      tab: "Users",
      expandedUser: userId,
    }));
  };

  return (
    <div className="shell">
      <header className="command-bar">
        <div className="command-bar-inner">
          <div className="command-left">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setStage(null);
                setTab("Overview");
              }}
            >
              <BrandMark size={19} />
              <BrandWordmark />
            </a>
          </div>
          <ScrollArea
            as="nav"
            axis="x"
            className="dock"
            aria-label={translate("Primary navigation")}
          >
            {tabs.map(([name, Icon]) => {
              const count = tabCount[name] || 0;
              const isAlert = name === "Activity" && activeAlerts.length > 0;
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={translate(name)}
                  className={
                    !stage && tab === name ? "dock-item active" : "dock-item"
                  }
                  onClick={() => {
                    setStage(null);
                    setTab(name);
                    setSearch("");
                  }}
                >
                  <Icon size={15} />
                  <span>{translate(name)}</span>
                  {count > 0 && (
                    <b className={isAlert ? "alert-count" : ""}>
                      {formatNumber(count)}
                    </b>
                  )}
                </button>
              );
            })}
          </ScrollArea>
          <div className="command-right">
            {languageControl}
            <Button
              variant="icon"
              aria-label={
                theme === "dark"
                  ? translate("Switch to light mode")
                  : translate("Switch to dark mode")
              }
              onClick={toggleTheme}
              title={
                theme === "dark"
                  ? translate("Light mode")
                  : translate("Dark mode")
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <button
              type="button"
              className="account-chip"
              onClick={() =>
                void api("logout", "POST").then(() => {
                  setSession(null);
                  setState(initial);
                })
              }
              aria-label={translate("Sign out ({0})", session.username)}
              title={translate("Sign out ({0})", session.username)}
            >
              <span className="avatar">
                {session.username[0]?.toUpperCase()}
              </span>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>
      <main className="canvas">
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              {localizeError(error)}
              <button
                onClick={() => setError("")}
                aria-label={translate("Dismiss")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {stage ? (
            stage
          ) : (
            <>
              {tab === "Overview" && (
                <Overview
                  state={state}
                  hostsReachable={hostsReachable}
                  nodeHealthy={nodeHealthy}
                  totalOnline={totalOnline}
                  activeAlerts={activeAlerts}
                  runningTasks={runningTasks}
                  onJumpTab={(nextTab) => {
                    setStage(null);
                    setTab(nextTab);
                    setSearch("");
                  }}
                  onInspectHost={jumpToHost}
                  onInspectUser={jumpToUser}
                  onInspectControlPlane={() => jumpToHost("control-plane")}
                />
              )}

              {tab === "Infra" && (
                <>
                  <div className="action-strip">
                    <div className="strip-left">
                      <SearchInput
                        placeholder={translate("Filter VPS or nodes…")}
                        value={search}
                        onChange={setSearch}
                      />
                      <div className="pulse-chips">
                        <Chip mono>
                          <i className="status-dot good" />
                          {formatNumber(hostsReachable)}/
                          {formatNumber(state.hosts.length)} VPS
                        </Chip>
                        <Chip mono>
                          <Radio size={11} />
                          {formatNumber(nodeHealthy)}/
                          {formatNumber(state.nodes.length)}
                          {" " + translate("Nodes")}
                        </Chip>
                        <Chip mono>
                          {formatNumber(totalOnline)}
                          {" " + translate("Online")}
                        </Chip>
                      </div>
                    </div>
                    <div className="action-strip-right">
                      <Button
                        variant="subtle"
                        onClick={() => openArchive("hosts")}
                        title={translate("Archived hosts, nodes & users")}
                      >
                        <Archive size={14} />
                        <span>{translate("Archive")}</span>
                      </Button>
                      <Button onClick={() => save("nodes")}>
                        <Plus size={14} />
                        <span>{translate("Node")}</span>
                      </Button>
                      <Button variant="primary" onClick={() => save("hosts")}>
                        <Plus size={15} />
                        <span>VPS</span>
                      </Button>
                    </div>
                  </div>
                  {infraItems.length > 0 && (
                    <div className="spatial-grid">
                      {infraItems.map((h, idx) => {
                        const isControlPlane = h.kind === "control-plane";
                        const isActive = expandedHost === h.id;
                        const toggleExpand = () =>
                          transitionSpatialCards(() =>
                            setExpandedHost(isActive ? null : h.id),
                          );
                        const node = isControlPlane
                          ? undefined
                          : state.nodes.find((n) => n.hostId === h.id);
                        const clients = node
                          ? (Object.values(node.online || {}).reduce(
                              (a: any, b: any) => a + b,
                              0,
                            ) as number)
                          : 0;
                        const nTone =
                          !isControlPlane && node ? nodeTone(node, h) : "neutral";

                        const renderExpanded = (target: Row) => {
                          if (target.kind === "control-plane") {
                            return (
                              <article
                                key="expanded-control-plane"
                                className="spatial-card spatial-expanded control-plane-expanded"
                              >
                                <div className="expanded-head">
                                  <div className="expanded-head-left">
                                    <span
                                      className={
                                        "status-dot " +
                                        (controlPlaneFresh ? "good" : "warning")
                                      }
                                    />
                                    <h2>{translate("Control Plane")}</h2>
                                    <Badge tone="neutral">
                                      {translate("Local host")}
                                    </Badge>
                                    {target.hostname && (
                                      <span className="mono muted">
                                        {target.hostname}
                                      </span>
                                    )}
                                  </div>
                                  <div className="expanded-head-right">
                                    <SegmentedControl
                                      value={inlineRange}
                                      options={inlineRangeOptions}
                                      onChange={setInlineRange}
                                    />
                                    <Button
                                      variant="icon"
                                      onClick={() =>
                                        transitionSpatialCards(() =>
                                          setExpandedHost(null),
                                        )
                                      }
                                      aria-label={translate("Collapse")}
                                      title={translate("Collapse")}
                                    >
                                      <ChevronUp size={15} />
                                    </Button>
                                  </div>
                                </div>
                                <div className="expanded-zones">
                                  <InlineTelemetry
                                    entity={target}
                                    range={inlineRange}
                                  />
                                  <div className="expanded-actions-col">
                                    <div className="expanded-actions-head">
                                      <span className="kpi-label">
                                        {translate("CONTROL PLANE")}
                                      </span>
                                      <Cpu size={14} className="muted" aria-hidden="true" />
                                    </div>
                                    <ScrollArea
                                      axis="y"
                                      className="expanded-chips-scroll"
                                    >
                                      <div className="expanded-chips-inner">
                                        <div className="node-mini-meta">
                                          <strong>
                                            {target.hostname ||
                                              translate("Local host")}
                                          </strong>
                                          <small className="muted">
                                            {translate(
                                              "Self-host telemetry · excluded from VPS counts & quota",
                                            )}
                                          </small>
                                        </div>
                                        <div className="chip-group">
                                          {(["monitor", "operations"] as const).map(
                                            (name) => {
                                              const ok = workerAlive(name);
                                              return (
                                                <Badge
                                                  key={name}
                                                  tone={ok ? "good" : "warning"}
                                                >
                                                  {name} ·{" "}
                                                  {ok
                                                    ? translate("Healthy")
                                                    : translate("Stale")}
                                                </Badge>
                                              );
                                            },
                                          )}
                                        </div>
                                        {Array.isArray(target.interfaces) &&
                                          target.interfaces.length > 0 && (
                                            <div className="chip-group">
                                              {target.interfaces.map(
                                                (iface: string) => (
                                                  <Chip key={iface} mono>
                                                    {iface}
                                                  </Chip>
                                                ),
                                              )}
                                            </div>
                                          )}
                                      </div>
                                    </ScrollArea>
                                    <div className="expanded-quick-actions">
                                      <Button
                                        className="quick-row-btn"
                                        onClick={() => history(target)}
                                      >
                                        <span>{translate("Full telemetry")}</span>
                                        <ArrowUpRight
                                          size={14}
                                          className="muted"
                                        />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </article>
                            );
                          }

                          const tNode = state.nodes.find(
                            (n) => n.hostId === target.id,
                          );
                          const tClients = tNode
                            ? (Object.values(tNode.online || {}).reduce(
                                (a: any, b: any) => a + b,
                                0,
                              ) as number)
                            : 0;
                          const tTone = tNode ? nodeTone(tNode, target) : "neutral";
                          const hostActions: [string, () => void][] = [
                            [translate("Edit VPS"), () => save("hosts", target)],
                            [
                              translate("Full telemetry"),
                              () => history(target),
                            ],
                            [translate("Reset usage"), () => reset(target)],
                            [
                              translate("Correct usage"),
                              () =>
                                setModal(() => (
                                  <Correction
                                    host={target}
                                    onClose={() => setModal(null)}
                                    onSave={async (v) => {
                                      await run(() =>
                                        api(
                                          `hosts/${target.id}/correct`,
                                          "POST",
                                          v,
                                        ),
                                      );
                                      setModal(null);
                                    }}
                                  />
                                )),
                            ],
                            [
                              translate("Delete VPS"),
                              () => remove("hosts", target),
                            ],
                            [
                              translate("Force remove"),
                              () =>
                                setModal(() => (
                                  <ForceRemove
                                    host={target}
                                    onClose={() => setModal(null)}
                                    onSave={async () => {
                                      await run(() =>
                                        api(
                                          `hosts/${target.id}/force-remove`,
                                          "POST",
                                          {
                                            confirmation:
                                              "REMOTE HOST DESTROYED OR HANDLED INDEPENDENTLY",
                                          },
                                        ),
                                      );
                                      setModal(null);
                                    }}
                                  />
                                )),
                            ],
                          ];
                          const nodeActions: [string, () => void][] = tNode
                            ? [
                                [
                                  translate("Edit node"),
                                  () => save("nodes", tNode),
                                ],
                                [
                                  translate("Deploy"),
                                  () => operation(tNode, "deploy"),
                                ],
                                [
                                  translate("Show deploy command"),
                                  () => operation(tNode, "command"),
                                ],
                                [
                                  translate("Detect installation"),
                                  () => operation(tNode, "detect"),
                                ],
                                [
                                  translate("Upgrade"),
                                  () => operation(tNode, "upgrade"),
                                ],
                                [
                                  translate("Inspect drift"),
                                  () => inspectDrift(tNode),
                                ],
                                [
                                  translate("Reapply config"),
                                  () => operation(tNode, "reapply"),
                                ],
                                [
                                  translate("Node history"),
                                  () => history(tNode),
                                ],
                                [
                                  translate("Delete node"),
                                  () => remove("nodes", tNode),
                                ],
                              ]
                            : [];

                          return (
                            <article
                              key={`expanded-${target.id}`}
                              className="spatial-card spatial-expanded"
                            >
                              <div className="expanded-head">
                                <div className="expanded-head-left">
                                  <span
                                    className={
                                      "status-dot " +
                                      (!target.enabled
                                        ? "neutral"
                                        : target.reachable
                                          ? "good"
                                          : "warning")
                                    }
                                  />
                                  <h2>{target.name}</h2>
                                  <span className="mono muted">
                                    {target.address}:{target.port}
                                  </span>
                                  <button
                                    type="button"
                                    className={
                                      "trust-pill " +
                                      (target.fingerprint
                                        ? "trusted"
                                        : "verify")
                                    }
                                    disabled={verifyingHostId !== null}
                                    aria-busy={verifyingHostId === target.id}
                                    onClick={() => void trust(target)}
                                  >
                                    {verifyingHostId === target.id ? (
                                      <>
                                        <LoaderCircle
                                          size={13}
                                          className="spinning"
                                          aria-hidden="true"
                                        />
                                        {translate("Verifying SSH…")}
                                      </>
                                    ) : target.fingerprint ? (
                                      <>
                                        <ShieldCheck size={13} />
                                        {translate("SSH Trusted")}
                                      </>
                                    ) : (
                                      <>
                                        <ShieldAlert size={13} />
                                        {translate("Verify SSH")}
                                      </>
                                    )}
                                  </button>
                                  {target.deleting && (
                                    <Badge tone="warning">
                                      {translate("Pending deletion")}
                                    </Badge>
                                  )}
                                  {target.usageStale && (
                                    <Badge tone="warning">
                                      {translate("Stale data")}
                                    </Badge>
                                  )}
                                  {tNode && (
                                    <Badge tone={tTone}>
                                      {tNode.name} {tNode.version || ""} ·{" "}
                                      {translate("{0} online", tClients)}
                                    </Badge>
                                  )}
                                </div>
                                <div className="expanded-head-right">
                                  <SegmentedControl
                                    value={inlineRange}
                                    options={inlineRangeOptions}
                                    onChange={setInlineRange}
                                  />
                                  <Button onClick={() => save("hosts", target)}>
                                    {translate("Edit")}
                                  </Button>
                                  <Actions items={hostActions} />
                                  <Button
                                    variant="icon"
                                    onClick={() =>
                                      transitionSpatialCards(() =>
                                        setExpandedHost(null),
                                      )
                                    }
                                    aria-label={translate("Collapse")}
                                    title={translate("Collapse")}
                                  >
                                    <ChevronUp size={15} />
                                  </Button>
                                </div>
                              </div>
                              <div className="expanded-zones">
                                <InlineTelemetry
                                  entity={target}
                                  range={inlineRange}
                                />
                                <div className="expanded-actions-col">
                                  <div className="expanded-actions-head">
                                    <span className="kpi-label">
                                      {tNode
                                        ? translate("HYSTERIA 2 NODE")
                                        : translate("QUICK ACTIONS")}
                                    </span>
                                    {tNode && <Actions items={nodeActions} />}
                                  </div>
                                  {tNode && (
                                    <ScrollArea
                                      axis="y"
                                      className="expanded-chips-scroll"
                                    >
                                      <div className="node-mini-meta">
                                        <strong>{tNode.name}</strong>
                                        <small className="mono">
                                          {tNode.address}:{tNode.port}
                                        </small>
                                        <div className="chip-group node-specs">
                                          <Chip>
                                            {tNode.probed &&
                                            Date.now() - tNode.probed > 600000
                                              ? translate("Probe stale")
                                              : probeLabel(tNode.probe)}
                                          </Chip>
                                          {tNode.hopping && (
                                            <Chip mono>UDP {tNode.hopping}</Chip>
                                          )}
                                          {(tNode.version ||
                                            (tNode.status &&
                                              tNode.status !== "draft")) &&
                                            tNode.congestion && (
                                              <Chip>
                                                {tNode.congestion === "bbr"
                                                  ? "BBR"
                                                  : "Brutal"}
                                              </Chip>
                                            )}
                                          {(tNode.version ||
                                            (tNode.status &&
                                              tNode.status !== "draft")) &&
                                            tNode.tuning && (
                                              <Chip>
                                                {translate("Adaptive tuning")}
                                              </Chip>
                                            )}
                                          {(tNode.version ||
                                            (tNode.status &&
                                              tNode.status !== "draft")) &&
                                            (tNode.tlsSecurity === "pinned" ? (
                                              <>
                                                <Chip mono>
                                                  pinSHA256 ·{" "}
                                                  {tNode.sni || DEFAULT_TLS_SNI}
                                                </Chip>
                                                {tNode.ech && (
                                                  <Chip className="accent-chip">
                                                    ECH
                                                  </Chip>
                                                )}
                                              </>
                                            ) : (
                                              <Badge tone="warning">
                                                {translate("Legacy TLS")}
                                              </Badge>
                                            ))}
                                        </div>
                                      </div>
                                    </ScrollArea>
                                  )}
                                  <div className="expanded-quick-actions">
                                    {tNode ? (
                                      <>
                                        <Button
                                          className="quick-row-btn"
                                          onClick={() =>
                                            operation(
                                              tNode,
                                              tNode.version
                                                ? "upgrade"
                                                : "deploy",
                                            )
                                          }
                                        >
                                          <span>
                                            {tNode.version
                                              ? translate("Upgrade")
                                              : translate("Deploy")}
                                          </span>
                                          <span className="mono muted">
                                            {tNode.version || "v2"}
                                          </span>
                                        </Button>
                                        <Button
                                          className="quick-row-btn"
                                          onClick={() => inspectDrift(tNode)}
                                        >
                                          <span>{translate("Config drift")}</span>
                                          <Badge
                                            tone={
                                              tNode.drift ? "warning" : "good"
                                            }
                                          >
                                            {tNode.drift
                                              ? translate("Drift")
                                              : translate("Clean")}
                                          </Badge>
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="primary"
                                        onClick={() => save("nodes")}
                                      >
                                        <Plus size={14} />
                                        {translate("Attach Node")}
                                      </Button>
                                    )}
                                    <Button
                                      className="quick-row-btn"
                                      onClick={() => reset(target)}
                                    >
                                      <span>{translate("Reset usage")}</span>
                                      <span className="mono muted">
                                        {when(target.usage.next)}
                                      </span>
                                    </Button>
                                    <Button
                                      className="quick-row-btn"
                                      onClick={() => history(target)}
                                    >
                                      <span>{translate("Full telemetry")}</span>
                                      <ArrowUpRight
                                        size={14}
                                        className="muted"
                                      />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        };

                        return (
                          <Fragment key={h.id}>
                            <article
                              className={
                                "spatial-card spatial-compact" +
                                (isActive ? " is-active" : "") +
                                (isControlPlane ? " control-plane-card" : "")
                              }
                              onClick={toggleExpand}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isActive}
                              onKeyDown={(e) => {
                                if (
                                  e.target === e.currentTarget &&
                                  (e.key === "Enter" || e.key === " ")
                                ) {
                                  e.preventDefault();
                                  toggleExpand();
                                }
                              }}
                            >
                              <div className="compact-head">
                                <span
                                  className={
                                    "status-dot " +
                                    (isControlPlane
                                      ? controlPlaneFresh
                                        ? "good"
                                        : "warning"
                                      : !h.enabled
                                        ? "neutral"
                                        : h.reachable
                                          ? "good"
                                          : "warning")
                                  }
                                />
                                <div className="entity-title">
                                  <strong className="compact-name">
                                    {h.name}
                                  </strong>
                                  <small className="mono">
                                    {isControlPlane
                                      ? h.hostname || translate("Local host")
                                      : h.address}
                                  </small>
                                </div>
                                {isControlPlane ? (
                                  <Badge tone="neutral">
                                    {translate("Local host")}
                                  </Badge>
                                ) : (
                                  <Sparkline
                                    points={hostSparkPoints(h)}
                                    tone={
                                      (h.cpu || 0) >= 85
                                        ? "danger"
                                        : h.reachable
                                          ? "accent"
                                          : "warning"
                                    }
                                  />
                                )}
                              </div>
                              <div className="entity-meters">
                                <MiniBar label="CPU" percent={h.cpu} />
                                <MiniBar label="RAM" percent={h.memory} />
                              </div>
                              {isControlPlane ? (
                                <MiniBar
                                  label={translate("Disk")}
                                  percent={h.disk}
                                />
                              ) : (
                                <QuotaBar row={h} />
                              )}
                              <div className="compact-foot">
                                {isControlPlane ? (
                                  <div className="chip-group">
                                    <Chip mono>
                                      {translate(
                                        "Up {0}",
                                        formatUptime(h.uptime),
                                      )}
                                    </Chip>
                                    <Badge
                                      tone={
                                        workerAlive("monitor") &&
                                        workerAlive("operations")
                                          ? "good"
                                          : "warning"
                                      }
                                    >
                                      {workerAlive("monitor") &&
                                      workerAlive("operations")
                                        ? translate("Workers OK")
                                        : translate("Worker stale")}
                                    </Badge>
                                  </div>
                                ) : node ? (
                                  <div className="chip-group">
                                    <Badge tone={node.drift ? "warning" : nTone}>
                                      {node.name}
                                      {node.drift
                                        ? ` · ${translate("Drift")}`
                                        : ` · ${translate("{0} online", clients)}`}
                                    </Badge>
                                    {(node.version ||
                                      (node.status &&
                                        node.status !== "draft")) &&
                                      node.tlsSecurity !== "pinned" && (
                                        <Badge tone="warning">
                                          {translate("Legacy TLS")}
                                        </Badge>
                                      )}
                                  </div>
                                ) : (
                                  <Chip>{translate("No node")}</Chip>
                                )}
                                <span className="expand-cue">
                                  {isActive ? (
                                    <ChevronUp size={14} />
                                  ) : (
                                    <ChevronDown size={14} />
                                  )}
                                </span>
                              </div>
                            </article>
                            {idx === infraInsertAfter &&
                              renderExpanded(infraItems[expandedInfraIdx])}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                  {!state.hosts.length && (
                    <section className="panel infra-empty-panel">
                      <Empty
                        title={translate("No hosts connected")}
                        action={
                          <Button
                            variant="primary"
                            onClick={() => save("hosts")}
                          >
                            <Plus size={15} />
                            {translate("Add VPS")}
                          </Button>
                        }
                      >
                        {translate("Add a VPS to start managing your network.")}
                      </Empty>
                    </section>
                  )}
                </>
              )}

              {tab === "Users" && (
                <>
                  <div className="action-strip">
                    <SearchInput
                      placeholder={translate("Filter users…")}
                      value={search}
                      onChange={setSearch}
                    />
                    <div className="action-strip-right">
                      <Button
                        variant="subtle"
                        onClick={() => openArchive("users")}
                      >
                        <Archive size={14} />
                        <span>{translate("Archive")}</span>
                      </Button>
                      <Button variant="primary" onClick={() => save("users")}>
                        <Plus size={15} />
                        <span>{translate("User")}</span>
                      </Button>
                    </div>
                  </div>
                  {!state.users.length ? (
                    <section className="panel">
                      <Empty
                        title={translate("No users yet")}
                        action={
                          <Button
                            variant="primary"
                            onClick={() => save("users")}
                          >
                            <Plus size={15} />
                            {translate("Add User")}
                          </Button>
                        }
                      >
                        {translate(
                          "Issue independent links, tokens and quotas.",
                        )}
                      </Empty>
                    </section>
                  ) : (
                    <div className="spatial-grid">
                      {visibleUsers.map((u, idx) => {
                        const expired =
                          u.expires && Date.parse(u.expires) < Date.now();
                        const onlineCount = state.nodes.reduce(
                          (sum, n) => sum + (n.online?.[u.id] || 0),
                          0,
                        );
                        const isActive = expandedUser === u.id;
                        const toggleExpand = () =>
                          transitionSpatialCards(() =>
                            setExpandedUser(isActive ? null : u.id),
                          );
                        const statusTone =
                          !u.enabled || u.exhausted || expired
                            ? "warning"
                            : "good";
                        const statusLabel = !u.enabled
                          ? translate("Disabled")
                          : expired
                            ? translate("Expired")
                            : u.exhausted
                              ? translate("Exhausted")
                              : translate("Active");

                        const renderExpandedUser = (target: Row) => {
                          const tExpired =
                            target.expires &&
                            Date.parse(target.expires) < Date.now();
                          const tOnline = state.nodes.reduce(
                            (sum, n) => sum + (n.online?.[target.id] || 0),
                            0,
                          );
                          const tTone =
                            !target.enabled || target.exhausted || tExpired
                              ? "warning"
                              : "good";
                          const tStatus = !target.enabled
                            ? translate("Disabled")
                            : tExpired
                              ? translate("Expired")
                              : target.exhausted
                                ? translate("Exhausted")
                                : translate("Active");
                          const userActions: [string, () => void][] = [
                            [translate("Edit"), () => save("users", target)],
                            [
                              translate("Subscription links"),
                              () => void links(target),
                            ],
                            [
                              translate("Portal password link"),
                              () => void passwordLink(target),
                            ],
                            [
                              translate("Full telemetry"),
                              () => history(target),
                            ],
                            [translate("Reset usage"), () => reset(target)],
                            ...(["subscription", "vpn", "both"] as const).map(
                              (rotTarget) =>
                                [
                                  translate(
                                    credentialRotation[rotTarget].label,
                                  ),
                                  () =>
                                    setModal(() => (
                                      <Confirm
                                        title={translate(
                                          credentialRotation[rotTarget].title,
                                        )}
                                        action={translate("Rotate")}
                                        onClose={() => setModal(null)}
                                        onConfirm={async () => {
                                          await run(() =>
                                            api(
                                              `users/${target.id}/rotate`,
                                              "POST",
                                              {
                                                target: rotTarget,
                                              },
                                            ),
                                          );
                                          setModal(null);
                                        }}
                                      >
                                        <p>
                                          {translate(
                                            credentialRotation[rotTarget]
                                              .description,
                                          )}
                                        </p>
                                      </Confirm>
                                    )),
                                ] as [string, () => void],
                            ),
                            [
                              translate("Delete"),
                              () => remove("users", target),
                            ],
                          ];

                          return (
                            <article
                              key={`expanded-${target.id}`}
                              className="spatial-card spatial-expanded"
                            >
                              <div className="expanded-head">
                                <div className="expanded-head-left">
                                  <span className="avatar">
                                    {target.name[0]?.toUpperCase()}
                                  </span>
                                  <h2>{target.name}</h2>
                                  {target.username && (
                                    <Chip mono>@{target.username}</Chip>
                                  )}
                                  {target.note && (
                                    <span className="muted">{target.note}</span>
                                  )}
                                  <Badge tone={tTone}>{tStatus}</Badge>
                                  <Chip mono>
                                    {translate("{0} online", tOnline)}
                                  </Chip>
                                  {target.expires && (
                                    <Chip mono>
                                      {translate(
                                        "Exp {0}",
                                        when(target.expires),
                                      )}
                                    </Chip>
                                  )}
                                  {target.usageStale && (
                                    <Badge tone="warning">
                                      {translate("Stale")}
                                    </Badge>
                                  )}
                                </div>
                                <div className="expanded-head-right">
                                  <SegmentedControl
                                    value={inlineRange}
                                    options={inlineRangeOptions}
                                    onChange={setInlineRange}
                                  />
                                  <Button
                                    variant="primary"
                                    onClick={() => void links(target)}
                                  >
                                    <Link2 size={14} />
                                    {translate("Links")}
                                  </Button>
                                  <Button
                                    onClick={() => void passwordLink(target)}
                                  >
                                    <KeyRound size={14} />
                                    {translate("Password link")}
                                  </Button>
                                  <Button
                                    onClick={() => save("users", target)}
                                  >
                                    {translate("Edit")}
                                  </Button>
                                  <Actions items={userActions} />
                                  <Button
                                    variant="icon"
                                    onClick={() =>
                                      transitionSpatialCards(() =>
                                        setExpandedUser(null),
                                      )
                                    }
                                    aria-label={translate("Collapse")}
                                    title={translate("Collapse")}
                                  >
                                    <ChevronUp size={15} />
                                  </Button>
                                </div>
                              </div>
                              <div className="expanded-zones">
                                <InlineTelemetry
                                  entity={target}
                                  range={inlineRange}
                                />
                                <div className="expanded-actions-col">
                                  <span className="kpi-label">
                                    {translate(
                                      "AUTHORIZED NODES ({0})",
                                      target.nodeIds.length,
                                    )}
                                  </span>
                                  <ScrollArea
                                    axis="y"
                                    className="expanded-chips-scroll"
                                  >
                                    <div className="expanded-chips-inner">
                                      <div className="chip-group">
                                        {target.nodeIds.map((nid: string) => {
                                          const n = state.nodes.find(
                                            (x) => x.id === nid,
                                          );
                                          if (!n) return null;
                                          const on = n.online?.[target.id] || 0;
                                          return (
                                            <Chip key={nid} mono={on > 0}>
                                              {n.name}
                                              {on > 0 ? ` · ${on}` : ""}
                                            </Chip>
                                          );
                                        })}
                                      </div>
                                      {target.templateIds?.length > 0 && (
                                        <div className="chip-group">
                                          {target.templateIds.map(
                                            (tid: string) => {
                                              const t = state.templates.find(
                                                (x) => x.id === tid,
                                              );
                                              if (!t) return null;
                                              const isDefault =
                                                target.defaultTemplates?.[
                                                  t.format
                                                ] === tid;
                                              return (
                                                <Chip
                                                  key={tid}
                                                  className={
                                                    isDefault
                                                      ? "accent-chip"
                                                      : ""
                                                  }
                                                >
                                                  {t.name} ·{" "}
                                                  {formatLabel(t.format)}
                                                  {isDefault
                                                    ? ` · ${translate("Default")}`
                                                    : ""}
                                                </Chip>
                                              );
                                            },
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </ScrollArea>
                                  <div className="expanded-quick-actions">
                                    <Button
                                      className="quick-row-btn"
                                      onClick={() => reset(target)}
                                    >
                                      <span>{translate("Reset usage")}</span>
                                      <span className="mono muted">
                                        {when(target.usage.next)}
                                      </span>
                                    </Button>
                                    <Button
                                      className="quick-row-btn"
                                      onClick={() => history(target)}
                                    >
                                      <span>{translate("Full telemetry")}</span>
                                      <ArrowUpRight
                                        size={14}
                                        className="muted"
                                      />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        };

                        return (
                          <Fragment key={u.id}>
                            <article
                              className={
                                "spatial-card spatial-compact" +
                                (isActive ? " is-active" : "")
                              }
                              onClick={toggleExpand}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isActive}
                              onKeyDown={(e) => {
                                if (
                                  e.target === e.currentTarget &&
                                  (e.key === "Enter" || e.key === " ")
                                ) {
                                  e.preventDefault();
                                  toggleExpand();
                                }
                              }}
                            >
                              <div className="compact-head">
                                <span className="avatar">
                                  {u.name[0]?.toUpperCase()}
                                </span>
                                <div className="entity-title">
                                  <strong className="compact-name">
                                    {u.name}
                                  </strong>
                                  <small>
                                    {u.username
                                      ? `@${u.username}${u.note ? ` · ${u.note}` : ""}`
                                      : u.note || "—"}
                                  </small>
                                </div>
                                <Badge tone={statusTone}>{statusLabel}</Badge>
                                <Button
                                  variant="icon"
                                  aria-label={translate("Subscription links")}
                                  title={translate("Subscription links")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void links(u);
                                  }}
                                >
                                  <Link2 size={14} />
                                </Button>
                              </div>
                              <QuotaBar row={u} />
                              <div className="compact-foot">
                                <div className="chip-group">
                                  <Chip mono>
                                    {translate("{0} nodes", u.nodeIds.length)}
                                  </Chip>
                                  <Chip mono>
                                    {translate("{0} online", onlineCount)}
                                  </Chip>
                                </div>
                                <span className="expand-cue">
                                  {isActive ? (
                                    <ChevronUp size={14} />
                                  ) : (
                                    <ChevronDown size={14} />
                                  )}
                                </span>
                              </div>
                            </article>
                            {idx === userInsertAfter &&
                              renderExpandedUser(visibleUsers[expandedUserIdx])}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {tab === "Templates" && (
                <>
                  <div className="action-strip">
                    <div className="strip-left">
                      <SearchInput
                        placeholder={translate("Filter templates…")}
                        value={search}
                        onChange={setSearch}
                      />
                      <SegmentedControl
                        value={templateFormatFilter}
                        options={[
                          ["all", translate("All")],
                          ["mihomo", "mihomo"],
                          ["sing-box", "sing-box"],
                        ]}
                        onChange={setTemplateFormatFilter}
                      />
                    </div>
                    <div className="action-strip-right">
                      <Button
                        variant="primary"
                        onClick={() =>
                          setStage(() => (
                            <TemplateEditor
                              state={state}
                              onClose={() => setStage(null)}
                              refresh={refresh}
                            />
                          ))
                        }
                      >
                        <Plus size={15} />
                        <span>{translate("Template")}</span>
                      </Button>
                    </div>
                  </div>
                  <div className="templates-grid">
                    {visible(state.templates)
                      .filter(
                        (t) =>
                          templateFormatFilter === "all" ||
                          t.format === templateFormatFilter,
                      )
                      .map((t) => {
                        const src = t.draft || t.body || "";
                        const lines = src.split("\n");
                        const usersUsing = state.users.filter((u) =>
                          u.templateIds?.includes(t.id),
                        ).length;
                        return (
                          <button
                            type="button"
                            className="template-card"
                            key={t.id}
                            onClick={() =>
                              setStage(() => (
                                <TemplateEditor
                                  template={t}
                                  state={state}
                                  onClose={() => setStage(null)}
                                  refresh={refresh}
                                />
                              ))
                            }
                          >
                            <div className="template-card-head">
                              <span className="file-icon">
                                <FileCode2 size={17} />
                              </span>
                              <h2>{t.name}</h2>
                              <div className="chip-group template-badges">
                                {t.published && t.draft && t.draft !== t.body && (
                                  <Badge tone="warning">
                                    {translate("Draft edits")}
                                  </Badge>
                                )}
                                <Badge tone={t.published ? "good" : "neutral"}>
                                  {t.published
                                    ? translate("Published")
                                    : translate("Draft")}
                                </Badge>
                              </div>
                            </div>
                            <pre>{lines.slice(0, 8).join("\n")}</pre>
                            <div className="template-card-foot">
                              <div className="chip-group">
                                <Chip mono>{formatLabel(t.format)}</Chip>
                                {t.builtin && (
                                  <Chip>{translate("Built-in")}</Chip>
                                )}
                                <Chip mono>
                                  {translate("{0} lines", lines.length)}
                                </Chip>
                                <Chip mono>
                                  {translate("{0} users", usersUsing)}
                                </Chip>
                              </div>
                              <span className="text-button">
                                {translate("Studio") + " "}
                                <ArrowUpRight size={14} />
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </>
              )}

              {tab === "Activity" && (
                <div className="activity-split">
                  <section className="panel">
                    <div className="panel-heading compact">
                      <div className="chip-group">
                        <h2>{translate("Alerts")}</h2>
                        <span
                          className={
                            "count" + (activeAlerts.length ? " warn" : "")
                          }
                        >
                          {translate("{0} open", activeAlerts.length)}
                        </span>
                      </div>
                      <SegmentedControl
                        value={alertFilter}
                        options={[
                          ["all", translate("All")],
                          ["open", translate("Open")],
                        ]}
                        onChange={setAlertFilter}
                      />
                    </div>
                    {!(alertFilter === "open" ? activeAlerts : state.alerts)
                      .length ? (
                      <div className="quiet radar-quiet">
                        <span className="quiet-ring">
                          <ShieldCheck size={26} />
                        </span>
                        <h3>{translate("All quiet")}</h3>
                      </div>
                    ) : (
                      (alertFilter === "open"
                        ? activeAlerts
                        : state.alerts
                      ).map((a) => (
                        <div
                          className={
                            "alert-row " + (a.closed ? "resolved" : "")
                          }
                          key={a.id}
                        >
                          <span className="alert-mark" />
                          <div>
                            <div>
                              <strong>{alertLabel(a.code)}</strong>
                              <Badge tone={a.closed ? "neutral" : "warning"}>
                                {a.closed
                                  ? translate("Closed")
                                  : a.seen
                                    ? translate("Read")
                                    : translate("Open")}
                              </Badge>
                            </div>
                            <p>{localizeMessage(a.message)}</p>
                            <small>
                              {when(a.first)} → {when(a.last)}
                            </small>
                          </div>
                          <div className="row-buttons">
                            {!a.seen && (
                              <Button
                                onClick={() =>
                                  act(
                                    `alerts/${a.id}/read`,
                                    undefined,
                                    "POST",
                                    "Marked read",
                                  )
                                }
                              >
                                <Check size={13} />
                                {translate("Read")}
                              </Button>
                            )}
                            {!a.closed && (
                              <Button
                                onClick={() =>
                                  act(
                                    `alerts/${a.id}/close`,
                                    undefined,
                                    "POST",
                                    "Closed",
                                  )
                                }
                              >
                                <X size={13} />
                                {translate("Close")}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading compact">
                      <h2>{translate("Operations")}</h2>
                      <span className="count">
                        {formatNumber(state.tasks.length)}
                      </span>
                    </div>
                    {!state.tasks.length ? (
                      <Empty title={translate("No operations yet")}>
                        {translate("Deployments and remote tasks appear here.")}
                      </Empty>
                    ) : (
                      <div className="ops-list">
                        {state.tasks.map((t) => {
                          const hostName =
                            state.hosts.find((h) => h.id === t.host)?.name ||
                            translate("Removed");
                          return (
                            <div className="op-row" key={t.id}>
                              <span
                                className={"op-icon " + t.state}
                                aria-label={translate(
                                  "Task state {0}",
                                  taskLabel(t.state),
                                )}
                                role="img"
                              >
                                {t.state === "succeeded" ? (
                                  <CheckCircle2 size={16} />
                                ) : t.state === "failed" ? (
                                  <XCircle size={16} />
                                ) : t.state === "running" ? (
                                  <RefreshCw size={15} className="spinning" />
                                ) : (
                                  <Clock size={15} />
                                )}
                              </span>
                              <div className="op-main">
                                <div className="op-head">
                                  <strong>{operationLabel(t.kind)}</strong>
                                  <Chip>{hostName}</Chip>
                                  <Chip mono>
                                    {translate("Step {0}", t.step)}
                                  </Chip>
                                </div>
                                {t.error && (
                                  <p className="op-error">
                                    {translate(
                                      "Operation failed. {0}",
                                      t.error,
                                    )}
                                  </p>
                                )}
                              </div>
                              <small className="mono op-time">
                                {when(t.updated)}
                              </small>
                              <div className="row-buttons">
                                <Button
                                  variant="subtle"
                                  onClick={() =>
                                    void api(`tasks/${t.id}/logs`).then(
                                      (logs) =>
                                        setModal(() => (
                                          <LogsModal
                                            title={`${operationLabel(t.kind)} · ${hostName}`}
                                            logs={logs || []}
                                            onClose={() => setModal(null)}
                                          />
                                        )),
                                    )
                                  }
                                >
                                  <Terminal size={13} />
                                  {translate("Logs")}
                                </Button>
                                {["queued", "running"].includes(t.state) && (
                                  <Button
                                    aria-label={translate("Cancel operation")}
                                    onClick={() => act(`tasks/${t.id}/cancel`)}
                                  >
                                    <X size={13} />
                                  </Button>
                                )}
                                {["failed", "cancelled"].includes(t.state) && (
                                  <Button
                                    aria-label={translate("Retry operation")}
                                    onClick={() => act(`tasks/${t.id}/retry`)}
                                  >
                                    <RotateCw size={13} />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {modal}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {localizeMessage(toast)}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
