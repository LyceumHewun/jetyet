import "@fontsource-variable/space-grotesk";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode2,
  History as HistoryIcon,
  KeyRound,
  ListChecks,
  LogOut,
  Network,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  ToastRegion,
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
import type { Row, State, Tab } from "./types";

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
  ["Overview", "Overview", Activity],
  ["VPS", "VPS", Server],
  ["Nodes", "Nodes", Radio],
  ["Users", "Users", Users],
  ["Templates", "Templates", FileCode2],
  ["Operations", "Ops", ListChecks],
  ["Alerts", "Alerts", Bell],
] as const;

const tabMeta: Record<
  Tab,
  { title: string; subtitle: string; addLabel?: string; kind?: string }
> = {
  Overview: {
    title: "Your network, at a glance.",
    subtitle: "VPS hosts, Hysteria 2 nodes, and user allowances in one view.",
  },
  VPS: {
    title: "VPS",
    subtitle: "SSH trust, host health, and provider traffic caps.",
    addLabel: "Add VPS",
    kind: "hosts",
  },
  Nodes: {
    title: "Nodes",
    subtitle: "Native Hysteria 2 endpoints. One node per host.",
    addLabel: "Add node",
    kind: "nodes",
  },
  Users: {
    title: "Users",
    subtitle: "Individual mihomo links, allowed nodes, and shared quotas.",
    addLabel: "Add user",
    kind: "users",
  },
  Templates: {
    title: "Templates",
    subtitle: "Complete mihomo configurations validated before publish.",
    addLabel: "Add template",
  },
  Operations: {
    title: "Operations",
    subtitle: "Queued and historical remote tasks per VPS.",
  },
  Alerts: {
    title: "Alerts",
    subtitle: "Probe faults, worker gaps, and accounting notices.",
  },
};

let nextModalKey = 1;

function formatAlertCode(code: string) {
  const text = code
    .replaceAll("-", " ")
    .replace(/\bssh\b/gi, "SSH")
    .replace(/\bvps\b/gi, "VPS")
    .replace(/\bvpn\b/gi, "VPN");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function App() {
  const [session, setSession] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<State>(initial);
  const [tab, setTab] = useState<Tab>("Overview");
  const [modal, setModal] = useState<ReactNode>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const showModal = useCallback((node: ReactNode) => {
    const key = `modal-${nextModalKey++}`;
    setModal(isValidElement(node) ? cloneElement(node, { key }) : node);
  }, []);

  const closeModal = useCallback(() => setModal(null), []);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setState(await api("state"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    document.title = checking
      ? "Loading — Jetyet"
      : !session
        ? "Sign in — Jetyet"
        : `${tab} — Jetyet`;
  }, [checking, session, tab]);

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
    const id = setInterval(() => void refresh(), 10000);
    return () => clearInterval(id);
  }, [session, refresh]);

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
    showModal(
      <EntityForm
        kind={kind}
        row={row}
        state={state}
        onClose={closeModal}
        onSave={async (data) => {
          await run(() =>
            api(kind + (row ? "/" + row.id : ""), row ? "PUT" : "POST", data),
          );
          closeModal();
        }}
      />,
    );

  const openHistory = (r: Row) =>
    showModal(<History entity={r} onClose={closeModal} />);

  const operation = (n: Row, kind: string) => {
    if (kind === "detect") {
      act(`nodes/${n.id}/operation`, { kind });
      return;
    }
    showModal(
      <OperationForm
        node={n}
        kind={kind}
        onClose={closeModal}
        onSubmit={async (version) => {
          if (kind === "command") {
            const result = await api(`nodes/${n.id}/command`, "POST", {
              version,
            });
            showModal(
              <Code
                title="Run on this VPS as root"
                notice="Contains node API secrets. Execute only on the target host."
                text={result.script}
                onClose={closeModal}
              />,
            );
          } else {
            await run(() =>
              api(`nodes/${n.id}/operation`, "POST", { kind, version }),
            );
            closeModal();
          }
        }}
      />,
    );
  };

  const links = async (u: Row) => {
    try {
      const data = await api(`users/${u.id}/links`);
      showModal(
        <Code
          title={`${u.name} · Subscription links`}
          notice="Personal subscription URLs grant access to authorized nodes."
          text={[
            `Default\n${data.default}`,
            ...data.templates.map(
              (t: Row) =>
                `${state.templates.find((x) => x.id === t.id)?.name || t.id}\n${t.url}`,
            ),
          ].join("\n\n")}
          onClose={closeModal}
        />,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const trust = async (h: Row) => {
    try {
      const result = await api(`hosts/${h.id}/fingerprint`, "POST");
      showModal(
        <Confirm
          title="Verify SSH host identity"
          onClose={closeModal}
          action="Trust fingerprint"
          onConfirm={async () => {
            await run(
              () => api(`hosts/${h.id}/trust`, "POST", result),
              "SSH fingerprint trusted",
            );
            closeModal();
          }}
        >
          <p className="body-copy">
            Match this SHA-256 fingerprint against your provider console or a
            known SSH session before trusting.
          </p>
          <pre className="code-output">{result.fingerprint}</pre>
          <p className="muted-copy mono">
            {h.username}@{h.address}:{h.port}
          </p>
        </Confirm>,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = (kind: string, r: Row) =>
    showModal(
      <Confirm
        title={`Delete ${r.name}?`}
        action="Delete"
        danger
        onClose={closeModal}
        onConfirm={async () => {
          await run(() => api(`${kind}/${r.id}`, "DELETE"), "Deletion queued");
          closeModal();
        }}
      >
        <p className="body-copy">
          {kind === "users"
            ? "Subscription access stops immediately and active sessions are queued to disconnect."
            : "Nodes are removed from subscriptions immediately. Remote cleanup must succeed before deletion completes; the cloud VPS itself is never destroyed."}{" "}
          Historical usage records remain available in the archive.
        </p>
      </Confirm>,
    );

  const reset = (r: Row) =>
    showModal(
      <Confirm
        title={`Reset ${r.name}'s traffic?`}
        action="Reset usage"
        onClose={closeModal}
        onConfirm={async () => {
          await run(() => api(`usage/${r.id}/reset`, "POST"), "Usage reset");
          closeModal();
        }}
      >
        <p className="body-copy">
          Zeros current-period counters and removes quota suspension. History
          and scheduled reset dates remain unchanged.
        </p>
      </Confirm>,
    );

  const openArchive = (entityTab: Tab) => {
    const endpoint =
      entityTab === "VPS" ? "hosts" : entityTab === "Nodes" ? "nodes" : "users";
    void api("archive/" + endpoint)
      .then((rows) =>
        showModal(
          <Dialog
            title={`${entityTab} archive`}
            subtitle="Deleted records keep historical traffic and event trails."
            onClose={closeModal}
            wide
          >
            <div className="dialog-body">
              {rows.length ? (
                <Table
                  caption={`Archived ${entityTab}`}
                  headings={["Name", "Created", "History"]}
                >
                  {rows.map((r: Row) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td className="nowrap mono">{when(r.created)}</td>
                      <td>
                        <button
                          type="button"
                          className="compact-button"
                          onClick={() => openHistory(r)}
                        >
                          <HistoryIcon size={16} aria-hidden="true" />
                          <span>View history</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty
                  title="No archived records"
                  icon={<Archive size={26} />}
                >
                  Deleted {entityTab.toLowerCase()} appear here with retained
                  history.
                </Empty>
              )}
            </div>
          </Dialog>,
        ),
      )
      .catch((e) => setError(e.message));
  };

  if (checking) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <span className="brand-mark large" aria-hidden="true">
            <Network size={26} />
          </span>
          <span className="brand-text">
            jetyet<span className="brand-dot">.</span>
          </span>
          <progress aria-label="Loading Jetyet" className="flat-progress" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  const visible = (list: Row[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.name, r.address, r.note, r.kind, r.message, r.code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  };

  const activeAlerts = state.alerts.filter((a) => !a.closed);
  const trustedHosts = state.hosts.filter((h) => h.fingerprint).length;
  const enabledUsers = state.users.filter((u) => u.enabled).length;
  const nodeHealthy = state.nodes.filter(
    (n) =>
      n.enabled &&
      !n.deleting &&
      state.hosts.find((h) => h.id === n.hostId)?.enabled &&
      n.probe === "healthy" &&
      Date.now() - (n.probed || 0) < 600000 &&
      !state.hosts.find((h) => h.id === n.hostId)?.exhausted,
  ).length;

  const nodeLabel = (n: Row) => {
    const h = state.hosts.find((x) => x.id === n.hostId);
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

  const workerOnline = (name: string) => {
    const w = state.workers.find((x) => x.name === name);
    return !!(w && Date.now() - w.at < 30000);
  };

  const workersLive =
    Number(workerOnline("monitor")) + Number(workerOnline("operations"));

  const pipelineDone =
    (trustedHosts > 0 ? 1 : 0) +
    (nodeHealthy > 0 ? 1 : state.nodes.length > 0 ? 0.5 : 0) +
    (enabledUsers > 0 ? 1 : 0);
  const pipelineProgress = Math.min(1, pipelineDone / 3);

  const selectTab = (next: Tab) => {
    setTab(next);
    setSearch("");
  };

  const openCreateForTab = (target: Tab) => {
    if (target === "Templates") {
      showModal(
        <TemplateEditor
          state={state}
          onClose={closeModal}
          refresh={() => refresh()}
        />,
      );
      return;
    }
    const kind = tabMeta[target].kind;
    if (kind) save(kind);
  };

  const currentTabLists: Partial<Record<Tab, Row[]>> = {
    VPS: state.hosts,
    Nodes: state.nodes,
    Users: state.users,
    Templates: state.templates,
  };
  const currentList = currentTabLists[tab] || [];
  const filteredList = visible(currentList);
  const meta = tabMeta[tab];

  return (
    <div className="shell">
      <a href="#main-heading" className="skip-link visually-hidden">
        Skip to content
      </a>

      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          onClick={() => selectTab("Overview")}
        >
          <span className="brand-mark" aria-hidden="true">
            <Network size={22} />
          </span>
          <span className="brand-text">
            jetyet<span className="brand-dot">.</span>
          </span>
        </button>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="Primary" className="sidebar-nav">
          {tabs.map(([name, , Icon]) => (
            <button
              type="button"
              key={name}
              aria-label={
                name === "Alerts" && activeAlerts.length > 0
                  ? `${name} (${activeAlerts.length} open)`
                  : name
              }
              aria-current={tab === name ? "page" : undefined}
              className={tab === name ? "nav-item active" : "nav-item"}
              onClick={() => selectTab(name)}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="nav-label">{name}</span>
              {name === "Alerts" && activeAlerts.length > 0 && (
                <span className="nav-count">{activeAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-section-label">WORKERS</div>
          <div className="worker-list">
            {(["monitor", "operations"] as const).map((name) => {
              const online = workerOnline(name);
              return (
                <div className="worker-row" key={name}>
                  <span
                    className={`worker-status-icon ${online ? "online" : "offline"}`}
                    aria-hidden="true"
                  >
                    {online ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                  </span>
                  <span className="worker-name">
                    {name === "monitor" ? "Monitoring" : "Operations"}
                  </span>
                  <span className={`worker-state ${online ? "online" : "offline"}`}>
                    {online ? "Live" : "Offline"}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="account-button"
            aria-label={`Sign out (${session})`}
            onClick={() =>
              void api("logout", "POST").then(() => setSession(null))
            }
          >
            <span className="avatar" aria-hidden="true">
              {session[0]?.toUpperCase()}
            </span>
            <span className="account-meta">
              <strong>{session}</strong>
              <small>Administrator</small>
            </span>
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-brand"
              onClick={() => selectTab("Overview")}
            >
              <span className="brand-mark small" aria-hidden="true">
                <Network size={18} />
              </span>
              <span className="brand-text">
                jetyet<span className="brand-dot">.</span>
              </span>
            </button>

            <div className="breadcrumb" aria-label="Location">
              <span>Workspace</span>
              <ChevronRight size={15} aria-hidden="true" />
              <strong>{tab}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <span
              className={`worker-pill ${workersLive === 2 ? "online" : "offline"}`}
            >
              {workersLive === 2 ? (
                <CheckCircle2 size={15} aria-hidden="true" />
              ) : (
                <AlertTriangle size={15} aria-hidden="true" />
              )}
              <span>{workersLive}/2 workers</span>
            </span>

            <span className="timezone-pill">HKT · UTC+8</span>

            <button
              type="button"
              aria-label="Refresh"
              className="icon-button"
              disabled={loading || refreshing}
              onClick={() => void refresh(true)}
            >
              <RefreshCw
                size={19}
                className={refreshing ? "spin-active" : ""}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              className="icon-button alert-bell"
              aria-label={
                activeAlerts.length > 0
                  ? `Alerts (${activeAlerts.length} open)`
                  : "Alerts"
              }
              onClick={() => selectTab("Alerts")}
            >
              <Bell size={19} aria-hidden="true" />
              {activeAlerts.length > 0 && (
                <span className="bell-count">{activeAlerts.length}</span>
              )}
            </button>

            <button
              type="button"
              className="icon-button mobile-signout"
              aria-label={`Sign out (${session})`}
              onClick={() =>
                void api("logout", "POST").then(() => setSession(null))
              }
            >
              <LogOut size={19} aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav aria-label="Primary" className="mobile-nav">
          {tabs.map(([name, shortLabel, Icon]) => (
            <button
              type="button"
              key={name}
              aria-current={tab === name ? "page" : undefined}
              className={tab === name ? "mobile-tab active" : "mobile-tab"}
              onClick={() => selectTab(name)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{shortLabel}</span>
              {name === "Alerts" && activeAlerts.length > 0 && (
                <span className="mobile-tab-badge">{activeAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="content">
          <div className="page-heading">
            <div className="page-heading-copy">
              <p className="eyebrow">NETWORK CONTROL</p>
              <h1 id="main-heading" tabIndex={-1}>
                {meta.title}
              </h1>
              <p className="page-subtitle">{meta.subtitle}</p>
            </div>
            {meta.addLabel && (
              <button
                type="button"
                className="primary page-cta"
                onClick={() => openCreateForTab(tab)}
              >
                <Plus size={19} aria-hidden="true" />
                <span>{meta.addLabel}</span>
              </button>
            )}
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={19} aria-hidden="true" />
              <span className="error-banner-text">{error}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          )}

          <div key={tab} className="view-stage">
            {tab === "Overview" && (
              <>
                <section
                  className="pipeline-panel"
                  aria-label="Product workflow"
                >
                  <div className="pipeline-head">
                    <div>
                      <span className="eyebrow">HOW IT FLOWS</span>
                      <h2>VPS → Hysteria 2 → mihomo</h2>
                    </div>
                    <div
                      className="pipeline-progress"
                      role="progressbar"
                      aria-label="Setup completion"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(pipelineProgress * 100)}
                    >
                      <span
                        className="pipeline-progress-fill"
                        style={
                          {
                            "--progress": String(pipelineProgress),
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                  <div className="pipeline-steps">
                    <button
                      type="button"
                      className={`pipeline-step ${trustedHosts > 0 ? "done" : "next"}`}
                      style={{ "--i": 0 } as CSSProperties}
                      onClick={() =>
                        state.hosts.length ? selectTab("VPS") : save("hosts")
                      }
                    >
                      <span className="step-num">
                        {trustedHosts > 0 ? (
                          <Check size={16} aria-hidden="true" />
                        ) : (
                          "1"
                        )}
                      </span>
                      <span className="step-copy">
                        <strong>Connect VPS</strong>
                        <small>
                          {trustedHosts}/{state.hosts.length} SSH trusted
                        </small>
                      </span>
                      <ArrowUpRight
                        size={17}
                        className="step-arrow"
                        aria-hidden="true"
                      />
                    </button>

                    <button
                      type="button"
                      className={`pipeline-step ${nodeHealthy > 0 ? "done" : trustedHosts > 0 ? "next" : ""}`}
                      style={{ "--i": 1 } as CSSProperties}
                      onClick={() =>
                        state.nodes.length || trustedHosts === 0
                          ? selectTab("Nodes")
                          : save("nodes")
                      }
                    >
                      <span className="step-num">
                        {nodeHealthy > 0 ? (
                          <Check size={16} aria-hidden="true" />
                        ) : (
                          "2"
                        )}
                      </span>
                      <span className="step-copy">
                        <strong>Deploy node</strong>
                        <small>
                          {nodeHealthy}/{state.nodes.length} probe healthy
                        </small>
                      </span>
                      <ArrowUpRight
                        size={17}
                        className="step-arrow"
                        aria-hidden="true"
                      />
                    </button>

                    <button
                      type="button"
                      className={`pipeline-step ${enabledUsers > 0 ? "done" : state.nodes.length > 0 ? "next" : ""}`}
                      style={{ "--i": 2 } as CSSProperties}
                      onClick={() =>
                        state.users.length ? selectTab("Users") : save("users")
                      }
                    >
                      <span className="step-num">
                        {enabledUsers > 0 ? (
                          <Check size={16} aria-hidden="true" />
                        ) : (
                          "3"
                        )}
                      </span>
                      <span className="step-copy">
                        <strong>Share subscriptions</strong>
                        <small>
                          {enabledUsers}/{state.users.length} users active
                        </small>
                      </span>
                      <ArrowUpRight
                        size={17}
                        className="step-arrow"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </section>

                <div className="stats">
                  <Stat
                    index={0}
                    label="VPS HOSTS"
                    value={state.hosts.length}
                    detail={`${state.hosts.filter((h) => h.reachable).length} reachable`}
                    icon={<Server size={20} />}
                    tone="accent"
                    onClick={() => selectTab("VPS")}
                  />
                  <Stat
                    index={1}
                    label="HEALTHY NODES"
                    value={`${nodeHealthy} / ${state.nodes.length}`}
                    detail="Authenticated proxy probes"
                    icon={<Radio size={20} />}
                    tone="good"
                    onClick={() => selectTab("Nodes")}
                  />
                  <Stat
                    index={2}
                    label="SUBSCRIPTION USERS"
                    value={state.users.length}
                    detail={`${enabledUsers} enabled`}
                    icon={<Users size={20} />}
                    tone="accent"
                    onClick={() => selectTab("Users")}
                  />
                  <Stat
                    index={3}
                    label="OPEN ALERTS"
                    value={activeAlerts.length}
                    detail={
                      activeAlerts.length
                        ? "Needs review"
                        : "In-platform records"
                    }
                    icon={<Bell size={20} />}
                    tone={activeAlerts.length ? "warning" : "neutral"}
                    onClick={() => selectTab("Alerts")}
                  />
                </div>

                <div className="overview-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Infrastructure</h2>
                      <button
                        type="button"
                        className="compact-button"
                        onClick={() => selectTab("VPS")}
                      >
                        <span>All hosts</span>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                    {!state.hosts.length ? (
                      <Empty
                        title="Connect your first VPS"
                        icon={<Server size={28} />}
                        action={
                          <button
                            type="button"
                            className="primary"
                            onClick={() => save("hosts")}
                          >
                            <Plus size={18} aria-hidden="true" />
                            <span>Add VPS</span>
                          </button>
                        }
                      >
                        Add SSH access, verify its fingerprint, then deploy a
                        Hysteria 2 node.
                      </Empty>
                    ) : (
                      <div className="strip-list">
                        {state.hosts.slice(0, 6).map((h, idx) => (
                          <button
                            type="button"
                            key={h.id}
                            className="host-strip"
                            style={{ "--i": idx } as CSSProperties}
                            onClick={() => openHistory(h)}
                          >
                            <span className="host-icon" aria-hidden="true">
                              <Server size={18} />
                            </span>
                            <span className="host-strip-meta">
                              <strong>{h.name}</strong>
                              <small className="mono">{h.address}</small>
                            </span>
                            <span className="host-telemetry mono">
                              CPU {h.cpu?.toFixed(0) ?? "—"}% · RAM{" "}
                              {h.memory?.toFixed(0) ?? "—"}%
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
                            <ChevronRight
                              size={18}
                              className="strip-chevron"
                              aria-hidden="true"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Needs attention</h2>
                      <div className="panel-heading-meta">
                        <Badge
                          tone={activeAlerts.length ? "warning" : "good"}
                          icon={
                            activeAlerts.length ? (
                              <AlertTriangle size={14} />
                            ) : (
                              <ShieldCheck size={14} />
                            )
                          }
                        >
                          {activeAlerts.length} open
                        </Badge>
                        {activeAlerts.length > 0 && (
                          <button
                            type="button"
                            className="compact-button"
                            onClick={() => selectTab("Alerts")}
                          >
                            <span>Review</span>
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    {!activeAlerts.length ? (
                      <div className="quiet">
                        <div className="quiet-icon" aria-hidden="true">
                          <ShieldCheck size={30} />
                        </div>
                        <h3>All clear</h3>
                        <p>
                          Reachability faults and accounting gaps appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="strip-list">
                        {activeAlerts.slice(0, 5).map((a, idx) => (
                          <div
                            className="alert-strip"
                            key={a.id}
                            style={{ "--i": idx } as CSSProperties}
                          >
                            <span className="alert-icon" aria-hidden="true">
                              <AlertTriangle size={18} />
                            </span>
                            <div className="alert-strip-copy">
                              <strong>{formatAlertCode(a.code)}</strong>
                              <p>{a.message}</p>
                              <small className="mono">{when(a.last)}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="panel">
                  <div className="panel-heading">
                    <h2>Current period usage</h2>
                    <span className="muted-copy">
                      Independent reset schedules
                    </span>
                  </div>
                  {!state.users.length ? (
                    <Empty
                      title="No subscription users yet"
                      icon={<Users size={28} />}
                      action={
                        <button
                          type="button"
                          className="primary"
                          onClick={() => save("users")}
                        >
                          <Plus size={18} aria-hidden="true" />
                          <span>Create user</span>
                        </button>
                      }
                    >
                      Issue individual mihomo links and traffic allowances.
                    </Empty>
                  ) : (
                    <div className="usage-grid">
                      {state.users.slice(0, 6).map((u, idx) => (
                        <button
                          type="button"
                          key={u.id}
                          className="usage-tile"
                          style={{ "--i": idx } as CSSProperties}
                          onClick={() => openHistory(u)}
                        >
                          <div className="usage-tile-head">
                            <strong>{u.name}</strong>
                            <Badge
                              tone={
                                !u.enabled ||
                                u.exhausted ||
                                (u.expires &&
                                  Date.parse(u.expires) < Date.now())
                                  ? "warning"
                                  : "good"
                              }
                            >
                              {!u.enabled
                                ? "Disabled"
                                : u.expires &&
                                    Date.parse(u.expires) < Date.now()
                                  ? "Expired"
                                  : u.exhausted
                                    ? "Exhausted"
                                    : "Enabled"}
                            </Badge>
                          </div>
                          <QuotaBar row={u} />
                          <small className="usage-reset">
                            Resets {when(u.usage.next)}
                          </small>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {["VPS", "Nodes", "Users", "Templates"].includes(tab) && (
              <search className="toolbar">
                <div className="search-box">
                  <Search size={18} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={`Search ${tab}`}
                    placeholder={`Search ${tab.toLowerCase()}…`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className="icon-button search-clear"
                      aria-label="Clear search query"
                      onClick={() => setSearch("")}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="toolbar-right">
                  {tab !== "Templates" && (
                    <button
                      type="button"
                      className="compact-button"
                      onClick={() => openArchive(tab)}
                    >
                      <Archive size={16} aria-hidden="true" />
                      <span>Archive</span>
                    </button>
                  )}
                  <span className="record-count">
                    {search.trim()
                      ? `${filteredList.length} of ${currentList.length}`
                      : `${currentList.length} ${
                          currentList.length === 1 ? "record" : "records"
                        }`}
                  </span>
                </div>
              </search>
            )}

            {tab === "VPS" && (
              <section className="panel table-panel">
                {!state.hosts.length ? (
                  <Empty
                    title="No hosts connected"
                    icon={<Server size={28} />}
                    action={
                      <button
                        type="button"
                        className="primary"
                        onClick={() => save("hosts")}
                      >
                        <Plus size={18} aria-hidden="true" />
                        <span>Add VPS</span>
                      </button>
                    }
                  >
                    Add a VPS with SSH access to start managing nodes.
                  </Empty>
                ) : !filteredList.length ? (
                  <Empty
                    title="No matching VPS hosts"
                    icon={<Search size={26} />}
                    action={
                      <button type="button" onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    }
                  >
                    Try a different name or IP address.
                  </Empty>
                ) : (
                  <Table
                    caption="VPS hosts"
                    headings={[
                      "Host",
                      "SSH identity",
                      "Health",
                      "Current usage",
                      "Next reset",
                      "Actions",
                    ]}
                  >
                    {filteredList.map((h) => (
                      <tr key={h.id}>
                        <th scope="row">
                          <div className="cell-stack">
                            <button
                              type="button"
                              className="name-button"
                              onClick={() => openHistory(h)}
                            >
                              {h.name}
                            </button>
                            <small className="mono">
                              {h.address}:{h.port}
                            </small>
                            {h.deleting && (
                              <Badge tone="warning">Pending deletion</Badge>
                            )}
                          </div>
                        </th>
                        <td>
                          <button
                            type="button"
                            className={`trust-pill ${h.fingerprint ? "trusted" : "untrusted"}`}
                            onClick={() => void trust(h)}
                          >
                            {h.fingerprint ? (
                              <>
                                <ShieldCheck size={16} aria-hidden="true" />
                                <span>Trusted</span>
                              </>
                            ) : (
                              <>
                                <ShieldAlert size={16} aria-hidden="true" />
                                <span>Verify SSH</span>
                              </>
                            )}
                          </button>
                        </td>
                        <td>
                          <div className="cell-stack">
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
                            <small className="mono">
                              CPU {h.cpu?.toFixed(0) ?? "—"}% · RAM{" "}
                              {h.memory?.toFixed(0) ?? "—"}%
                            </small>
                          </div>
                        </td>
                        <td>
                          <QuotaBar row={h} />
                        </td>
                        <td className="nowrap mono">{when(h.usage.next)}</td>
                        <td className="actions-cell">
                          <Actions
                            label={`Actions for ${h.name}`}
                            items={[
                              {
                                label: "Edit",
                                icon: <Pencil size={16} />,
                                onClick: () => save("hosts", h),
                              },
                              {
                                label: "History",
                                icon: <HistoryIcon size={16} />,
                                onClick: () => openHistory(h),
                              },
                              {
                                label: "Reset usage",
                                icon: <RotateCcw size={16} />,
                                onClick: () => reset(h),
                              },
                              {
                                label: "Correct usage",
                                icon: <Sliders size={16} />,
                                onClick: () =>
                                  showModal(
                                    <Correction
                                      host={h}
                                      onClose={closeModal}
                                      onSave={async (v) => {
                                        await run(
                                          () =>
                                            api(
                                              `hosts/${h.id}/correct`,
                                              "POST",
                                              v,
                                            ),
                                          "Usage corrected",
                                        );
                                        closeModal();
                                      }}
                                    />,
                                  ),
                              },
                              {
                                label: "Delete",
                                danger: true,
                                icon: <Trash2 size={16} />,
                                onClick: () => remove("hosts", h),
                              },
                              {
                                label: "Force remove",
                                danger: true,
                                icon: <AlertTriangle size={16} />,
                                onClick: () =>
                                  showModal(
                                    <ForceRemove
                                      host={h}
                                      onClose={closeModal}
                                      onSave={async () => {
                                        await run(
                                          () =>
                                            api(
                                              `hosts/${h.id}/force-remove`,
                                              "POST",
                                              {
                                                confirmation:
                                                  "REMOTE HOST DESTROYED OR HANDLED INDEPENDENTLY",
                                              },
                                            ),
                                          "Force removed",
                                        );
                                        closeModal();
                                      }}
                                    />,
                                  ),
                              },
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
                  <Empty
                    title="Plan your first node"
                    icon={<Radio size={28} />}
                    action={
                      <button
                        type="button"
                        className="primary"
                        onClick={() => save("nodes")}
                      >
                        <Plus size={18} aria-hidden="true" />
                        <span>Add node</span>
                      </button>
                    }
                  >
                    Add and trust a VPS first, then plan and deploy its Hysteria
                    2 node.
                  </Empty>
                ) : !filteredList.length ? (
                  <Empty
                    title="No matching nodes"
                    icon={<Search size={26} />}
                    action={
                      <button type="button" onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    }
                  >
                    Try another node name or IP address.
                  </Empty>
                ) : (
                  <Table
                    caption="Hysteria 2 nodes"
                    headings={[
                      "Node",
                      "VPS",
                      "Service / probe",
                      "Online clients",
                      "Version",
                      "Actions",
                    ]}
                  >
                    {filteredList.map((n) => {
                      const label = nodeLabel(n);
                      const probeText = [
                        "Disabled",
                        "Quota exhausted",
                        "Pending deletion",
                      ].includes(label)
                        ? "Probing paused"
                        : n.probed && Date.now() - n.probed > 600000
                          ? "Probe stale"
                          : n.probe || "Not probed";
                      const onlineCount = Object.values(n.online || {}).reduce(
                        (a: number, b: any) => a + Number(b || 0),
                        0,
                      );

                      return (
                        <tr key={n.id}>
                          <th scope="row">
                            <div className="cell-stack">
                              <button
                                type="button"
                                className="name-button"
                                onClick={() => openHistory(n)}
                              >
                                {n.name}
                              </button>
                              <small className="mono">
                                {n.address}:{n.port}
                                {n.hopping ? ` · hops ${n.hopping}` : ""}
                              </small>
                            </div>
                          </th>
                          <td>
                            {state.hosts.find((h) => h.id === n.hostId)?.name ||
                              "Removed"}
                          </td>
                          <td>
                            <div className="cell-stack">
                              <Badge
                                tone={
                                  label === "Running"
                                    ? "good"
                                    : label === "Planned"
                                      ? "neutral"
                                      : "warning"
                                }
                              >
                                {label}
                              </Badge>
                              <small>
                                {probeText}
                                {n.drift ? " · Configuration drift" : ""}
                              </small>
                            </div>
                          </td>
                          <td className="tabular-cell">
                            <strong>{onlineCount}</strong>{" "}
                            <small className="inline-unit">
                              {onlineCount === 1 ? "instance" : "instances"}
                            </small>
                          </td>
                          <td className="mono">{n.version || "—"}</td>
                          <td className="actions-cell">
                            <Actions
                              label={`Actions for ${n.name}`}
                              items={[
                                {
                                  label: "Edit",
                                  icon: <Pencil size={16} />,
                                  onClick: () => save("nodes", n),
                                },
                                {
                                  label: "Deploy",
                                  icon: <Play size={16} />,
                                  onClick: () => operation(n, "deploy"),
                                },
                                {
                                  label: "Show deploy command",
                                  icon: <Terminal size={16} />,
                                  onClick: () => operation(n, "command"),
                                },
                                {
                                  label: "Detect installation",
                                  icon: <Search size={16} />,
                                  onClick: () => operation(n, "detect"),
                                },
                                {
                                  label: "Upgrade",
                                  icon: <Download size={16} />,
                                  onClick: () => operation(n, "upgrade"),
                                },
                                {
                                  label: "Inspect configuration drift",
                                  icon: <Wrench size={16} />,
                                  onClick: () =>
                                    void api(`nodes/${n.id}/drift`)
                                      .then((diff) =>
                                        showModal(
                                          <Code
                                            title="Configuration comparison"
                                            notice="Credentials are hidden. Compare desired platform config with observed remote config."
                                            text={`PLATFORM CONFIGURATION\n${diff.desired}\nOBSERVED REMOTE CONFIGURATION\n${diff.observed || "No observation yet."}`}
                                            onClose={closeModal}
                                          />,
                                        ),
                                      )
                                      .catch((e) => setError(e.message)),
                                },
                                {
                                  label: "Reapply configuration",
                                  icon: <RefreshCw size={16} />,
                                  onClick: () => operation(n, "reapply"),
                                },
                                {
                                  label: "History",
                                  icon: <HistoryIcon size={16} />,
                                  onClick: () => openHistory(n),
                                },
                                {
                                  label: "Delete",
                                  danger: true,
                                  icon: <Trash2 size={16} />,
                                  onClick: () => remove("nodes", n),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </section>
            )}

            {tab === "Users" && (
              <section className="panel table-panel">
                {!state.users.length ? (
                  <Empty
                    title="Access starts here"
                    icon={<Users size={28} />}
                    action={
                      <button
                        type="button"
                        className="primary"
                        onClick={() => save("users")}
                      >
                        <Plus size={18} aria-hidden="true" />
                        <span>Add user</span>
                      </button>
                    }
                  >
                    Each user gets an independent link, VPN token, and traffic
                    allowance.
                  </Empty>
                ) : !filteredList.length ? (
                  <Empty
                    title="No matching users"
                    icon={<Search size={26} />}
                    action={
                      <button type="button" onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    }
                  >
                    Try a different display name or note.
                  </Empty>
                ) : (
                  <Table
                    caption="Subscription users"
                    headings={[
                      "User",
                      "Access",
                      "Current usage",
                      "Nodes / clients",
                      "Next reset",
                      "Actions",
                    ]}
                  >
                    {filteredList.map((u) => {
                      const expired =
                        u.expires && Date.parse(u.expires) < Date.now();
                      const onlineInstances = state.nodes.reduce(
                        (sum, n) => sum + (n.online?.[u.id] || 0),
                        0,
                      );

                      return (
                        <tr key={u.id}>
                          <th scope="row">
                            <div className="cell-stack">
                              <button
                                type="button"
                                className="name-button"
                                onClick={() => openHistory(u)}
                              >
                                {u.name}
                              </button>
                              <small>{u.note || "No note"}</small>
                              {u.expires && (
                                <small className="mono">
                                  Expires {when(u.expires)}
                                </small>
                              )}
                            </div>
                          </th>
                          <td>
                            <Badge
                              tone={
                                !u.enabled || u.exhausted || expired
                                  ? "warning"
                                  : "good"
                              }
                            >
                              {!u.enabled
                                ? "Disabled"
                                : expired
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
                            <div className="cell-stack">
                              <span>
                                {u.nodeIds.length}{" "}
                                {u.nodeIds.length === 1 ? "node" : "nodes"}
                              </span>
                              <small>
                                {onlineInstances} online client{" "}
                                {onlineInstances === 1
                                  ? "instance"
                                  : "instances"}
                              </small>
                            </div>
                          </td>
                          <td className="nowrap mono">{when(u.usage.next)}</td>
                          <td className="actions-cell">
                            <Actions
                              label={`Actions for ${u.name}`}
                              items={[
                                {
                                  label: "Edit",
                                  icon: <Pencil size={16} />,
                                  onClick: () => save("users", u),
                                },
                                {
                                  label: "Subscription links",
                                  icon: <ArrowUpRight size={16} />,
                                  onClick: () => void links(u),
                                },
                                {
                                  label: "History",
                                  icon: <HistoryIcon size={16} />,
                                  onClick: () => openHistory(u),
                                },
                                {
                                  label: "Reset usage",
                                  icon: <RotateCcw size={16} />,
                                  onClick: () => reset(u),
                                },
                                ...(["subscription", "vpn", "both"] as const).map(
                                  (target) => ({
                                    label: `Rotate ${target}`,
                                    icon: <KeyRound size={16} />,
                                    onClick: () =>
                                      showModal(
                                        <Confirm
                                          title={`Rotate ${target} credentials?`}
                                          action="Rotate"
                                          onClose={closeModal}
                                          onConfirm={async () => {
                                            await run(
                                              () =>
                                                api(
                                                  `users/${u.id}/rotate`,
                                                  "POST",
                                                  { target },
                                                ),
                                              "Credentials rotated",
                                            );
                                            closeModal();
                                          }}
                                        >
                                          <p className="body-copy">
                                            {target === "subscription"
                                              ? "Old subscription links stop working immediately. Downloaded VPN configs remain valid until VPN credentials are rotated."
                                              : target === "vpn"
                                                ? "Old VPN credentials are revoked and active connections disconnect. This user must refresh their subscription."
                                                : "Old subscription links and VPN credentials are revoked, and active connections disconnect. Share the new subscription link."}
                                          </p>
                                        </Confirm>,
                                      ),
                                  }),
                                ),
                                {
                                  label: "Delete",
                                  danger: true,
                                  icon: <Trash2 size={16} />,
                                  onClick: () => remove("users", u),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </section>
            )}

            {tab === "Templates" &&
              (!state.templates.length ? (
                <section className="panel">
                  <Empty
                    title="No templates yet"
                    icon={<FileCode2 size={28} />}
                    action={
                      <button
                        type="button"
                        className="primary"
                        onClick={() => openCreateForTab("Templates")}
                      >
                        <Plus size={18} aria-hidden="true" />
                        <span>Add template</span>
                      </button>
                    }
                  >
                    Create a complete mihomo YAML template with Liquid data
                    tags.
                  </Empty>
                </section>
              ) : !filteredList.length ? (
                <section className="panel">
                  <Empty
                    title="No matching templates"
                    icon={<Search size={26} />}
                    action={
                      <button type="button" onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    }
                  >
                    Try another template name.
                  </Empty>
                </section>
              ) : (
                <div className="templates-grid">
                  {filteredList.map((t, idx) => (
                    <button
                      type="button"
                      className="template-card"
                      style={{ "--i": idx } as CSSProperties}
                      key={t.id}
                      onClick={() =>
                        showModal(
                          <TemplateEditor
                            template={t}
                            state={state}
                            onClose={closeModal}
                            refresh={() => refresh()}
                          />,
                        )
                      }
                    >
                      <div className="template-card-top">
                        <span className="file-icon" aria-hidden="true">
                          <FileCode2 size={22} />
                        </span>
                        <Badge tone={t.published ? "good" : "neutral"}>
                          {t.published ? "Published" : "Draft"}
                        </Badge>
                      </div>
                      <h2>{t.name}</h2>
                      <p className="template-format">
                        mihomo · complete configuration
                      </p>
                      <pre>
                        {(t.draft || t.body).split("\n").slice(0, 7).join("\n")}
                      </pre>
                      <span className="template-card-action">
                        <span>Open template</span>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>
              ))}

            {tab === "Operations" && (
              <section className="panel table-panel">
                {!state.tasks.length ? (
                  <Empty
                    title="No operations yet"
                    icon={<ListChecks size={28} />}
                  >
                    Deployments, upgrades, and session revocations appear here.
                  </Empty>
                ) : (
                  <Table
                    caption="Remote operations"
                    headings={["Operation", "VPS", "Status", "Updated", "Actions"]}
                  >
                    {state.tasks.map((t) => (
                      <tr key={t.id}>
                        <th scope="row">
                          <div className="cell-stack">
                            <strong>{t.kind}</strong>
                            <small className="mono">
                              {t.id.slice(0, 8)} · step {t.step}
                            </small>
                          </div>
                        </th>
                        <td>
                          {state.hosts.find((h) => h.id === t.host)?.name ||
                            "Removed host"}
                        </td>
                        <td>
                          <div className="cell-stack">
                            <Badge
                              tone={
                                t.state === "succeeded"
                                  ? "good"
                                  : t.state === "failed"
                                    ? "danger"
                                    : t.state === "running" ||
                                        t.state === "queued"
                                      ? "accent"
                                      : "neutral"
                              }
                            >
                              {t.state}
                            </Badge>
                            {t.error && <small>{t.error}</small>}
                          </div>
                        </td>
                        <td className="nowrap mono">{when(t.updated)}</td>
                        <td className="actions-cell">
                          <Actions
                            label={`Actions for operation ${t.id.slice(0, 8)}`}
                            items={[
                              {
                                label: "Execution log",
                                icon: <Terminal size={16} />,
                                onClick: () =>
                                  void api(`tasks/${t.id}/logs`)
                                    .then((logs) =>
                                      showModal(
                                        <Code
                                          title="Execution log"
                                          notice="Detailed remote execution log (retained for 90 days)."
                                          text={
                                            logs
                                              .map(
                                                (l: Row) =>
                                                  `${when(l.at)}  ${l.message}`,
                                              )
                                              .join("\n") ||
                                            "No detailed log recorded."
                                          }
                                          onClose={closeModal}
                                        />,
                                      ),
                                    )
                                    .catch((e) => setError(e.message)),
                              },
                              ...(["queued", "running"].includes(t.state)
                                ? [
                                    {
                                      label: "Cancel",
                                      danger: true,
                                      icon: <X size={16} />,
                                      onClick: () =>
                                        act(
                                          `tasks/${t.id}/cancel`,
                                          undefined,
                                          "POST",
                                          "Cancellation requested",
                                        ),
                                    },
                                  ]
                                : []),
                              ...(["failed", "cancelled"].includes(t.state)
                                ? [
                                    {
                                      label: "Retry",
                                      icon: <RotateCcw size={16} />,
                                      onClick: () =>
                                        act(
                                          `tasks/${t.id}/retry`,
                                          undefined,
                                          "POST",
                                          "Operation queued",
                                        ),
                                    },
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
                  <Empty title="No alerts recorded" icon={<Bell size={28} />}>
                    Faults, recoveries, and accounting gaps are recorded here.
                  </Empty>
                ) : (
                  <div className="alert-list">
                    {state.alerts.map((a, idx) => (
                      <article
                        className={`alert-row ${a.closed ? "resolved" : ""}`}
                        style={{ "--i": idx } as CSSProperties}
                        key={a.id}
                      >
                        <span
                          className={`alert-icon ${a.closed ? "resolved" : ""}`}
                          aria-hidden="true"
                        >
                          {a.closed ? (
                            <CheckCircle2 size={19} />
                          ) : (
                            <AlertTriangle size={19} />
                          )}
                        </span>
                        <div className="alert-row-body">
                          <div className="alert-row-head">
                            <strong>{formatAlertCode(a.code)}</strong>
                            <Badge tone={a.closed ? "neutral" : "warning"}>
                              {a.closed ? "Closed" : a.seen ? "Read" : "Open"}
                            </Badge>
                          </div>
                          <p>{a.message}</p>
                          <small className="mono">
                            First {when(a.first)} · Last {when(a.last)}
                            {a.closed && ` · Closed ${when(a.closed)}`}
                          </small>
                        </div>
                        <div className="row-buttons">
                          {!a.seen && (
                            <button
                              type="button"
                              className="compact-button"
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
                              type="button"
                              className="compact-button"
                              onClick={() =>
                                act(
                                  `alerts/${a.id}/close`,
                                  undefined,
                                  "POST",
                                  "Alert closed",
                                )
                              }
                            >
                              Close
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="app-footer">
            <span>JETYET · NETWORK CONTROL</span>
            <span>Hysteria 2 · mihomo</span>
          </footer>
        </div>
      </main>

      {modal}

      <ToastRegion
        message={toast}
        onDismiss={() => setToast("")}
        suppressed={Boolean(modal)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
