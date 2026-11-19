import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ListChecks,
  Pencil,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  api,
  formatTaskKind,
  isValidIpLiteral,
  parsePayload,
  taskProgress,
  when,
} from "../client";
import { Badge, CopyButton, ProgressRing } from "../components";
import { HostFormPanel, NodeFormPanel } from "../forms";
import type { Row } from "../types";
import { NodeDeployPanel } from "./NodeDeployPanel";
import { SshTrustPanel } from "./SshTrustPanel";
import type { ViewContext } from "./viewTypes";

type StepNum = 1 | 2 | 3 | 4;

export function OnboardingView({ ctx }: { ctx: ViewContext }) {
  const { state, route, navigate, linkProps, runAction, refresh, workerOnline } =
    ctx;
  const host = route.id
    ? state.hosts.find((h) => h.id === route.id && !h.deleting)
    : undefined;
  const node = host
    ? state.nodes.find((n) => n.hostId === host.id && !n.deleting)
    : undefined;

  const hostTasks = host
    ? state.tasks.filter((t) => {
        if (t.host !== host.id) return false;
        const payload = parsePayload(t.payload);
        return (
          ["deploy", "upgrade", "reapply", "detect"].includes(t.kind) &&
          (!node || !payload.nodeId || payload.nodeId === node.id)
        );
      })
    : [];

  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const trackedTask =
    (selectedTaskId
      ? state.tasks.find((t) => t.id === selectedTaskId)
      : undefined) || hostTasks[0];

  const computeRecommendedStep = (): StepNum => {
    if (!host) return 1;
    if (!host.fingerprint) return 2;
    if (!node) return 3;
    if (
      trackedTask &&
      (trackedTask.state === "queued" || trackedTask.state === "running")
    ) {
      return 4;
    }
    if (node.status === "ready") return 4;
    return 3;
  };

  const [step, setStep] = useState<StepNum>(computeRecommendedStep);
  const [logs, setLogs] = useState<Row[]>([]);
  const [logsError, setLogsError] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastHostIdRef = useRef<string | undefined>(route.id);

  useEffect(() => {
    if (lastHostIdRef.current !== route.id) {
      lastHostIdRef.current = route.id;
      setSelectedTaskId("");
      setStep(computeRecommendedStep());
    }
  }, [route.id]);

  useEffect(() => {
    if (route.sub === "step1") setStep(1);
    else if (route.sub === "step2" && host) setStep(2);
    else if (route.sub === "step3" && host?.fingerprint) setStep(3);
    else if (route.sub === "step4" && trackedTask) setStep(4);
  }, [route.sub, host?.id, host?.fingerprint, trackedTask?.id]);

  useEffect(() => {
    if (step !== 4 || !trackedTask) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    const loadLogs = () => {
      void api(`tasks/${trackedTask.id}/logs`)
        .then((rows) => {
          if (!cancelled) {
            setLogs(Array.isArray(rows) ? rows : []);
            setLogsError("");
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setLogsError(
              err instanceof Error ? err.message : "Failed to load task logs",
            );
          }
        });
    };
    loadLogs();
    if (trackedTask.state === "queued" || trackedTask.state === "running") {
      const id = setInterval(() => {
        void refresh();
        loadLogs();
      }, 2500);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [step, trackedTask?.id, trackedTask?.state, trackedTask?.step, refresh]);

  const goToStep = (next: StepNum) => {
    setStep(next);
    requestAnimationFrame(() => {
      stepHeadingRef.current?.focus({ preventScroll: true });
    });
  };

  const step1Done = Boolean(host);
  const step2Done = Boolean(host?.fingerprint);
  const step3Done = Boolean(node && (node.status === "ready" || trackedTask));
  const step4Done = Boolean(trackedTask?.state === "succeeded");

  const stepsMeta = [
    {
      num: 1 as StepNum,
      title: "Add VPS",
      desc: host ? `${host.name} (${host.address})` : "SSH host & traffic cap",
      done: step1Done,
      unlocked: true,
    },
    {
      num: 2 as StepNum,
      title: "Verify & trust SSH",
      desc: host?.fingerprint
        ? "SHA-256 host key verified"
        : host
          ? "Inspect SHA-256 fingerprint"
          : "Requires VPS first",
      done: step2Done,
      unlocked: Boolean(host),
    },
    {
      num: 3 as StepNum,
      title: "Plan & deploy node",
      desc: node
        ? `${node.name} (${node.address}:${node.port})`
        : "Hysteria 2 config & script",
      done: step3Done,
      unlocked: Boolean(host?.fingerprint),
    },
    {
      num: 4 as StepNum,
      title: "Track operation",
      desc: trackedTask
        ? `${formatTaskKind(trackedTask.kind)} · ${trackedTask.state}`
        : "Live worker & log state",
      done: step4Done,
      unlocked: Boolean(trackedTask || node?.status === "ready"),
    },
  ];

  const activeProgress = trackedTask ? taskProgress(trackedTask) : null;

  return (
    <div className="onboard-page">
      <div className="onboard-header">
        <div>
          <a {...linkProps({ section: "vps" })} className="back-link-inline">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to VPS</span>
          </a>
          <p className="eyebrow">GUIDED HOST ONBOARDING</p>
          <h1 id="main-heading" tabIndex={-1}>
            {host ? `Onboard ${host.name}` : "Connect & deploy a VPS"}
          </h1>
          <p className="muted-copy">
            Explicit SSH key confirmation precedes any remote execution. Live
            operation status always reflects real worker state.
          </p>
        </div>

        {host && (
          <a
            {...linkProps({ section: "vps", id: host.id })}
            className="btn compact-button"
          >
            <Server size={16} aria-hidden="true" />
            <span>Open VPS workspace</span>
          </a>
        )}
      </div>

      <div className="onboard-layout">
        <nav aria-label="Onboarding progress" className="onboard-rail">
          <ol className="timeline-steps">
            {stepsMeta.map((s) => {
              const current = step === s.num;
              return (
                <li
                  key={s.num}
                  className={[
                    "timeline-step",
                    current ? "current" : "",
                    s.done ? "done" : "",
                    !s.unlocked ? "locked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="timeline-step-btn"
                    disabled={!s.unlocked}
                    aria-current={current ? "step" : undefined}
                    onClick={() => goToStep(s.num)}
                  >
                    <span className="timeline-node" aria-hidden="true">
                      {s.done ? <Check size={15} /> : s.num}
                    </span>
                    <span className="timeline-copy">
                      <strong>{s.title}</strong>
                      <small>{s.desc}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="onboard-stage" aria-live="polite">
          {step === 1 && (
            <div className="surface-card stage-card">
              <div className="stage-card-head">
                <h2 ref={stepHeadingRef} tabIndex={-1}>
                  {host
                    ? `1. Edit SSH connection for ${host.name}`
                    : "1. Add VPS connection"}
                </h2>
                <p className="muted-copy">
                  {host
                    ? "Update SSH host, port, or credentials before scanning the host key again."
                    : "Supply SSH access details and host-level traffic allowance."}
                </p>
              </div>
              <HostFormPanel
                host={host}
                submitLabel={
                  host
                    ? "Save & inspect SSH key"
                    : "Save VPS & verify SSH key"
                }
                onCancel={
                  host ? () => goToStep(2) : () => navigate({ section: "vps" })
                }
                onSave={async (payload) => {
                  if (host) {
                    await runAction(
                      () => api(`hosts/${host.id}`, "PUT", payload),
                      "VPS updated",
                    );
                    goToStep(2);
                  } else {
                    const created = await runAction(
                      () => api("hosts", "POST", payload),
                      "VPS added · Verify SSH fingerprint next",
                    );
                    navigate({ section: "onboard", id: created.id });
                    setStep(2);
                  }
                }}
              />
            </div>
          )}

          {step === 2 && host && (
            <div className="stage-stack">
              <div className="surface-card stage-intro">
                <h2 ref={stepHeadingRef} tabIndex={-1}>
                  2. Verify & trust SSH fingerprint
                </h2>
                <p className="muted-copy">
                  Inspect the server's public key and confirm it matches your
                  provider console before planning or deploying Hysteria 2.
                </p>
              </div>

              <SshTrustPanel
                host={host}
                runAction={runAction}
                onEditConnection={() => goToStep(1)}
                onContinue={() => goToStep(3)}
                onTrusted={() => goToStep(3)}
              />
            </div>
          )}

          {step === 3 && host && host.fingerprint && (
            <div className="stage-stack">
              <div className="surface-card stage-intro">
                <div className="card-head-row">
                  <div>
                    <h2 ref={stepHeadingRef} tabIndex={-1}>
                      {node
                        ? `3. Deploy ${node.name}`
                        : `3. Plan Hysteria 2 node on ${host.name}`}
                    </h2>
                    <p className="muted-copy">
                      {node
                        ? "Queue automated SSH deployment or generate the standard root install script and detect it."
                        : "Each VPS hosts one native Hysteria 2 node."}
                    </p>
                  </div>
                  {node && (
                    <a
                      {...linkProps({ section: "nodes", id: node.id })}
                      className="btn compact-button"
                    >
                      <Radio size={15} aria-hidden="true" />
                      <span>Node workspace</span>
                    </a>
                  )}
                </div>
              </div>

              {!node ? (
                <div className="surface-card stage-card">
                  <NodeFormPanel
                    lockedHost={host}
                    state={state}
                    initialName={host.name}
                    initialAddress={
                      isValidIpLiteral(host.address) ? host.address : ""
                    }
                    submitLabel="Save node plan & continue"
                    onSave={async (payload) => {
                      await runAction(
                        () => api("nodes", "POST", payload),
                        "Node planned · Choose deployment path",
                      );
                    }}
                  />
                </div>
              ) : (
                <>
                  <NodeDeployPanel
                    node={node}
                    operationsWorkerOnline={workerOnline("operations")}
                    runAction={runAction}
                    onTaskQueued={(taskId) => {
                      setSelectedTaskId(taskId);
                      goToStep(4);
                    }}
                  />
                  {trackedTask && (
                    <div className="inline-actions">
                      <button type="button" onClick={() => goToStep(4)}>
                        <ListChecks size={16} aria-hidden="true" />
                        <span>View latest operation ({trackedTask.state})</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 4 && host && (
            <div className="stage-stack">
              <div className="surface-card stage-intro">
                <div className="card-head-row">
                  <div>
                    <h2 ref={stepHeadingRef} tabIndex={-1}>
                      4. Operation status
                    </h2>
                    <p className="muted-copy">
                      Real task state and remote logs from the operations worker.
                    </p>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="compact-button"
                      onClick={() => void refresh(true)}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    {trackedTask && (
                      <a
                        {...linkProps({
                          section: "operations",
                          id: trackedTask.id,
                        })}
                        className="btn compact-button"
                      >
                        <ListChecks size={15} aria-hidden="true" />
                        <span>Open in Operations</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {!trackedTask || !activeProgress ? (
                <div className="surface-card stage-card">
                  <p className="body-copy">
                    No remote deployment or detection operation has been queued
                    for {host.name} yet.
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => goToStep(3)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    <span>Back to deployment options</span>
                  </button>
                </div>
              ) : (
                <div className="terminal-card operation-console">
                  <div className="terminal-head">
                    <div className="terminal-dots" aria-hidden="true">
                      <i className="dot-r" />
                      <i className="dot-y" />
                      <i className="dot-g" />
                    </div>
                    <span className="terminal-title mono">
                      {formatTaskKind(trackedTask.kind)} ·{" "}
                      {trackedTask.id.slice(0, 8)}
                    </span>
                    <Badge
                      tone={
                        trackedTask.state === "succeeded"
                          ? "good"
                          : trackedTask.state === "failed" ||
                              trackedTask.state === "cancelled"
                            ? "danger"
                            : "accent"
                      }
                    >
                      {trackedTask.state}
                    </Badge>
                  </div>

                  <div className="op-console-summary">
                    <ProgressRing
                      percent={activeProgress.percent}
                      tone={
                        trackedTask.state === "succeeded"
                          ? "good"
                          : trackedTask.state === "failed" ||
                              trackedTask.state === "cancelled"
                            ? "danger"
                            : "accent"
                      }
                      size={64}
                    />
                    <div className="op-console-meta">
                      <h3>{activeProgress.phaseLabel}</h3>
                      <p className="muted-copy">
                        Updated {when(trackedTask.updated)} · Step{" "}
                        {trackedTask.step}
                      </p>
                    </div>
                  </div>

                  <ol className="checkpoint-rail">
                    {activeProgress.steps.map((cp) => (
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

                  {trackedTask.state === "queued" &&
                    !workerOnline("operations") && (
                      <p className="notice-banner warning">
                        <AlertTriangle size={18} aria-hidden="true" />
                        <span>
                          Queued for remote execution. Start{" "}
                          <code>bun run operations</code> to execute this task
                          on {host.address}.
                        </span>
                      </p>
                    )}

                  {trackedTask.error && (
                    <p className="form-error" role="alert">
                      <AlertCircle size={18} aria-hidden="true" />
                      <span>{trackedTask.error}</span>
                    </p>
                  )}

                  {logsError && (
                    <p className="form-error" role="alert">
                      <AlertCircle size={18} aria-hidden="true" />
                      <span>{logsError}</span>
                    </p>
                  )}

                  <div className="terminal-log-wrap">
                    <div className="terminal-log-head">
                      <span>Execution log</span>
                      <CopyButton
                        text={logs
                          .map((l) => `${when(l.at)}  ${l.message}`)
                          .join("\n")}
                        label="Copy logs"
                        variant="compact"
                        disabled={!logs.length}
                      />
                    </div>
                    <pre className="terminal-body">
                      {logs.length
                        ? logs
                            .map((l) => `${when(l.at)}  ${l.message}`)
                            .join("\n")
                        : trackedTask.state === "queued"
                          ? "Waiting for operations worker to claim task…"
                          : "No log lines recorded yet."}
                    </pre>
                  </div>

                  <div className="op-console-actions">
                    {["queued", "running"].includes(trackedTask.state) && (
                      <button
                        type="button"
                        className="danger-outline"
                        disabled={taskBusy}
                        onClick={() => {
                          setTaskBusy(true);
                          void runAction(
                            () =>
                              api(`tasks/${trackedTask.id}/cancel`, "POST"),
                            "Cancellation requested",
                          ).finally(() => setTaskBusy(false));
                        }}
                      >
                        <X size={16} aria-hidden="true" />
                        <span>Cancel operation</span>
                      </button>
                    )}

                    {["failed", "cancelled"].includes(trackedTask.state) && (
                      <>
                        <button
                          type="button"
                          className="primary"
                          disabled={taskBusy}
                          onClick={() => {
                            setTaskBusy(true);
                            void runAction(
                              () =>
                                api(`tasks/${trackedTask.id}/retry`, "POST"),
                              "Operation re-queued",
                            )
                              .then((res) => {
                                if (res?.id) setSelectedTaskId(res.id);
                              })
                              .finally(() => setTaskBusy(false));
                          }}
                        >
                          <RotateCcw size={16} aria-hidden="true" />
                          <span>Retry operation</span>
                        </button>
                        <button type="button" onClick={() => goToStep(3)}>
                          <Terminal size={16} aria-hidden="true" />
                          <span>Try manual script or edit version</span>
                        </button>
                        {node && (
                          <a
                            {...linkProps({ section: "nodes", id: node.id })}
                            className="btn"
                          >
                            <Pencil size={16} aria-hidden="true" />
                            <span>Edit node settings</span>
                          </a>
                        )}
                      </>
                    )}

                    {trackedTask.state === "succeeded" && (
                      <>
                        <div className="success-pill">
                          <CheckCircle2 size={17} aria-hidden="true" />
                          <span>Node verified and ready for users</span>
                        </div>
                        <a
                          {...linkProps({ section: "users" })}
                          className="btn primary"
                        >
                          <Users size={16} aria-hidden="true" />
                          <span>Assign to a user</span>
                          <ArrowRight size={16} aria-hidden="true" />
                        </a>
                        {node && (
                          <a
                            {...linkProps({ section: "nodes", id: node.id })}
                            className="btn"
                          >
                            <Radio size={16} aria-hidden="true" />
                            <span>Open node</span>
                          </a>
                        )}
                        <a
                          {...linkProps({ section: "onboard" })}
                          className="btn"
                        >
                          <ShieldCheck size={16} aria-hidden="true" />
                          <span>Onboard another VPS</span>
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
