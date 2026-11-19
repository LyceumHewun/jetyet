import "@fontsource-variable/space-grotesk";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  FileCode2,
  ListChecks,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { api } from "./client";
import { BrandMark, ToastRegion } from "./components";
import { Login } from "./forms";
import { useRouter } from "./router";
import "./styles.css";
import type { Row, Section, State } from "./types";
import { installAccessibleValidation } from "./validation";
import { AlertsWorkspace } from "./views/AlertsWorkspace";
import { NodesWorkspace } from "./views/NodesWorkspace";
import { OnboardingView } from "./views/OnboardingView";
import { OperationsWorkspace } from "./views/OperationsWorkspace";
import { OverviewView } from "./views/OverviewView";
import { TemplatesWorkspace } from "./views/TemplatesWorkspace";
import { UsersWorkspace } from "./views/UsersWorkspace";
import { VpsWorkspace } from "./views/VpsWorkspace";
import type { ViewContext } from "./views/viewTypes";

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

const primaryNav: Array<{ section: Section; label: string; Icon: typeof Activity }> = [
  { section: "overview", label: "Overview", Icon: Activity },
  { section: "vps", label: "VPS", Icon: Server },
  { section: "nodes", label: "Nodes", Icon: Radio },
  { section: "users", label: "Users", Icon: Users },
  { section: "templates", label: "Templates", Icon: FileCode2 },
];

const sectionNames: Record<Section, string> = {
  overview: "Overview",
  vps: "VPS",
  nodes: "Nodes",
  users: "Users",
  templates: "Templates",
  operations: "Operations",
  alerts: "Alerts",
  onboard: "Onboard VPS",
};

let nextModalKey = 1;

function App() {
  const [session, setSession] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<State>(initial);
  const [modal, setModal] = useState<ReactNode>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | undefined>(
    undefined,
  );
  const systemPopoverId = useId();
  const { route, navigate, goBackToRoot, linkProps } = useRouter();

  useEffect(() => installAccessibleValidation(), []);

  const confirmModal = useCallback((node: ReactNode) => {
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

  useEffect(() => {
    if (checking) {
      document.title = "Loading — Jetyet";
      return;
    }
    if (!session) {
      document.title = "Sign in — Jetyet";
      return;
    }
    const base = sectionNames[route.section] || "Jetyet";
    let itemTitle = "";
    if (route.id) {
      const pool: Row[] =
        route.section === "vps" || route.section === "onboard"
          ? state.hosts
          : route.section === "nodes"
            ? state.nodes
            : route.section === "users"
              ? state.users
              : route.section === "templates"
                ? state.templates
                : [];
      const found = pool.find((x) => x.id === route.id);
      if (found?.name) itemTitle = found.name;
    } else if (route.mode === "new") {
      itemTitle = "New";
    }
    document.title = itemTitle
      ? `${itemTitle} · ${base} — Jetyet`
      : `${base} — Jetyet`;
  }, [checking, session, route, state.hosts, state.nodes, state.users, state.templates]);

  const runAction = useCallback(
    async (fn: () => Promise<any>, message = "Saved") => {
      setLoading(true);
      try {
        const result = await fn();
        await refresh();
        if (message) setToast(message);
        return result;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const workerOnline = useCallback(
    (name: string) => {
      const w = state.workers.find((x) => x.name === name);
      return Boolean(w && Date.now() - w.at < 30000);
    },
    [state.workers],
  );

  if (checking) {
    return (
      <div className="loading-screen">
        <div className="ambient-backdrop" aria-hidden="true" />
        <div className="loading-card">
          <BrandMark size="lg" />
          <progress aria-label="Loading Jetyet" className="flat-progress" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  const activeAlerts = state.alerts.filter((a) => !a.closed);
  const activeOps = state.tasks.filter((t) =>
    ["queued", "running"].includes(t.state),
  ).length;
  const failedOps = state.tasks.filter((t) => t.state === "failed").length;
  const workersLive =
    Number(workerOnline("monitor")) + Number(workerOnline("operations"));

  const ctx: ViewContext = {
    state,
    route,
    navigate,
    goBackToRoot,
    linkProps,
    runAction,
    refresh,
    confirmModal,
    closeModal,
    notify: setToast,
    reportError: setError,
    workerOnline,
  };

  const closeSystemPopover = () => {
    const el = document.getElementById(systemPopoverId) as HTMLElement | null;
    try {
      el?.hidePopover();
    } catch {}
  };

  return (
    <div className="app-shell">
      <div className="ambient-backdrop" aria-hidden="true" />
      <a href="#main-heading" className="skip-link visually-hidden">
        Skip to content
      </a>

      <header className="top-bar">
        <div className="top-bar-inner">
          <a
            {...linkProps({ section: "overview" })}
            className="top-brand"
            aria-label="Jetyet Overview"
          >
            <BrandMark size="md" />
          </a>

          <nav aria-label="Primary" className="top-nav">
            {primaryNav.map(({ section, label }) => {
              const current =
                route.section === section ||
                (section === "vps" && route.section === "onboard");
              return (
                <a
                  key={section}
                  {...linkProps({ section })}
                  aria-current={current ? "page" : undefined}
                  className={current ? "top-nav-link active" : "top-nav-link"}
                >
                  {label}
                </a>
              );
            })}
          </nav>

          <div className="top-actions">
            <a
              {...linkProps({ section: "onboard" })}
              className={`btn primary compact-button top-onboard-cta ${route.section === "onboard" ? "active-route" : ""}`}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Onboard</span>
            </a>

            <a
              {...linkProps({ section: "operations" })}
              aria-current={route.section === "operations" ? "page" : undefined}
              aria-label={
                activeOps
                  ? `Operations (${activeOps} active)`
                  : failedOps
                    ? `Operations (${failedOps} failed)`
                    : "Operations"
              }
              className={`top-icon-link ${route.section === "operations" ? "active" : ""}`}
            >
              <ListChecks size={19} aria-hidden="true" />
              <span className="top-icon-label">Ops</span>
              {(activeOps > 0 || failedOps > 0) && (
                <span
                  className={`count-pill ${failedOps > 0 ? "danger" : "accent"}`}
                >
                  {activeOps > 0 ? activeOps : failedOps}
                </span>
              )}
            </a>

            <a
              {...linkProps({ section: "alerts" })}
              aria-current={route.section === "alerts" ? "page" : undefined}
              aria-label={
                activeAlerts.length
                  ? `Alerts (${activeAlerts.length} open)`
                  : "Alerts"
              }
              className={`top-icon-link ${route.section === "alerts" ? "active" : ""}`}
            >
              <Bell size={19} aria-hidden="true" />
              <span className="top-icon-label">Alerts</span>
              {activeAlerts.length > 0 && (
                <span className="count-pill warn">{activeAlerts.length}</span>
              )}
            </a>

            <button
              type="button"
              aria-label="Refresh workspace state"
              className="icon-button top-refresh-btn"
              disabled={loading || refreshing}
              onClick={() => void refresh(true)}
            >
              <RefreshCw
                size={18}
                className={refreshing ? "spin-active" : ""}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              className="system-trigger"
              aria-label={`System & account (${session})`}
              popoverTarget={systemPopoverId}
              onClick={(e) => {
                if (
                  typeof CSS !== "undefined" &&
                  CSS.supports("position-area: block-end")
                ) {
                  setPopoverStyle(undefined);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                const menuWidth = 280;
                setPopoverStyle({
                  position: "fixed",
                  inset: "auto",
                  margin: 0,
                  left: Math.max(
                    12,
                    Math.min(
                      window.innerWidth - menuWidth - 12,
                      r.right - menuWidth,
                    ),
                  ),
                  top: Math.max(12, r.bottom + 8),
                });
              }}
            >
              <span
                className={`worker-dot ${workersLive === 2 ? "online" : "offline"}`}
                aria-hidden="true"
              />
              <span className="avatar-chip">{session[0]?.toUpperCase()}</span>
              <SlidersHorizontal size={15} aria-hidden="true" />
            </button>

            <div
              id={systemPopoverId}
              popover="auto"
              className="system-popover"
              style={popoverStyle}
            >
              <div className="system-popover-head">
                <div>
                  <strong>{session}</strong>
                  <small>Administrator · HKT (UTC+8)</small>
                </div>
                <span
                  className={`worker-pill ${workersLive === 2 ? "online" : "offline"}`}
                >
                  {workersLive}/2 workers
                </span>
              </div>

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
                      <span
                        className={`worker-state ${online ? "online" : "offline"}`}
                      >
                        {online ? "Live" : "Offline"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="system-popover-links">
                <button
                  type="button"
                  className="popover-link popover-btn"
                  disabled={loading || refreshing}
                  onClick={() => {
                    closeSystemPopover();
                    void refresh(true);
                  }}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>Refresh workspace</span>
                </button>
                <a
                  {...linkProps({ section: "onboard" })}
                  className="popover-link"
                  onClick={(e) => {
                    closeSystemPopover();
                    linkProps({ section: "onboard" }).onClick(e);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span>Onboard new VPS</span>
                </a>
                <a
                  {...linkProps({ section: "operations" })}
                  className="popover-link"
                  onClick={(e) => {
                    closeSystemPopover();
                    linkProps({ section: "operations" }).onClick(e);
                  }}
                >
                  <ListChecks size={16} aria-hidden="true" />
                  <span>Operations queue</span>
                </a>
              </div>

              <button
                type="button"
                className="danger-outline signout-btn"
                onClick={() => {
                  closeSystemPopover();
                  void api("logout", "POST").then(() => setSession(null));
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="main-canvas">
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

        <div key={route.section} className="view-stage">
          {route.section === "overview" && <OverviewView ctx={ctx} />}
          {route.section === "onboard" && <OnboardingView ctx={ctx} />}
          {route.section === "vps" && <VpsWorkspace ctx={ctx} />}
          {route.section === "nodes" && <NodesWorkspace ctx={ctx} />}
          {route.section === "users" && <UsersWorkspace ctx={ctx} />}
          {route.section === "templates" && <TemplatesWorkspace ctx={ctx} />}
          {route.section === "operations" && <OperationsWorkspace ctx={ctx} />}
          {route.section === "alerts" && <AlertsWorkspace ctx={ctx} />}
        </div>

        <footer className="app-footer">
          <span>JETYET · PERSONAL VPN CONTROL</span>
          <span>Hysteria 2 · mihomo · Asia/Hong_Kong</span>
        </footer>
      </main>

      <nav aria-label="Mobile navigation" className="mobile-dock">
        {primaryNav.map(({ section, label, Icon }) => {
          const current =
            route.section === section ||
            (section === "vps" && route.section === "onboard");
          return (
            <a
              key={section}
              {...linkProps({ section })}
              aria-current={current ? "page" : undefined}
              className={current ? "dock-item active" : "dock-item"}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </a>
          );
        })}
      </nav>

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
