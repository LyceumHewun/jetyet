import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ListChecks,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  formatTaskKind,
  parsePayload,
  taskProgress,
  when,
} from "../client";
import {
  Badge,
  CopyButton,
  Empty,
  ProgressRing,
  StackDrillDown,
} from "../components";
import type { Row } from "../types";
import type { ViewContext } from "./viewTypes";

type TaskFilter = "all" | "active" | "failed" | "succeeded" | "cancelled";

export function OperationsWorkspace({ ctx }: { ctx: ViewContext }) {
  const {
    state,
    route,
    navigate,
    goBackToRoot,
    linkProps,
    runAction,
    refresh,
    workerOnline,
  } = ctx;

  const [filter, setFilter] = useState<TaskFilter>("all");
  const [logs, setLogs] = useState<Row[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = state.tasks.filter((t) => {
    if (filter === "active") return ["queued", "running"].includes(t.state);
    if (filter === "failed") return t.state === "failed";
    if (filter === "succeeded") return t.state === "succeeded";
    if (filter === "cancelled") return t.state === "cancelled";
    return true;
  });

  const hasDetail = Boolean(route.id);
  const selectedTask =
    state.tasks.find((t) => t.id === route.id) || filtered[0];

  const loadLogs = useCallback(async (taskId: string) => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const rows = await api(`tasks/${taskId}/logs`);
      setLogs(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setLogsError(
        err instanceof Error ? err.message : "Failed to load execution log",
      );
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      setLogs([]);
      return;
    }
    void loadLogs(selectedTask.id);
    if (["queued", "running"].includes(selectedTask.state)) {
      const id = setInterval(() => {
        void refresh();
        void loadLogs(selectedTask.id);
      }, 2500);
      return () => clearInterval(id);
    }
  }, [selectedTask?.id, selectedTask?.state, selectedTask?.step, loadLogs, refresh]);

  const opsLive = workerOnline("operations");
  const activeCount = state.tasks.filter((t) =>
    ["queued", "running"].includes(t.state),
  ).length;
  const failedCount = state.tasks.filter((t) => t.state === "failed").length;

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">EXECUTION QUEUE</p>
            <h1 id="main-heading" tabIndex={-1}>
              Operations
            </h1>
          </div>
          <Badge tone={opsLive ? "good" : "warning"}>
            {opsLive ? "Worker live" : "Worker offline"}
          </Badge>
        </div>

        <div className="filter-pills">
          {(
            [
              ["all", `All (${state.tasks.length})`],
              ["active", `Active (${activeCount})`],
              ["failed", `Failed (${failedCount})`],
              ["succeeded", "Succeeded"],
              ["cancelled", "Cancelled"],
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
            state.tasks.length ? "No tasks match this filter" : "No operations yet"
          }
          icon={<ListChecks size={26} />}
          action={
            state.tasks.length ? (
              <button type="button" onClick={() => setFilter("all")}>
                Show all tasks
              </button>
            ) : undefined
          }
        >
          {state.tasks.length
            ? "Switch filters to inspect completed or active tasks."
            : "Deployments, upgrades, detections, and session kicks appear here."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="Operations list">
          {filtered.map((t) => {
            const active = selectedTask?.id === t.id;
            const hostName =
              state.hosts.find((h) => h.id === t.host)?.name || "Removed host";
            return (
              <li key={t.id}>
                <a
                  {...linkProps({ section: "operations", id: t.id })}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span className="flow-medallion orchid" aria-hidden="true">
                      <Terminal size={16} />
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{formatTaskKind(t.kind)}</strong>
                      <small>{hostName}</small>
                    </div>
                    <Badge
                      tone={
                        t.state === "succeeded"
                          ? "good"
                          : t.state === "failed"
                            ? "danger"
                            : ["queued", "running"].includes(t.state)
                              ? "accent"
                              : "neutral"
                      }
                    >
                      {t.state}
                    </Badge>
                  </div>
                  <div className="selector-card-meta">
                    <span className="mono">{t.id.slice(0, 8)}</span>
                    <span className="mono">{when(t.updated)}</span>
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
      <Empty title="Select an operation" icon={<ListChecks size={28} />}>
        Inspect live remote checkpoints, execution logs, and retry or cancel
        controls.
      </Empty>
    </div>
  );

  if (selectedTask) {
    const progress = taskProgress(selectedTask);
    const payload = parsePayload(selectedTask.payload);
    const targetHost = state.hosts.find((h) => h.id === selectedTask.host);
    const targetNode = payload.nodeId
      ? state.nodes.find((n) => n.id === payload.nodeId)
      : undefined;

    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{formatTaskKind(selectedTask.kind)}</h2>
                <Badge
                  tone={
                    selectedTask.state === "succeeded"
                      ? "good"
                      : selectedTask.state === "failed"
                        ? "danger"
                        : ["queued", "running"].includes(selectedTask.state)
                          ? "accent"
                          : "neutral"
                  }
                >
                  {selectedTask.state}
                </Badge>
              </div>
              <p className="muted-copy mono">
                Task {selectedTask.id.slice(0, 8)} · Step {selectedTask.step} ·
                Updated {when(selectedTask.updated)}
              </p>
            </div>

            <div className="detail-actions-row">
              {targetHost && (
                <a
                  {...linkProps({ section: "vps", id: targetHost.id })}
                  className="btn compact-button"
                >
                  <Server size={15} aria-hidden="true" />
                  <span>{targetHost.name}</span>
                </a>
              )}
              {targetNode && (
                <a
                  {...linkProps({ section: "nodes", id: targetNode.id })}
                  className="btn compact-button"
                >
                  <Radio size={15} aria-hidden="true" />
                  <span>{targetNode.name}</span>
                </a>
              )}
              {["queued", "running"].includes(selectedTask.state) && (
                <button
                  type="button"
                  className="danger-outline compact-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void runAction(
                      () => api(`tasks/${selectedTask.id}/cancel`, "POST"),
                      "Cancellation requested",
                    ).finally(() => setBusy(false));
                  }}
                >
                  <X size={15} aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              )}
              {["failed", "cancelled"].includes(selectedTask.state) && (
                <button
                  type="button"
                  className="primary compact-button"
                  disabled={busy || !targetHost}
                  onClick={() => {
                    setBusy(true);
                    void runAction(
                      () => api(`tasks/${selectedTask.id}/retry`, "POST"),
                      "Operation re-queued",
                    )
                      .then((res) => {
                        if (res?.id) {
                          navigate({ section: "operations", id: res.id });
                        }
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <section className="surface-card">
          <div className="op-console-summary">
            <ProgressRing
              percent={progress.percent}
              tone={
                selectedTask.state === "succeeded"
                  ? "good"
                  : selectedTask.state === "failed" ||
                      selectedTask.state === "cancelled"
                    ? "danger"
                    : "accent"
              }
              size={64}
            />
            <div className="op-console-meta">
              <h3>{progress.phaseLabel}</h3>
              <p className="muted-copy">
                Created {when(selectedTask.created)}
                {payload.version ? ` · Target ${payload.version}` : ""}
              </p>
            </div>
          </div>

          <ol className="checkpoint-rail">
            {progress.steps.map((cp) => (
              <li key={cp.label} className={`checkpoint ${cp.state}`}>
                <span className="cp-dot" aria-hidden="true">
                  {cp.state === "done" ? (
                    <Check size={12} />
                  ) : cp.state === "error" ? (
                    <X size={12} />
                  ) : null}
                </span>
                <span>{cp.label}</span>
              </li>
            ))}
          </ol>

          {selectedTask.state === "queued" && !opsLive && (
            <p className="notice-banner warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                Queued · Operations worker is currently offline, so remote
                execution has not started.
              </span>
            </p>
          )}

          {selectedTask.error && (
            <p className="form-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{selectedTask.error}</span>
            </p>
          )}
        </section>

        <section className="terminal-card">
          <div className="terminal-head">
            <div className="terminal-dots" aria-hidden="true">
              <i className="dot-r" />
              <i className="dot-y" />
              <i className="dot-g" />
            </div>
            <span className="terminal-title">
              Execution log (retained 90 days)
            </span>
            <div className="inline-actions">
              <button
                type="button"
                className="compact-button"
                disabled={logsLoading}
                onClick={() => void loadLogs(selectedTask.id)}
              >
                <RefreshCw
                  size={14}
                  className={logsLoading ? "spin-active" : ""}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </button>
              <CopyButton
                text={logs
                  .map((l) => `${when(l.at)}  ${l.message}`)
                  .join("\n")}
                label="Copy"
                variant="compact"
                disabled={!logs.length}
              />
            </div>
          </div>

          {logsError && (
            <p className="form-error" role="alert">
              {logsError}
            </p>
          )}

          <pre className="terminal-body">
            {logs.length
              ? logs.map((l) => `${when(l.at)}  ${l.message}`).join("\n")
              : "No detailed execution log recorded yet."}
          </pre>

          <details className="disclosure-block inside-terminal">
            <summary>Task payload</summary>
            <pre className="terminal-body">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </section>
      </div>
    );
  }

  return (
    <StackDrillDown
      hasDetail={hasDetail}
      backLabel="Operations"
      detailTitle={
        selectedTask ? formatTaskKind(selectedTask.kind) : "Operation details"
      }
      onBack={() => goBackToRoot("operations")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="Operations queue"
    />
  );
}
