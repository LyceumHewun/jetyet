import "@fontsource-variable/space-grotesk";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  FileCode2,
  ListChecks,
  LogOut,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api, when } from "./client";
import {
  Actions,
  Badge,
  Code,
  Confirm,
  Dialog,
  Empty,
  QuotaBar,
  Stat,
  Table,
} from "./components";
import {
  Correction,
  EntityForm,
  ForceRemove,
  Login,
  OperationForm,
  TemplateEditor,
} from "./forms";
import { History } from "./history";
import "./styles.css";
import type { Row, State } from "./types";
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
  ["Overview", Activity],
  ["VPS", Server],
  ["Nodes", Radio],
  ["Users", Users],
  ["Templates", FileCode2],
  ["Operations", ListChecks],
  ["Alerts", Bell],
] as const;

function App() {
  const [session, setSession] = useState<string | null>(null),
    [checking, setChecking] = useState(true),
    [state, setState] = useState<State>(initial),
    [tab, setTab] = useState("Overview"),
    [modal, setModal] = useState<ReactNode>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState("");
  const refresh = async () => {
    try {
      setState(await api("state"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    api("session")
      .then((x) => setSession(x.username))
      .catch(() => {})
      .finally(() => setChecking(false));
    const out = () => {
      setSession(null);
      setModal(null);
    };
    window.addEventListener("signedout", out);
    return () => window.removeEventListener("signedout", out);
  }, []);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [session]);
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
    setModal(
      <EntityForm
        key={row?.id || "new"}
        kind={kind}
        row={row}
        state={state}
        onClose={() => setModal(null)}
        onSave={async (data) => {
          await run(() =>
            api(kind + (row ? "/" + row.id : ""), row ? "PUT" : "POST", data),
          );
          setModal(null);
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
        <Code
          title={`${u.name} · subscription links`}
          text={[
            `Default\n${data.default}`,
            ...data.templates.map(
              (t: Row) =>
                `${state.templates.find((x) => x.id === t.id)?.name || t.id}\n${t.url}`,
            ),
          ].join("\n\n")}
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
          title="Verify SSH host identity"
          onClose={() => setModal(null)}
          action="Trust fingerprint"
          onConfirm={async () => {
            await run(() => api(`hosts/${h.id}/trust`, "POST", result));
            setModal(null);
          }}
        >
          <p>
            Compare this fingerprint with your server provider or a trusted
            connection before continuing.
          </p>
          <pre>{result.fingerprint}</pre>
          <p>
            {h.username}@{h.address}:{h.port}
          </p>
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
    setModal(<History entity={r} onClose={() => setModal(null)} />);
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
  if (checking) return <div className="loading">Loading Jetyet…</div>;
  if (!session) return <Login onLogin={setSession} />;
  const visible = (list: Row[]) =>
    list.filter((r) =>
      (r.name || r.kind || r.message || "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
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
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("Overview");
          }}
        >
          <span className="brand-symbol">
            <Network size={20} />
          </span>
          jetyet<span className="brand-period">.</span>
        </a>
        <div className="workspace-label">PERSONAL NETWORK</div>
        <nav>
          {tabs.map(([name, Icon]) => (
            <button
              key={name}
              aria-label={name}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(name);
                setSearch("");
              }}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Alerts" && activeAlerts.length > 0 && (
                <b>{activeAlerts.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="worker-heading">BACKGROUND WORKERS</div>
          {["monitor", "operations"].map((name) => (
            <div className="worker" key={name}>
              <i className={worker(name) ? "online" : "offline"} />
              <span>{name === "monitor" ? "Monitoring" : "Operations"}</span>
              <small>{worker(name) ? "Running" : "No heartbeat"}</small>
            </div>
          ))}
          <button
            className="account"
            onClick={() =>
              void api("logout", "POST").then(() => setSession(null))
            }
          >
            <span className="avatar">{session[0]?.toUpperCase()}</span>
            <span>
              {session}
              <small>Administrator</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} />
            <strong>{tab}</strong>
          </span>
          <div>
            <span className="timezone">Hong Kong · UTC+8</span>
            <button
              aria-label="Refresh"
              className="icon-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Alerts"
              onClick={() => setTab("Alerts")}
            >
              <Bell size={17} />
              {activeAlerts.length > 0 && <i className="notification-dot" />}
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">NETWORK CONTROL</div>
              <h1>{tab === "Overview" ? "Your network, at a glance." : tab}</h1>
              <p>
                {
                  (
                    {
                      Overview:
                        "Hosts, connections and access. One place to keep things running.",
                      VPS: "Manage SSH access, host health and provider traffic allowances.",
                      Nodes: "Native Hysteria 2 services. One node per host.",
                      Users:
                        "Individual access, shared nodes, independent allowances.",
                      Templates:
                        "Complete mihomo configurations, shaped for your users.",
                      Operations:
                        "Persisted remote work, from deployment to cleanup.",
                      Alerts: "Faults, recoveries and accounting gaps.",
                    } as Record<string, string>
                  )[tab]
                }
              </p>
            </div>
            {["VPS", "Nodes", "Users", "Templates"].includes(tab) && (
              <button
                className="primary"
                onClick={() =>
                  tab === "Templates"
                    ? setModal(
                        <TemplateEditor
                          state={state}
                          onClose={() => setModal(null)}
                          refresh={refresh}
                        />,
                      )
                    : save(
                        (
                          {
                            VPS: "hosts",
                            Nodes: "nodes",
                            Users: "users",
                          } as Record<string, string>
                        )[tab],
                      )
                }
              >
                <Plus size={16} />
                Add{" "}
                {
                  (
                    {
                      VPS: "VPS",
                      Nodes: "node",
                      Users: "user",
                      Templates: "template",
                    } as Record<string, string>
                  )[tab]
                }
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "Overview" && (
            <>
              <div className="stats">
                <Stat
                  label="VPS HOSTS"
                  value={state.hosts.length}
                  detail={`${state.hosts.filter((h) => h.reachable).length} reachable`}
                  icon={<Server size={18} />}
                />
                <Stat
                  label="HEALTHY NODES"
                  value={`${nodeHealthy} / ${state.nodes.length}`}
                  detail="Authenticated proxy probes"
                  icon={<Radio size={18} />}
                />
                <Stat
                  label="SUBSCRIPTION USERS"
                  value={state.users.length}
                  detail={`${state.users.filter((u) => u.enabled).length} enabled`}
                  icon={<Users size={18} />}
                />
                <Stat
                  label="OPEN ALERTS"
                  value={activeAlerts.length}
                  detail="In-platform records"
                  icon={<Bell size={18} />}
                />
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Infrastructure</h2>
                    <button
                      className="text-button"
                      onClick={() => setTab("VPS")}
                    >
                      All hosts <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {!state.hosts.length ? (
                    <Empty
                      title="Connect your first VPS"
                      action={
                        <button
                          className="primary"
                          onClick={() => save("hosts")}
                        >
                          <Plus size={15} />
                          Add VPS
                        </button>
                      }
                    >
                      Add SSH access, confirm its identity, then deploy a node.
                    </Empty>
                  ) : (
                    state.hosts.slice(0, 6).map((h) => (
                      <button
                        key={h.id}
                        className="host-strip"
                        onClick={() => history(h)}
                      >
                        <span className="host-icon">
                          <Server size={18} />
                        </span>
                        <span>
                          <strong>{h.name}</strong>
                          <small className="mono">{h.address}</small>
                        </span>
                        <Badge
                          tone={
                            !h.enabled
                              ? "neutral"
                              : h.reachable
                                ? "good"
                                : "warning"
                          }
                        >
                          {!h.enabled
                            ? "Disabled"
                            : h.reachable
                              ? "Reachable"
                              : "Unknown"}
                        </Badge>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Needs attention</h2>
                    <span className="count">{activeAlerts.length}</span>
                  </div>
                  {!activeAlerts.length ? (
                    <div className="quiet">
                      <ShieldCheck size={30} />
                      <h3>No open alerts</h3>
                      <p>Monitoring events will appear here.</p>
                    </div>
                  ) : (
                    activeAlerts.slice(0, 5).map((a) => (
                      <div className="alert-strip" key={a.id}>
                        <span className="alert-mark" />
                        <div>
                          <strong>{a.code.replaceAll("-", " ")}</strong>
                          <p>{a.message}</p>
                          <small>{when(a.last)}</small>
                        </div>
                      </div>
                    ))
                  )}
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Current period usage</h2>
                  <span className="muted">Independent reset schedules</span>
                </div>
                {!state.users.length ? (
                  <Empty
                    title="No subscription users yet"
                    action={
                      <button onClick={() => save("users")}>
                        <Plus size={15} />
                        Create user
                      </button>
                    }
                  >
                    Create an individual subscription for yourself or a friend.
                  </Empty>
                ) : (
                  <div className="usage-grid">
                    {state.users.slice(0, 6).map((u) => (
                      <div key={u.id} className="usage-tile">
                        <div>
                          <strong>{u.name}</strong>
                          <Badge tone={u.exhausted ? "warning" : "good"}>
                            {u.exhausted
                              ? "Exhausted"
                              : u.enabled
                                ? "Enabled"
                                : "Disabled"}
                          </Badge>
                        </div>
                        <QuotaBar row={u} />
                        <small>Resets {when(u.usage.next)}</small>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {["VPS", "Nodes", "Users", "Templates"].includes(tab) && (
            <div className="toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  placeholder={`Search ${tab.toLowerCase()}…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {tab !== "Templates" && (
                <button
                  onClick={() =>
                    void api(
                      "archive/" +
                        (
                          {
                            VPS: "hosts",
                            Nodes: "nodes",
                            Users: "users",
                          } as Record<string, string>
                        )[tab],
                    )
                      .then((rows) =>
                        setModal(
                          <Dialog
                            title="Archived records"
                            onClose={() => setModal(null)}
                            wide
                          >
                            <div className="dialog-body">
                              {rows.length ? (
                                <Table
                                  headings={["Name", "Created", "History"]}
                                >
                                  {rows.map((r: Row) => (
                                    <tr key={r.id}>
                                      <td>{r.name}</td>
                                      <td>{when(r.created)}</td>
                                      <td>
                                        <button onClick={() => history(r)}>
                                          View history
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </Table>
                              ) : (
                                <Empty title="No archived records">
                                  Deleted records retain their historical usage
                                  here.
                                </Empty>
                              )}
                            </div>
                          </Dialog>,
                        ),
                      )
                      .catch((e) => setError(e.message))
                  }
                >
                  Archive
                </button>
              )}
              <span className="muted">
                {
                  (
                    {
                      VPS: state.hosts,
                      Nodes: state.nodes,
                      Users: state.users,
                      Templates: state.templates,
                    } as Record<string, Row[]>
                  )[tab].length
                }{" "}
                records
              </span>
            </div>
          )}
          {tab === "VPS" && (
            <section className="panel table-panel">
              {!state.hosts.length ? (
                <Empty title="No hosts connected">
                  Add a VPS to start managing your network.
                </Empty>
              ) : (
                <Table
                  headings={[
                    "Host",
                    "SSH identity",
                    "Health",
                    "Current usage",
                    "Next reset",
                    "Actions",
                  ]}
                >
                  {visible(state.hosts).map((h) => (
                    <tr key={h.id}>
                      <td>
                        <button
                          className="name-button"
                          onClick={() => history(h)}
                        >
                          {h.name}
                        </button>
                        <small className="mono">
                          {h.address}:{h.port}
                        </small>
                        {h.deleting && (
                          <Badge tone="warning">Pending deletion</Badge>
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => void trust(h)}
                        >
                          {h.fingerprint ? (
                            <>
                              <ShieldCheck size={14} />
                              Trusted
                            </>
                          ) : (
                            "Verify fingerprint"
                          )}
                        </button>
                      </td>
                      <td>
                        <Badge
                          tone={
                            !h.enabled
                              ? "neutral"
                              : h.reachable
                                ? "good"
                                : "warning"
                          }
                        >
                          {!h.enabled
                            ? "Disabled"
                            : h.reachable
                              ? "Reachable"
                              : "Unreachable"}
                        </Badge>
                        <small>
                          CPU {h.cpu?.toFixed(0) ?? "—"}% · RAM{" "}
                          {h.memory?.toFixed(0) ?? "—"}%
                        </small>
                      </td>
                      <td>
                        <QuotaBar row={h} />
                      </td>
                      <td className="nowrap">{when(h.usage.next)}</td>
                      <td>
                        <Actions
                          items={[
                            ["Edit", () => save("hosts", h)],
                            ["History", () => history(h)],
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
                            ["Delete", () => remove("hosts", h)],
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
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </section>
          )}
          {tab === "Nodes" && (
            <section className="panel table-panel">
              {!state.nodes.length ? (
                <Empty title="Plan your first node">
                  Add a trusted VPS first, then plan and deploy its Hysteria 2
                  node.
                </Empty>
              ) : (
                <Table
                  headings={[
                    "Node",
                    "VPS",
                    "Service / probe",
                    "Online clients",
                    "Version",
                    "Actions",
                  ]}
                >
                  {visible(state.nodes).map((n) => (
                    <tr key={n.id}>
                      <td>
                        <button
                          className="name-button"
                          onClick={() => history(n)}
                        >
                          {n.name}
                        </button>
                        <small className="mono">
                          {n.address}:{n.port}
                        </small>
                      </td>
                      <td>
                        {state.hosts.find((h) => h.id === n.hostId)?.name ||
                          "Removed"}
                      </td>
                      <td>
                        <Badge
                          tone={
                            nodeLabel(n) === "Running"
                              ? "good"
                              : nodeLabel(n) === "Planned"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {nodeLabel(n)}
                        </Badge>
                        <small>
                          {[
                            "Disabled",
                            "Quota exhausted",
                            "Pending deletion",
                          ].includes(nodeLabel(n))
                            ? "Probing paused"
                            : n.probed && Date.now() - n.probed > 600000
                              ? "Probe stale"
                              : n.probe || "Not probed"}
                          {n.drift ? " · Configuration drift" : ""}
                        </small>
                      </td>
                      <td>
                        {
                          Object.values(n.online || {}).reduce(
                            (a: any, b: any) => a + b,
                            0,
                          ) as number
                        }
                      </td>
                      <td className="mono">{n.version || "—"}</td>
                      <td>
                        <Actions
                          items={[
                            ["Edit", () => save("nodes", n)],
                            ["Deploy", () => operation(n, "deploy")],
                            [
                              "Show deploy command",
                              () => operation(n, "command"),
                            ],
                            [
                              "Detect installation",
                              () => operation(n, "detect"),
                            ],
                            ["Upgrade", () => operation(n, "upgrade")],
                            [
                              "Inspect configuration drift",
                              () =>
                                void api(`nodes/${n.id}/drift`)
                                  .then((diff) =>
                                    setModal(
                                      <Code
                                        title="Configuration comparison · credentials hidden"
                                        text={`PLATFORM CONFIGURATION\n${diff.desired}\nOBSERVED REMOTE CONFIGURATION\n${diff.observed || "No observation yet."}`}
                                        onClose={() => setModal(null)}
                                      />,
                                    ),
                                  )
                                  .catch((e) => setError(e.message)),
                            ],
                            [
                              "Reapply configuration",
                              () => operation(n, "reapply"),
                            ],
                            ["History", () => history(n)],
                            ["Delete", () => remove("nodes", n)],
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </section>
          )}
          {tab === "Users" && (
            <section className="panel table-panel">
              {!state.users.length ? (
                <Empty title="Access starts here">
                  Each user gets an independent link, token and traffic
                  allowance.
                </Empty>
              ) : (
                <Table
                  headings={[
                    "User",
                    "Access",
                    "Current usage",
                    "Nodes / clients",
                    "Next reset",
                    "Actions",
                  ]}
                >
                  {visible(state.users).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <button
                          className="name-button"
                          onClick={() => history(u)}
                        >
                          {u.name}
                        </button>
                        <small>{u.note || "No note"}</small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            !u.enabled ||
                            u.exhausted ||
                            (u.expires && Date.parse(u.expires) < Date.now())
                              ? "warning"
                              : "good"
                          }
                        >
                          {!u.enabled
                            ? "Disabled"
                            : u.expires && Date.parse(u.expires) < Date.now()
                              ? "Expired"
                              : u.exhausted
                                ? "Exhausted"
                                : "Enabled"}
                        </Badge>
                      </td>
                      <td>
                        <QuotaBar row={u} />
                      </td>
                      <td>
                        {u.nodeIds.length} nodes
                        <small>
                          {state.nodes.reduce(
                            (sum, n) => sum + (n.online?.[u.id] || 0),
                            0,
                          )}{" "}
                          online client instances
                        </small>
                      </td>
                      <td>{when(u.usage.next)}</td>
                      <td>
                        <Actions
                          items={[
                            ["Edit", () => save("users", u)],
                            ["Subscription links", () => void links(u)],
                            ["History", () => history(u)],
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
                                            api(
                                              `users/${u.id}/rotate`,
                                              "POST",
                                              { target },
                                            ),
                                          );
                                          setModal(null);
                                        }}
                                      >
                                        <p>
                                          Old{" "}
                                          {target === "subscription"
                                            ? "subscription links"
                                            : "VPN credentials and active connections"}{" "}
                                          will be revoked. Share updated
                                          subscription information with this
                                          user.
                                        </p>
                                      </Confirm>,
                                    ),
                                ] as [string, () => void],
                            ),
                            ["Delete", () => remove("users", u)],
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </section>
          )}
          {tab === "Templates" && (
            <div className="templates-grid">
              {visible(state.templates).map((t) => (
                <button
                  className="template-card"
                  key={t.id}
                  onClick={() =>
                    setModal(
                      <TemplateEditor
                        template={t}
                        state={state}
                        onClose={() => setModal(null)}
                        refresh={refresh}
                      />,
                    )
                  }
                >
                  <div>
                    <span className="file-icon">
                      <FileCode2 size={23} />
                    </span>
                    <Badge tone={t.published ? "good" : "neutral"}>
                      {t.published ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <h2>{t.name}</h2>
                  <p>mihomo · complete configuration</p>
                  <pre>
                    {(t.draft || t.body).split("\n").slice(0, 8).join("\n")}
                  </pre>
                  <span className="text-button">
                    Open template <ArrowUpRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          )}
          {tab === "Operations" && (
            <section className="panel table-panel">
              {!state.tasks.length ? (
                <Empty title="No operations yet">
                  Deployments, upgrades and connection revocations appear here.
                </Empty>
              ) : (
                <Table
                  headings={[
                    "Operation",
                    "VPS",
                    "Status",
                    "Updated",
                    "Actions",
                  ]}
                >
                  {state.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.kind}</strong>
                        <small className="mono">
                          {t.id.slice(0, 8)} · step {t.step}
                        </small>
                      </td>
                      <td>
                        {state.hosts.find((h) => h.id === t.host)?.name ||
                          "Removed host"}
                      </td>
                      <td>
                        <Badge
                          tone={
                            t.state === "succeeded"
                              ? "good"
                              : t.state === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {t.state}
                        </Badge>
                        {t.error && <small>{t.error}</small>}
                      </td>
                      <td>{when(t.updated)}</td>
                      <td>
                        <Actions
                          items={[
                            [
                              "Execution log",
                              () =>
                                void api(`tasks/${t.id}/logs`).then((logs) =>
                                  setModal(
                                    <Code
                                      title="Execution log"
                                      text={
                                        logs
                                          .map(
                                            (l: Row) =>
                                              `${when(l.at)}  ${l.message}`,
                                          )
                                          .join("\n") ||
                                        "No detailed log recorded."
                                      }
                                      onClose={() => setModal(null)}
                                    />,
                                  ),
                                ),
                            ],
                            ...(["queued", "running"].includes(t.state)
                              ? [
                                  [
                                    "Cancel",
                                    () => act(`tasks/${t.id}/cancel`),
                                  ] as [string, () => void],
                                ]
                              : []),
                            ...(["failed", "cancelled"].includes(t.state)
                              ? [
                                  [
                                    "Retry",
                                    () => act(`tasks/${t.id}/retry`),
                                  ] as [string, () => void],
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </section>
          )}
          {tab === "Alerts" && (
            <section className="panel">
              {!state.alerts.length ? (
                <Empty title="No alerts recorded">
                  Faults and recoveries will be kept here.
                </Empty>
              ) : (
                state.alerts.map((a) => (
                  <div
                    className={"alert-row " + (a.closed ? "resolved" : "")}
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
                        First {when(a.first)} · Last {when(a.last)}
                        {a.closed && ` · Closed ${when(a.closed)}`}
                      </small>
                    </div>
                    <div className="row-buttons">
                      {!a.seen && (
                        <button
                          onClick={() =>
                            act(
                              `alerts/${a.id}/read`,
                              undefined,
                              "POST",
                              "Marked read",
                            )
                          }
                        >
                          Mark read
                        </button>
                      )}
                      {!a.closed && (
                        <button
                          onClick={() =>
                            act(
                              `alerts/${a.id}/close`,
                              undefined,
                              "POST",
                              "Closed",
                            )
                          }
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          )}
          <footer>
            <span>JETYET / NETWORK CONTROL</span>
            <span>Hysteria 2 · mihomo</span>
          </footer>
        </div>
      </main>
      {modal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          {modal}
        </div>
      )}
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
