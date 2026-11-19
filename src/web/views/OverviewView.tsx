import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  FileCode2,
  ListChecks,
  Plus,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";
import {
  formatAlertCode,
  formatTaskKind,
  isHostReadyForNode,
  isNodeHealthy,
  nodeStatusLabel,
  parsePayload,
  taskProgress,
  when,
} from "../client";
import { Badge, BrushWord, ProgressRing, QuotaBar } from "../components";
import type { Route, Row } from "../types";
import type { ViewContext } from "./viewTypes";

type NextAction = {
  id: string;
  tone: "accent" | "warning" | "danger";
  title: string;
  detail: string;
  cta: string;
  route: Route;
};

export function OverviewView({ ctx }: { ctx: ViewContext }) {
  const { state, linkProps, workerOnline } = ctx;
  const activeAlerts = state.alerts.filter((a) => !a.closed);
  const reachableHosts = state.hosts.filter((h) => h.reachable && !h.deleting).length;
  const healthyNodes = state.nodes.filter((n) => isNodeHealthy(n, state.hosts)).length;
  const enabledUsers = state.users.filter((u) => u.enabled).length;
  const workersLive =
    Number(workerOnline("monitor")) + Number(workerOnline("operations"));

  const nextActions: NextAction[] = [];

  for (const h of state.hosts) {
    if (!h.fingerprint && !h.deleting) {
      nextActions.push({
        id: `trust-${h.id}`,
        tone: "warning",
        title: `Verify SSH fingerprint for ${h.name}`,
        detail: `${h.username}@${h.address}:${h.port} cannot run deployments until verified.`,
        cta: "Verify SSH",
        route: { section: "onboard", id: h.id },
      });
    } else if (isHostReadyForNode(h, state.nodes)) {
      nextActions.push({
        id: `plan-${h.id}`,
        tone: "accent",
        title: `Plan & deploy Hysteria 2 on ${h.name}`,
        detail: "Host SSH key is trusted and ready for its endpoint.",
        cta: "Continue onboarding",
        route: { section: "onboard", id: h.id },
      });
    }
  }

  const coveredDriftNodeIds = new Set<string>();
  const coveredFailedHosts = new Set<string>();

  for (const n of state.nodes) {
    if (n.deleting) continue;
    if (n.status === "draft") {
      nextActions.push({
        id: `deploy-${n.id}`,
        tone: "accent",
        title: `Deploy planned node ${n.name}`,
        detail: `${n.address}:${n.port} is saved as draft and not serving yet.`,
        cta: "Open deploy",
        route: { section: "nodes", id: n.id },
      });
    } else if (n.drift) {
      coveredDriftNodeIds.add(n.id);
      nextActions.push({
        id: `drift-${n.id}`,
        tone: "warning",
        title: `Review configuration drift on ${n.name}`,
        detail: "Remote Hysteria config differs from platform desired settings.",
        cta: "Inspect drift",
        route: { section: "nodes", id: n.id, sub: "drift" },
      });
    }
  }

  for (const t of state.tasks.slice(0, 12)) {
    if (t.state === "failed") {
      coveredFailedHosts.add(t.host);
      const hostName =
        state.hosts.find((h) => h.id === t.host)?.name || "VPS host";
      nextActions.push({
        id: `task-${t.id}`,
        tone: "danger",
        title: `Failed ${formatTaskKind(t.kind).toLowerCase()} on ${hostName}`,
        detail: t.error || "Inspect execution logs and retry safely.",
        cta: "Inspect task",
        route: { section: "operations", id: t.id },
      });
    }
  }

  for (const a of activeAlerts.slice(0, 6)) {
    if (a.code === "configuration-drift" && coveredDriftNodeIds.has(a.entity)) {
      continue;
    }
    if (a.code === "operation-failed" && coveredFailedHosts.has(a.entity)) {
      continue;
    }
    nextActions.push({
      id: `alert-${a.id}`,
      tone: "warning",
      title: formatAlertCode(a.code),
      detail: a.message,
      cta: "Triage alert",
      route: { section: "alerts", id: a.id },
    });
  }

  for (const u of state.users) {
    const expired = u.expires && Date.parse(u.expires) <= Date.now();
    if (u.exhausted || expired) {
      nextActions.push({
        id: `user-${u.id}`,
        tone: "warning",
        title: `${u.name} is ${expired ? "expired" : "over traffic quota"}`,
        detail: expired
          ? "Subscription retrieval and VPN access are blocked."
          : "VPN access is suspended until next reset or allowance increase.",
        cta: "Manage user",
        route: { section: "users", id: u.id },
      });
    }
  }

  const latestTask = state.tasks[0];
  const latestProgress = latestTask ? taskProgress(latestTask) : null;
  const latestTaskHost = latestTask
    ? state.hosts.find((h) => h.id === latestTask.host)?.name || "VPS"
    : "";

  const isEmpty = !state.hosts.length && !state.nodes.length && !state.users.length;
  const hasUrgent = nextActions.length > 0;

  return (
    <div className="overview-stage">
      <section className="hero-banner" aria-labelledby="main-heading">
        <div className="hero-banner-top">
          <div className="hero-banner-copy">
            <p className="eyebrow">NETWORK CONTROL</p>
            <h1 id="main-heading" tabIndex={-1}>
              {isEmpty ? (
                <>
                  Bring your first <BrushWord>VPS online.</BrushWord>
                </>
              ) : hasUrgent ? (
                <>
                  {nextActions.length}{" "}
                  <BrushWord>
                    {nextActions.length === 1 ? "action" : "actions"}
                  </BrushWord>{" "}
                  need attention.
                </>
              ) : (
                <>
                  Your network is <BrushWord>running smoothly.</BrushWord>
                </>
              )}
            </h1>
            <p className="hero-banner-lead">
              {isEmpty
                ? "Add a Debian or Ubuntu VPS, verify its SSH host key explicitly, deploy Hysteria 2, and issue private mihomo subscriptions."
                : "Monitor host health, queue remote Hysteria 2 operations, and share individual mihomo links from one workspace."}
            </p>
          </div>

          <div className="hero-banner-ctas">
            <a {...linkProps({ section: "onboard" })} className="btn primary">
              <Plus size={18} aria-hidden="true" />
              <span>Onboard VPS</span>
            </a>
            <a
              {...linkProps({ section: "users", mode: "new" })}
              className="btn secondary"
            >
              <Users size={17} aria-hidden="true" />
              <span>Add user</span>
            </a>
          </div>
        </div>

        <div className="telemetry-strip" aria-label="Live fleet summary">
          <a {...linkProps({ section: "vps" })} className="telemetry-chip">
            <span className="chip-icon orchid" aria-hidden="true">
              <Server size={15} />
            </span>
            <span className="chip-copy">
              <strong>
                {reachableHosts}/{state.hosts.length}
              </strong>{" "}
              VPS reachable
            </span>
          </a>
          <a {...linkProps({ section: "nodes" })} className="telemetry-chip">
            <span className="chip-icon good" aria-hidden="true">
              <Radio size={15} />
            </span>
            <span className="chip-copy">
              <strong>
                {healthyNodes}/{state.nodes.length}
              </strong>{" "}
              nodes healthy
            </span>
          </a>
          <a {...linkProps({ section: "users" })} className="telemetry-chip">
            <span className="chip-icon lavender" aria-hidden="true">
              <Users size={15} />
            </span>
            <span className="chip-copy">
              <strong>
                {enabledUsers}/{state.users.length}
              </strong>{" "}
              users enabled
            </span>
          </a>
          <a {...linkProps({ section: "operations" })} className="telemetry-chip">
            <span
              className={`chip-icon ${workersLive === 2 ? "good" : "warn"}`}
              aria-hidden="true"
            >
              <Activity size={15} />
            </span>
            <span className="chip-copy">
              <strong>{workersLive}/2</strong> workers live
            </span>
          </a>
          <a {...linkProps({ section: "alerts" })} className="telemetry-chip">
            <span
              className={`chip-icon ${activeAlerts.length ? "warn" : "neutral"}`}
              aria-hidden="true"
            >
              <Bell size={15} />
            </span>
            <span className="chip-copy">
              <strong>{activeAlerts.length}</strong> open{" "}
              {activeAlerts.length === 1 ? "alert" : "alerts"}
            </span>
          </a>
        </div>
      </section>

      <section className="next-actions-section" aria-label="Next actions">
        <div className="section-head-bar">
          <div>
            <h2>Next actions</h2>
            <p className="muted-copy">
              Direct entry points derived from live host, node, operation, and
              quota state.
            </p>
          </div>
          {nextActions.length > 0 && (
            <Badge tone="warning" icon={<AlertTriangle size={14} />}>
              {nextActions.length} pending
            </Badge>
          )}
        </div>

        {nextActions.length ? (
          <div className="action-cards-grid">
            {nextActions.slice(0, 6).map((item) => (
              <a
                key={item.id}
                {...linkProps(item.route)}
                className={`action-card ${item.tone}`}
              >
                <div className="action-card-top">
                  <Badge
                    tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "accent"}
                  >
                    {item.tone === "danger"
                      ? "Failure"
                      : item.tone === "warning"
                        ? "Attention"
                        : "Ready"}
                  </Badge>
                  <ArrowUpRight size={17} className="card-arrow" aria-hidden="true" />
                </div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <span className="action-card-cta">
                  <span>{item.cta}</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="surface-card calm-banner">
            <div className="calm-banner-copy">
              <span className="flow-medallion good" aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h3>Everything looks healthy</h3>
                <p className="muted-copy">
                  No untrusted SSH keys, configuration drift, failed tasks, or
                  open alerts.
                </p>
              </div>
            </div>
            <div className="inline-actions">
              <a {...linkProps({ section: "onboard" })} className="btn compact-button">
                <Plus size={16} aria-hidden="true" />
                <span>Onboard VPS</span>
              </a>
              <a {...linkProps({ section: "users" })} className="btn compact-button">
                <Users size={16} aria-hidden="true" />
                <span>Share user link</span>
              </a>
              <a {...linkProps({ section: "templates" })} className="btn compact-button">
                <FileCode2 size={16} aria-hidden="true" />
                <span>Edit templates</span>
              </a>
            </div>
          </div>
        )}
      </section>

      <div className="overview-grid">
        <section className="surface-card fleet-panel" aria-label="Fleet pairings">
          <div className="card-head-row">
            <div>
              <h2>VPS & Node Topology</h2>
              <p className="muted-copy">
                Each trusted VPS hosts up to one native Hysteria 2 node.
              </p>
            </div>
            <a {...linkProps({ section: "vps" })} className="btn compact-button">
              <span>All VPS</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>

          {!state.hosts.length ? (
            <div className="empty compact-empty">
              <p>No VPS hosts connected yet.</p>
              <a {...linkProps({ section: "onboard" })} className="btn primary">
                <Plus size={17} aria-hidden="true" />
                <span>Start onboarding</span>
              </a>
            </div>
          ) : (
            <div className="topology-list">
              {state.hosts.slice(0, 6).map((h: Row) => {
                const node = state.nodes.find((n) => n.hostId === h.id);
                const nodeState = node ? nodeStatusLabel(node, state.hosts) : "";
                return (
                  <div className="topology-row" key={h.id}>
                    <a
                      {...linkProps({ section: "vps", id: h.id })}
                      className="topology-host"
                    >
                      <span className="flow-medallion orchid" aria-hidden="true">
                        <Server size={17} />
                      </span>
                      <span className="topology-meta">
                        <strong>{h.name}</strong>
                        <small className="mono">
                          {h.address}:{h.port}
                        </small>
                      </span>
                      <span className="topology-telemetry">
                        {h.fingerprint ? (
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
                                ? `CPU ${h.cpu?.toFixed(0) ?? "—"}%`
                                : "Unreachable"}
                          </Badge>
                        ) : (
                          <Badge tone="warning" icon={<ShieldAlert size={13} />}>
                            Verify SSH
                          </Badge>
                        )}
                      </span>
                    </a>

                    <span className="topology-connector" aria-hidden="true">
                      <ArrowRight size={16} />
                    </span>

                    {node ? (
                      <a
                        {...linkProps({ section: "nodes", id: node.id })}
                        className="topology-node"
                      >
                        <span className="topology-meta">
                          <strong>{node.name}</strong>
                          <small className="mono">
                            {node.address}:{node.port}
                            {node.version ? ` · ${node.version}` : ""}
                          </small>
                        </span>
                        <Badge
                          tone={
                            nodeState === "Running"
                              ? "good"
                              : nodeState === "Planned"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {nodeState}
                        </Badge>
                      </a>
                    ) : (
                      <a
                        {...linkProps({ section: "onboard", id: h.id })}
                        className="topology-node empty-slot"
                      >
                        <span>
                          {h.fingerprint
                            ? "No node yet · Plan & deploy"
                            : "Verify SSH first"}
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="overview-side-col">
          <section className="surface-card op-preview-card" aria-label="Latest operation">
            <div className="card-head-row">
              <h2>Latest Operation</h2>
              <a
                {...linkProps({ section: "operations" })}
                className="btn compact-button"
              >
                <span>Queue</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>

            {!latestTask || !latestProgress ? (
              <div className="empty compact-empty">
                <Terminal size={24} className="muted-icon" aria-hidden="true" />
                <p>Remote deployments, upgrades, and detections appear here.</p>
              </div>
            ) : (
              <a
                {...linkProps({ section: "operations", id: latestTask.id })}
                className="op-preview-link"
              >
                <ProgressRing
                  percent={latestProgress.percent}
                  tone={
                    latestTask.state === "succeeded"
                      ? "good"
                      : latestTask.state === "failed" ||
                          latestTask.state === "cancelled"
                        ? "danger"
                        : "accent"
                  }
                />
                <div className="op-preview-copy">
                  <div className="op-preview-head">
                    <strong>{formatTaskKind(latestTask.kind)}</strong>
                    <Badge
                      tone={
                        latestTask.state === "succeeded"
                          ? "good"
                          : latestTask.state === "failed"
                            ? "danger"
                            : "accent"
                      }
                    >
                      {latestTask.state}
                    </Badge>
                  </div>
                  <p className="muted-copy">
                    {latestTaskHost} · {latestProgress.phaseLabel}
                  </p>
                  {latestTask.error ? (
                    <small className="error-text-inline">{latestTask.error}</small>
                  ) : (
                    <small className="mono">
                      {parsePayload(latestTask.payload).version || when(latestTask.updated)}
                    </small>
                  )}
                </div>
                <ArrowUpRight size={18} className="card-arrow" aria-hidden="true" />
              </a>
            )}
          </section>

          <section className="surface-card users-pulse-card" aria-label="Subscription usage">
            <div className="card-head-row">
              <div>
                <h2>Subscription Usage</h2>
                <p className="muted-copy">Independent HKT reset schedules</p>
              </div>
              <a {...linkProps({ section: "users" })} className="btn compact-button">
                <span>All users</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>

            {!state.users.length ? (
              <div className="empty compact-empty">
                <p>Create a user to generate personal mihomo subscription URLs.</p>
                <a
                  {...linkProps({ section: "users", mode: "new" })}
                  className="btn primary"
                >
                  <Plus size={17} aria-hidden="true" />
                  <span>Add user</span>
                </a>
              </div>
            ) : (
              <div className="usage-pulse-list">
                {state.users.slice(0, 4).map((u: Row) => {
                  const expired = u.expires && Date.parse(u.expires) <= Date.now();
                  return (
                    <a
                      key={u.id}
                      {...linkProps({ section: "users", id: u.id })}
                      className="usage-pulse-row"
                    >
                      <div className="usage-pulse-head">
                        <strong>{u.name}</strong>
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
                                : "Active"}
                        </Badge>
                      </div>
                      <QuotaBar row={u} compact />
                      <div className="usage-pulse-foot">
                        <small className="mono">
                          Resets {when(u.usage?.next)}
                        </small>
                        <small className="link-cta">
                          Copy link <ArrowRight size={13} aria-hidden="true" />
                        </small>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
