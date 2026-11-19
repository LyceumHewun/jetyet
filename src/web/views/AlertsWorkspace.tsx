import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Eye,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { api, formatAlertCode, when } from "../client";
import { Badge, Empty, StackDrillDown } from "../components";
import type { Route, Row } from "../types";
import type { ViewContext } from "./viewTypes";

type AlertFilter = "open" | "unread" | "closed" | "all";

export function AlertsWorkspace({ ctx }: { ctx: ViewContext }) {
  const { state, route, goBackToRoot, linkProps, runAction } = ctx;
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [busy, setBusy] = useState(false);

  const openCount = state.alerts.filter((a) => !a.closed).length;
  const unreadCount = state.alerts.filter((a) => !a.closed && !a.seen).length;

  const filtered = state.alerts
    .filter((a) => {
      if (filter === "open") return !a.closed;
      if (filter === "unread") return !a.closed && !a.seen;
      if (filter === "closed") return Boolean(a.closed);
      return true;
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.closed)) - Number(Boolean(b.closed)) ||
        (b.last || 0) - (a.last || 0),
    );

  const hasDetail = Boolean(route.id);
  const selectedAlert =
    state.alerts.find((a) => a.id === route.id) || filtered[0];

  const resolveEntityTarget = (
    entityId: string,
  ): { label: string; route: Route } | null => {
    if (entityId === "platform") {
      return { label: "Operations & workers", route: { section: "operations" } };
    }
    const host = state.hosts.find((h) => h.id === entityId);
    if (host) {
      return {
        label: `VPS · ${host.name}`,
        route: { section: "vps", id: host.id },
      };
    }
    const node = state.nodes.find((n) => n.id === entityId);
    if (node) {
      return {
        label: `Node · ${node.name}`,
        route: { section: "nodes", id: node.id },
      };
    }
    const user = state.users.find((u) => u.id === entityId);
    if (user) {
      return {
        label: `User · ${user.name}`,
        route: { section: "users", id: user.id },
      };
    }
    return null;
  };

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">IN-PLATFORM ALERTS</p>
            <h1 id="main-heading" tabIndex={-1}>
              Alerts
            </h1>
          </div>
          <Badge tone={openCount ? "warning" : "good"}>
            {openCount} open
          </Badge>
        </div>

        <div className="filter-pills">
          {(
            [
              ["all", `All (${state.alerts.length})`],
              ["open", `Open (${openCount})`],
              ["unread", `Unread (${unreadCount})`],
              ["closed", "Closed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? "filter-pill active" : "filter-pill"}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <Empty
          title={
            state.alerts.length
              ? "No alerts in this view"
              : "No alerts recorded"
          }
          icon={<ShieldCheck size={26} />}
          action={
            state.alerts.length ? (
              <button type="button" onClick={() => setFilter("all")}>
                Show all alerts
              </button>
            ) : undefined
          }
        >
          {state.alerts.length
            ? "Switch filters to review closed or unread incidents."
            : "SSH host-key changes, probe faults, worker outages, and accounting gaps appear here."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="Alert list">
          {filtered.map((a: Row) => {
            const active = selectedAlert?.id === a.id;
            const target = resolveEntityTarget(a.entity);
            return (
              <li key={a.id}>
                <a
                  {...linkProps({ section: "alerts", id: a.id })}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span
                      className={`flow-medallion ${a.closed ? "good" : "warn"}`}
                      aria-hidden="true"
                    >
                      {a.closed ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <AlertTriangle size={16} />
                      )}
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{formatAlertCode(a.code)}</strong>
                      <small>{target?.label || a.entity}</small>
                    </div>
                    <Badge tone={a.closed ? "neutral" : "warning"}>
                      {a.closed ? "Closed" : a.seen ? "Read" : "Open"}
                    </Badge>
                  </div>
                  <div className="selector-card-meta">
                    <span className="truncate-line">{a.message}</span>
                    <span className="mono">{when(a.last)}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  let detailPane = (
    <div className="surface-card detail-empty">
      <Empty title="Select an alert" icon={<Bell size={28} />}>
        Review incident timestamps, acknowledge unread faults, or jump directly
        to the affected VPS or node.
      </Empty>
    </div>
  );

  if (selectedAlert) {
    const target = resolveEntityTarget(selectedAlert.entity);
    const isGap = String(selectedAlert.code || "").includes("gap");

    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{formatAlertCode(selectedAlert.code)}</h2>
                <Badge tone={selectedAlert.closed ? "neutral" : "warning"}>
                  {selectedAlert.closed
                    ? "Closed"
                    : selectedAlert.seen
                      ? "Read"
                      : "Open"}
                </Badge>
              </div>
              <p className="muted-copy mono">
                Code: {selectedAlert.code} ·{" "}
                {target ? target.label : selectedAlert.entity}
              </p>
            </div>

            <div className="detail-actions-row">
              {!selectedAlert.seen && (
                <button
                  type="button"
                  className="compact-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void runAction(
                      () => api(`alerts/${selectedAlert.id}/read`, "POST"),
                      "Alert marked read",
                    ).finally(() => setBusy(false));
                  }}
                >
                  <Eye size={15} aria-hidden="true" />
                  <span>Mark read</span>
                </button>
              )}
              {!selectedAlert.closed && (
                <button
                  type="button"
                  className="primary compact-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void runAction(
                      () => api(`alerts/${selectedAlert.id}/close`, "POST"),
                      "Alert closed",
                    ).finally(() => setBusy(false));
                  }}
                >
                  <Check size={15} aria-hidden="true" />
                  <span>Close alert</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <section className="surface-card">
          <h3>Incident Details</h3>
          <p className="body-copy">{selectedAlert.message}</p>

          <div className="direction-totals">
            <div>
              <small>First observed</small>
              <strong className="mono">{when(selectedAlert.first)}</strong>
            </div>
            <div>
              <small>Last observed</small>
              <strong className="mono">{when(selectedAlert.last)}</strong>
            </div>
            <div>
              <small>Closed</small>
              <strong className="mono">
                {selectedAlert.closed ? when(selectedAlert.closed) : "Active"}
              </strong>
            </div>
          </div>

          <p className="notice-banner">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>
              {isGap
                ? "Closing an accounting-gap alert acknowledges review without deleting or altering the permanently retained gap record."
                : "Marking an alert as read does not resolve its underlying condition. Resolved faults close automatically on recovery."}
            </span>
          </p>

          {target && (
            <div className="inline-actions">
              <a {...linkProps(target.route)} className="btn primary">
                <span>Inspect {target.label}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <StackDrillDown
      hasDetail={hasDetail}
      backLabel="Alerts"
      detailTitle={
        selectedAlert ? formatAlertCode(selectedAlert.code) : "Alert details"
      }
      onBack={() => goBackToRoot("alerts")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="Alerts list"
    />
  );
}
