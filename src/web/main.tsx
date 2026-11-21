import "@fontsource-variable/space-grotesk";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileCode2,
  KeyRound,
  Link2,
  LogOut,
  Moon,
  Network,
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
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api, when } from "./client";
import {
  Actions,
  Badge,
  Button,
  Chip,
  Code,
  Confirm,
  DriftModal,
  Empty,
  InlineTelemetry,
  LogsModal,
  MiniBar,
  PasswordLinkModal,
  QuotaBar,
  SearchInput,
  SegmentedControl,
  Sparkline,
  Stage,
  SubscriptionLinksModal,
  Table,
} from "./components";
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
import type { Row, Session, State } from "./types";

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

const initial: State = {
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
  ["Infra", Server],
  ["Users", Users],
  ["Templates", FileCode2],
  ["Activity", Activity],
] as const;

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
  const [error, setError] = useState("");

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
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return (
    <Stage
      title="Archived records"
      tag="Archive"
      onClose={onClose}
      actions={
        <SegmentedControl
          value={kind}
          options={[
            ["hosts", "VPS"],
            ["nodes", "Nodes"],
            ["users", "Users"],
          ]}
          onChange={setKind}
        />
      }
    >
      {error && <p className="form-error">{error}</p>}
      <section className="panel">
        {loading ? (
          <div className="chart-placeholder muted">Loading archive…</div>
        ) : rows.length ? (
          <Table headings={["Name", "Created", "History"]}>
            {rows.map((r: Row) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{when(r.created)}</td>
                <td>
                  <Button onClick={() => onHistory(r)}>View history</Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No archived records">
            Deleted records retain their historical usage here.
          </Empty>
        )}
      </section>
    </Stage>
  );
}

function App() {
  const [route, setRoute] = useState<AppRoute>(readRoute),
    [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(() => readRoute() !== "/set-password"),
    [state, setState] = useState<State>(initial),
    [tab, setTab] = useState("Infra"),
    [stage, setStage] = useState<ReactNode>(null),
    [modal, setModal] = useState<ReactNode>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [expandedHost, setExpandedHost] = useState<string | null | undefined>(
      undefined,
    ),
    [expandedUser, setExpandedUser] = useState<string | null>(null),
    [inlineRange, setInlineRange] = useState("24"),
    [alertFilter, setAlertFilter] = useState<"all" | "open">("all"),
    [theme, setTheme] = useState<"light" | "dark">(() =>
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );

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
      const next = await api("state");
      setState(next);
      setExpandedHost((prev) =>
        prev === undefined ? next.hosts?.[0]?.id || null : prev,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
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
      api("session")
        .then((x) => {
          if (x?.username && x?.role) {
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
    setLoading(true);
    try {
      const result = await fn();
      await refresh();
      setToast(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const act = (
    path: string,
    body?: unknown,
    method = "POST",
    message = "Queued",
  ) => void run(() => api(path, method, body), message).catch(() => {});

  const save = (kind: string, row?: Row) =>
    setStage(
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
      />,
    );

  const operation = (n: Row, kind: string) => {
    if (kind === "detect") {
      act(`nodes/${n.id}/operation`, { kind });
      return;
    }
    setModal(
      <OperationForm
        node={n}
        kind={kind}
        onClose={() => setModal(null)}
        onSubmit={async (version) => {
          if (kind === "command") {
            const result = await api(`nodes/${n.id}/command`, "POST", {
              version,
            });
            setModal(
              <Code
                title="Run on this VPS as root"
                text={result.script}
                onClose={() => setModal(null)}
              />,
            );
          } else {
            await run(() =>
              api(`nodes/${n.id}/operation`, "POST", { kind, version }),
            );
            setModal(null);
          }
        }}
      />,
    );
  };

  const links = async (u: Row) => {
    try {
      const data = await api(`users/${u.id}/links`);
      setModal(
        <SubscriptionLinksModal
          userName={u.name}
          items={[
            {
              id: "default",
              label: "Default subscription",
              url: data.default,
              isDefault: true,
            },
            ...(data.templates || []).map((t: Row) => ({
              id: t.id,
              label:
                state.templates.find((x) => x.id === t.id)?.name || t.id,
              url: t.url,
            })),
          ]}
          onClose={() => setModal(null)}
        />,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const passwordLink = async (u: Row) => {
    try {
      const data = (await api(`users/${u.id}/password-link`, "POST")) as {
        url: string;
        expires: number;
      };
      setModal(
        <PasswordLinkModal
          userName={u.name}
          username={u.username}
          url={data.url}
          expires={data.expires}
          onClose={() => setModal(null)}
        />,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const trust = async (h: Row) => {
    try {
      const result = await api(`hosts/${h.id}/fingerprint`, "POST");
      setModal(
        <Confirm
          title={`Trust ${h.name}'s SSH identity?`}
          action="Trust host key"
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
            Compare this fingerprint with your provider console before trusting
            the host:
          </p>
          <pre className="code-output">{result.fingerprint}</pre>
        </Confirm>,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = (kind: string, r: Row) =>
    setModal(
      <Confirm
        title={`Delete ${r.name}?`}
        action="Delete"
        danger
        onClose={() => setModal(null)}
        onConfirm={async () => {
          await run(() => api(`${kind}/${r.id}`, "DELETE"));
          setModal(null);
        }}
      >
        <p>
          {kind === "users"
            ? "Subscription access is revoked immediately. Existing connections are queued for disconnection."
            : "Nodes leave subscriptions immediately. Remote cleanup must succeed before deletion completes. The cloud server itself will not be destroyed."}{" "}
          Historical traffic is retained.
        </p>
      </Confirm>,
    );

  const history = (r: Row) =>
    setStage(<History entity={r} onClose={() => setStage(null)} />);

  const reset = (r: Row) =>
    setModal(
      <Confirm
        title={`Reset ${r.name}'s traffic?`}
        action="Reset usage"
        onClose={() => setModal(null)}
        onConfirm={async () => {
          await run(() => api(`usage/${r.id}/reset`, "POST"));
          setModal(null);
        }}
      >
        <p>
          Start a new accounting period. History and scheduled reset times
          remain unchanged.
        </p>
      </Confirm>,
    );

  const inspectDrift = (n: Row) =>
    void api(`nodes/${n.id}/drift`)
      .then((diff) =>
        setModal(
          <DriftModal
            nodeName={n.name}
            desired={diff.desired || ""}
            observed={diff.observed || null}
            onReapply={() => operation(n, "reapply")}
            onClose={() => setModal(null)}
          />,
        ),
      )
      .catch((e) => setError(e.message));

  if (route === "/set-password") {
    return (
      <SetPassword
        theme={theme}
        onToggleTheme={toggleTheme}
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
  if (checking) return <div className="loading">Loading Jetyet…</div>;
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
      />
    );
  if (session.role === "subscriber") {
    return (
      <SubscriptionPortal
        session={session}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={() =>
          void api("logout", "POST").then(() => {
            setSession(null);
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
      [r.name, r.username, r.address, r.note, r.kind, r.message, r.code]
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

  const nodeLabel = (n: Row) => {
    const h = state.hosts.find((h) => h.id === n.hostId);
    return n.deleting || h?.deleting
      ? "Pending deletion"
      : !n.enabled || !h?.enabled
        ? "Disabled"
        : h?.exhausted
          ? "Quota exhausted"
          : n.status === "draft"
            ? "Planned"
            : n.service
              ? "Running"
              : "Stopped";
  };

  const worker = (name: string) => {
    const w = state.workers.find((w) => w.name === name);
    return w && Date.now() - w.at < 30000;
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
    Infra: state.hosts.length,
    Users: state.users.length,
    Templates: state.templates.length,
    Activity: activeAlerts.length + runningTasks,
  };

  const openArchive = (kind: "hosts" | "nodes" | "users") =>
    setStage(
      <ArchiveView
        initialKind={kind}
        onHistory={(r) => history(r)}
        onClose={() => setStage(null)}
      />,
    );

  const visibleHosts = visible(state.hosts);
  const orderedHosts = [...visibleHosts].sort((a, b) =>
    a.id === expandedHost ? -1 : b.id === expandedHost ? 1 : 0,
  );
  const visibleUsers = visible(state.users);
  const orderedUsers = [...visibleUsers].sort((a, b) =>
    a.id === expandedUser ? -1 : b.id === expandedUser ? 1 : 0,
  );

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
                setTab("Infra");
              }}
            >
              <span className="brand-symbol">
                <Network size={19} />
              </span>
              jetyet<span className="brand-period">.</span>
            </a>
            <div className="worker-pills" aria-label="Background workers">
              {(
                [
                  ["monitor", "MON"],
                  ["operations", "OPS"],
                ] as const
              ).map(([name, short]) => (
                <span
                  key={name}
                  className={
                    "worker-pill " + (worker(name) ? "online" : "offline")
                  }
                  title={`${name}: ${worker(name) ? "Running" : "No heartbeat"}`}
                >
                  <i />
                  {short}
                </span>
              ))}
            </div>
          </div>
          <nav className="dock" aria-label="Primary navigation">
            {tabs.map(([name, Icon]) => {
              const count = tabCount[name] || 0;
              const isAlert = name === "Activity" && activeAlerts.length > 0;
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
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
                  <span>{name}</span>
                  {count > 0 && (
                    <b className={isAlert ? "alert-count" : ""}>{count}</b>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="command-right">
            <Button
              variant="icon"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              onClick={toggleTheme}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button
              variant="icon"
              aria-label="Refresh"
              className={loading ? "spinning" : ""}
              disabled={loading}
              onClick={() => void refresh()}
              title="Refresh"
            >
              <RefreshCw size={15} />
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
              title={`Sign out (${session.username})`}
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
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
          {stage ? (
            stage
          ) : (
            <>
              {tab === "Infra" && (
                <>
                  <div className="action-strip">
                    <div className="strip-left">
                      <SearchInput
                        placeholder="Filter VPS or nodes…"
                        value={search}
                        onChange={setSearch}
                      />
                      <div className="pulse-chips">
                        <Chip mono>
                          <i className="status-dot good" />
                          {hostsReachable}/{state.hosts.length} VPS
                        </Chip>
                        <Chip mono>
                          <Radio size={11} />
                          {nodeHealthy}/{state.nodes.length} Nodes
                        </Chip>
                        <Chip mono>{totalOnline} Online</Chip>
                      </div>
                    </div>
                    <div className="action-strip-right">
                      <Button
                        variant="subtle"
                        onClick={() => openArchive("hosts")}
                        title="Archived hosts, nodes & users"
                      >
                        <Archive size={14} />
                        <span>Archive</span>
                      </Button>
                      <Button onClick={() => save("nodes")}>
                        <Plus size={14} />
                        <span>Node</span>
                      </Button>
                      <Button variant="primary" onClick={() => save("hosts")}>
                        <Plus size={15} />
                        <span>VPS</span>
                      </Button>
                    </div>
                  </div>
                  {!state.hosts.length ? (
                    <section className="panel">
                      <Empty
                        title="No hosts connected"
                        action={
                          <Button
                            variant="primary"
                            onClick={() => save("hosts")}
                          >
                            <Plus size={15} />
                            Add VPS
                          </Button>
                        }
                      >
                        Add a VPS to start managing your network.
                      </Empty>
                    </section>
                  ) : (
                    <div className="spatial-grid">
                      {orderedHosts.map((h) => {
                        const node = state.nodes.find((n) => n.hostId === h.id);
                        const clients = node
                          ? (Object.values(node.online || {}).reduce(
                              (a: any, b: any) => a + b,
                              0,
                            ) as number)
                          : 0;
                        const isExpanded = expandedHost === h.id;
                        const nLabel = node ? nodeLabel(node) : "";
                        const hostActions: [string, () => void][] = [
                          ["Edit VPS", () => save("hosts", h)],
                          ["Full telemetry", () => history(h)],
                          ["Reset usage", () => reset(h)],
                          [
                            "Correct usage",
                            () =>
                              setModal(
                                <Correction
                                  host={h}
                                  onClose={() => setModal(null)}
                                  onSave={async (v) => {
                                    await run(() =>
                                      api(`hosts/${h.id}/correct`, "POST", v),
                                    );
                                    setModal(null);
                                  }}
                                />,
                              ),
                          ],
                          ["Delete VPS", () => remove("hosts", h)],
                          [
                            "Force remove",
                            () =>
                              setModal(
                                <ForceRemove
                                  host={h}
                                  onClose={() => setModal(null)}
                                  onSave={async () => {
                                    await run(() =>
                                      api(
                                        `hosts/${h.id}/force-remove`,
                                        "POST",
                                        {
                                          confirmation:
                                            "REMOTE HOST DESTROYED OR HANDLED INDEPENDENTLY",
                                        },
                                      ),
                                    );
                                    setModal(null);
                                  }}
                                />,
                              ),
                          ],
                        ];
                        const nodeActions: [string, () => void][] = node
                          ? [
                              ["Edit node", () => save("nodes", node)],
                              ["Deploy", () => operation(node, "deploy")],
                              [
                                "Show deploy command",
                                () => operation(node, "command"),
                              ],
                              [
                                "Detect installation",
                                () => operation(node, "detect"),
                              ],
                              ["Upgrade", () => operation(node, "upgrade")],
                              [
                                "Inspect drift",
                                () => inspectDrift(node),
                              ],
                              ["Reapply config", () => operation(node, "reapply")],
                              ["Node history", () => history(node)],
                              ["Delete node", () => remove("nodes", node)],
                            ]
                          : [];

                        if (isExpanded) {
                          return (
                            <article
                              key={h.id}
                              className="spatial-card spatial-expanded"
                            >
                              <div className="expanded-head">
                                <div className="expanded-head-left">
                                  <span
                                    className={
                                      "status-dot " +
                                      (!h.enabled
                                        ? "neutral"
                                        : h.reachable
                                          ? "good"
                                          : "warning")
                                    }
                                  />
                                  <h2>{h.name}</h2>
                                  <span className="mono muted">
                                    {h.address}:{h.port}
                                  </span>
                                  <button
                                    type="button"
                                    className={
                                      "trust-pill " +
                                      (h.fingerprint ? "trusted" : "verify")
                                    }
                                    onClick={() => void trust(h)}
                                  >
                                    {h.fingerprint ? (
                                      <>
                                        <ShieldCheck size={13} />
                                        SSH Trusted
                                      </>
                                    ) : (
                                      <>
                                        <ShieldAlert size={13} />
                                        Verify SSH
                                      </>
                                    )}
                                  </button>
                                  {h.deleting && (
                                    <Badge tone="warning">
                                      Pending deletion
                                    </Badge>
                                  )}
                                  {h.usageStale && (
                                    <Badge tone="warning">Stale data</Badge>
                                  )}
                                  {node && (
                                    <Badge
                                      tone={
                                        nLabel === "Running"
                                          ? "good"
                                          : nLabel === "Planned"
                                            ? "neutral"
                                            : "warning"
                                      }
                                    >
                                      {node.name} {node.version || ""} ·{" "}
                                      {clients} online
                                    </Badge>
                                  )}
                                </div>
                                <div className="expanded-head-right">
                                  <SegmentedControl
                                    value={inlineRange}
                                    options={[
                                      ["24", "24h"],
                                      ["168", "7d"],
                                      ["720", "30d"],
                                    ]}
                                    onChange={setInlineRange}
                                  />
                                  <Button onClick={() => save("hosts", h)}>
                                    Edit
                                  </Button>
                                  <Actions items={hostActions} />
                                  <Button
                                    variant="subtle"
                                    onClick={() => setExpandedHost(null)}
                                    title="Collapse"
                                  >
                                    <ChevronUp size={15} />
                                  </Button>
                                </div>
                              </div>
                              <div className="expanded-zones">
                                <InlineTelemetry
                                  entity={h}
                                  range={inlineRange}
                                />
                                <div className="expanded-actions-col">
                                  <div className="expanded-actions-head">
                                    <span className="kpi-label">
                                      {node
                                        ? "HYSTERIA 2 NODE"
                                        : "QUICK ACTIONS"}
                                    </span>
                                    {node && <Actions items={nodeActions} />}
                                  </div>
                                  {node ? (
                                    <>
                                      <div className="node-mini-meta">
                                        <strong>{node.name}</strong>
                                        <small className="mono">
                                          {node.address}:{node.port}
                                        </small>
                                        <div className="chip-group node-specs">
                                          <Chip>
                                            {node.probed &&
                                            Date.now() - node.probed > 600000
                                              ? "Probe stale"
                                              : node.probe || "Pending"}
                                          </Chip>
                                          {node.hopping && (
                                            <Chip mono>UDP {node.hopping}</Chip>
                                          )}
                                          {(node.upMbps > 0 ||
                                            node.downMbps > 0) && (
                                            <Chip mono>
                                              ↑{node.upMbps}↓{node.downMbps}M
                                            </Chip>
                                          )}
                                        </div>
                                      </div>
                                      <Button
                                        className="quick-row-btn"
                                        onClick={() =>
                                          operation(
                                            node,
                                            node.version ? "upgrade" : "deploy",
                                          )
                                        }
                                      >
                                        <span>
                                          {node.version ? "Upgrade" : "Deploy"}
                                        </span>
                                        <span className="mono muted">
                                          {node.version || "v2"}
                                        </span>
                                      </Button>
                                      <Button
                                        className="quick-row-btn"
                                        onClick={() => inspectDrift(node)}
                                      >
                                        <span>Config drift</span>
                                        <Badge
                                          tone={node.drift ? "warning" : "good"}
                                        >
                                          {node.drift ? "Drift" : "Clean"}
                                        </Badge>
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      onClick={() => save("nodes")}
                                    >
                                      <Plus size={14} />
                                      Attach Node
                                    </Button>
                                  )}
                                  <Button
                                    className="quick-row-btn"
                                    onClick={() => reset(h)}
                                  >
                                    <span>Reset usage</span>
                                    <span className="mono muted">
                                      {when(h.usage.next)}
                                    </span>
                                  </Button>
                                  <Button
                                    className="quick-row-btn"
                                    onClick={() => history(h)}
                                  >
                                    <span>Full telemetry</span>
                                    <ArrowUpRight size={14} className="muted" />
                                  </Button>
                                </div>
                              </div>
                            </article>
                          );
                        }

                        return (
                          <article
                            key={h.id}
                            className="spatial-card spatial-compact"
                            onClick={() => setExpandedHost(h.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedHost(h.id);
                              }
                            }}
                          >
                            <div className="compact-head">
                              <span
                                className={
                                  "status-dot " +
                                  (!h.enabled
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
                                <small className="mono">{h.address}</small>
                              </div>
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
                            </div>
                            <div className="entity-meters">
                              <MiniBar label="CPU" percent={h.cpu} />
                              <MiniBar label="RAM" percent={h.memory} />
                            </div>
                            <QuotaBar row={h} />
                            <div className="compact-foot">
                              {node ? (
                                <Badge
                                  tone={
                                    node.drift
                                      ? "warning"
                                      : nLabel === "Running"
                                        ? "good"
                                        : nLabel === "Planned"
                                          ? "neutral"
                                          : "warning"
                                  }
                                >
                                  {node.name}
                                  {node.drift
                                    ? " · Drift"
                                    : ` · ${clients} on`}
                                </Badge>
                              ) : (
                                <Chip>No node</Chip>
                              )}
                              <span className="expand-cue">
                                <ChevronDown size={14} />
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {tab === "Users" && (
                <>
                  <div className="action-strip">
                    <SearchInput
                      placeholder="Filter users…"
                      value={search}
                      onChange={setSearch}
                    />
                    <div className="action-strip-right">
                      <Button
                        variant="subtle"
                        onClick={() => openArchive("users")}
                      >
                        <Archive size={14} />
                        <span>Archive</span>
                      </Button>
                      <Button variant="primary" onClick={() => save("users")}>
                        <Plus size={15} />
                        <span>User</span>
                      </Button>
                    </div>
                  </div>
                  {!state.users.length ? (
                    <section className="panel">
                      <Empty
                        title="No users yet"
                        action={
                          <Button
                            variant="primary"
                            onClick={() => save("users")}
                          >
                            <Plus size={15} />
                            Add User
                          </Button>
                        }
                      >
                        Issue independent links, tokens and quotas.
                      </Empty>
                    </section>
                  ) : (
                    <div className="spatial-grid">
                      {orderedUsers.map((u) => {
                        const expired =
                          u.expires && Date.parse(u.expires) < Date.now();
                        const onlineCount = state.nodes.reduce(
                          (sum, n) => sum + (n.online?.[u.id] || 0),
                          0,
                        );
                        const isExpanded = expandedUser === u.id;
                        const userActions: [string, () => void][] = [
                          ["Edit", () => save("users", u)],
                          ["Subscription links", () => void links(u)],
                          ["Portal password link", () => void passwordLink(u)],
                          ["Full telemetry", () => history(u)],
                          ["Reset usage", () => reset(u)],
                          ...(["subscription", "vpn", "both"] as const).map(
                            (target) =>
                              [
                                `Rotate ${target}`,
                                () =>
                                  setModal(
                                    <Confirm
                                      title={`Rotate ${target} credentials?`}
                                      action="Rotate"
                                      onClose={() => setModal(null)}
                                      onConfirm={async () => {
                                        await run(() =>
                                          api(`users/${u.id}/rotate`, "POST", {
                                            target,
                                          }),
                                        );
                                        setModal(null);
                                      }}
                                    >
                                      <p>
                                        Old{" "}
                                        {target === "subscription"
                                          ? "subscription links"
                                          : "VPN credentials and active connections"}{" "}
                                        will be revoked.
                                      </p>
                                    </Confirm>,
                                  ),
                              ] as [string, () => void],
                          ),
                          ["Delete", () => remove("users", u)],
                        ];
                        const statusTone =
                          !u.enabled || u.exhausted || expired
                            ? "warning"
                            : "good";
                        const statusLabel = !u.enabled
                          ? "Disabled"
                          : expired
                            ? "Expired"
                            : u.exhausted
                              ? "Exhausted"
                              : "Active";

                        if (isExpanded) {
                          return (
                            <article
                              key={u.id}
                              className="spatial-card spatial-expanded"
                            >
                              <div className="expanded-head">
                                <div className="expanded-head-left">
                                  <span className="avatar">
                                    {u.name[0]?.toUpperCase()}
                                  </span>
                                  <h2>{u.name}</h2>
                                  {u.username && (
                                    <Chip mono>@{u.username}</Chip>
                                  )}
                                  {u.note && (
                                    <span className="muted">{u.note}</span>
                                  )}
                                  <Badge tone={statusTone}>{statusLabel}</Badge>
                                  <Chip mono>{onlineCount} online</Chip>
                                  {u.expires && (
                                    <Chip mono>Exp {when(u.expires)}</Chip>
                                  )}
                                  {u.usageStale && (
                                    <Badge tone="warning">Stale</Badge>
                                  )}
                                </div>
                                <div className="expanded-head-right">
                                  <SegmentedControl
                                    value={inlineRange}
                                    options={[
                                      ["24", "24h"],
                                      ["168", "7d"],
                                      ["720", "30d"],
                                    ]}
                                    onChange={setInlineRange}
                                  />
                                  <Button
                                    variant="primary"
                                    onClick={() => void links(u)}
                                  >
                                    <Link2 size={14} />
                                    Links
                                  </Button>
                                  <Button onClick={() => void passwordLink(u)}>
                                    <KeyRound size={14} />
                                    Password link
                                  </Button>
                                  <Button onClick={() => save("users", u)}>
                                    Edit
                                  </Button>
                                  <Actions items={userActions} />
                                  <Button
                                    variant="subtle"
                                    onClick={() => setExpandedUser(null)}
                                    title="Collapse"
                                  >
                                    <ChevronUp size={15} />
                                  </Button>
                                </div>
                              </div>
                              <div className="expanded-zones">
                                <InlineTelemetry
                                  entity={u}
                                  range={inlineRange}
                                />
                                <div className="expanded-actions-col">
                                  <span className="kpi-label">
                                    AUTHORIZED NODES ({u.nodeIds.length})
                                  </span>
                                  <div className="chip-group">
                                    {u.nodeIds.map((nid: string) => {
                                      const n = state.nodes.find(
                                        (x) => x.id === nid,
                                      );
                                      if (!n) return null;
                                      const on = n.online?.[u.id] || 0;
                                      return (
                                        <Chip key={nid} mono={on > 0}>
                                          {n.name}
                                          {on > 0 ? ` · ${on}` : ""}
                                        </Chip>
                                      );
                                    })}
                                  </div>
                                  {u.templateIds?.length > 0 && (
                                    <div className="chip-group">
                                      {u.templateIds.map((tid: string) => {
                                        const t = state.templates.find(
                                          (x) => x.id === tid,
                                        );
                                        if (!t) return null;
                                        return (
                                          <Chip
                                            key={tid}
                                            className={
                                              tid === u.defaultTemplate
                                                ? "accent-chip"
                                                : ""
                                            }
                                          >
                                            {t.name}
                                          </Chip>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <Button
                                    className="quick-row-btn"
                                    onClick={() => reset(u)}
                                  >
                                    <span>Reset usage</span>
                                    <span className="mono muted">
                                      {when(u.usage.next)}
                                    </span>
                                  </Button>
                                  <Button
                                    className="quick-row-btn"
                                    onClick={() => history(u)}
                                  >
                                    <span>Full telemetry</span>
                                    <ArrowUpRight size={14} className="muted" />
                                  </Button>
                                </div>
                              </div>
                            </article>
                          );
                        }

                        return (
                          <article
                            key={u.id}
                            className="spatial-card spatial-compact"
                            onClick={() => setExpandedUser(u.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedUser(u.id);
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
                                aria-label="Subscription links"
                                title="Subscription links"
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
                                <Chip mono>{u.nodeIds.length} nodes</Chip>
                                <Chip mono>{onlineCount} on</Chip>
                              </div>
                              <span className="expand-cue">
                                <ChevronDown size={14} />
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {tab === "Templates" && (
                <>
                  <div className="action-strip">
                    <SearchInput
                      placeholder="Filter templates…"
                      value={search}
                      onChange={setSearch}
                    />
                    <div className="action-strip-right">
                      <Button
                        variant="primary"
                        onClick={() =>
                          setStage(
                            <TemplateEditor
                              state={state}
                              onClose={() => setStage(null)}
                              refresh={refresh}
                            />,
                          )
                        }
                      >
                        <Plus size={15} />
                        <span>Template</span>
                      </Button>
                    </div>
                  </div>
                  <div className="templates-grid">
                    {visible(state.templates).map((t) => {
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
                            setStage(
                              <TemplateEditor
                                template={t}
                                state={state}
                                onClose={() => setStage(null)}
                                refresh={refresh}
                              />,
                            )
                          }
                        >
                          <div className="template-card-head">
                            <span className="file-icon">
                              <FileCode2 size={17} />
                            </span>
                            <h2>{t.name}</h2>
                            <div className="chip-group template-badges">
                              {t.published && t.draft && t.draft !== t.body && (
                                <Badge tone="warning">Draft edits</Badge>
                              )}
                              <Badge tone={t.published ? "good" : "neutral"}>
                                {t.published ? "Published" : "Draft"}
                              </Badge>
                            </div>
                          </div>
                          <pre>{lines.slice(0, 8).join("\n")}</pre>
                          <div className="template-card-foot">
                            <div className="chip-group">
                              <Chip mono>{lines.length} lines</Chip>
                              <Chip mono>{usersUsing} users</Chip>
                            </div>
                            <span className="text-button">
                              Studio <ArrowUpRight size={14} />
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
                        <h2>Alerts</h2>
                        <span
                          className={
                            "count" + (activeAlerts.length ? " warn" : "")
                          }
                        >
                          {activeAlerts.length} open
                        </span>
                      </div>
                      <SegmentedControl
                        value={alertFilter}
                        options={[
                          ["all", "All"],
                          ["open", "Open"],
                        ]}
                        onChange={setAlertFilter}
                      />
                    </div>
                    {!(
                      alertFilter === "open" ? activeAlerts : state.alerts
                    ).length ? (
                      <div className="quiet radar-quiet">
                        <span className="quiet-ring">
                          <ShieldCheck size={26} />
                        </span>
                        <h3>All quiet</h3>
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
                              <strong>{a.code.replaceAll("-", " ")}</strong>
                              <Badge tone={a.closed ? "neutral" : "warning"}>
                                {a.closed ? "Closed" : a.seen ? "Read" : "Open"}
                              </Badge>
                            </div>
                            <p>{a.message}</p>
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
                                Read
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
                                Close
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading compact">
                      <h2>Operations</h2>
                      <span className="count">{state.tasks.length}</span>
                    </div>
                    {!state.tasks.length ? (
                      <Empty title="No operations yet">
                        Deployments and remote tasks appear here.
                      </Empty>
                    ) : (
                      <div className="ops-list">
                        {state.tasks.map((t) => {
                          const hostName =
                            state.hosts.find((h) => h.id === t.host)?.name ||
                            "Removed";
                          return (
                            <div className="op-row" key={t.id}>
                              <span className={"op-icon " + t.state}>
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
                                  <strong>{t.kind}</strong>
                                  <Chip>{hostName}</Chip>
                                  <Chip mono>step {t.step}</Chip>
                                </div>
                                {t.error && (
                                  <p className="op-error">{t.error}</p>
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
                                        setModal(
                                          <LogsModal
                                            title={`${t.kind} · ${hostName}`}
                                            logs={logs || []}
                                            onClose={() => setModal(null)}
                                          />,
                                        ),
                                    )
                                  }
                                >
                                  <Terminal size={13} />
                                  Logs
                                </Button>
                                {["queued", "running"].includes(t.state) && (
                                  <Button
                                    onClick={() => act(`tasks/${t.id}/cancel`)}
                                  >
                                    <X size={13} />
                                  </Button>
                                )}
                                {["failed", "cancelled"].includes(t.state) && (
                                  <Button
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
          {toast}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
