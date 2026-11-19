import {
  AlertCircle,
  AlertTriangle,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { api } from "../client";
import { Badge, CopyButton, Field } from "../components";
import type { Row } from "../types";

export function NodeDeployPanel({
  node,
  operationsWorkerOnline,
  runAction,
  onTaskQueued,
}: {
  node: Row;
  operationsWorkerOnline: boolean;
  runAction: (fn: () => Promise<any>, message?: string) => Promise<any>;
  onTaskQueued: (taskId: string) => void;
}) {
  const uid = useId();
  const [mode, setMode] = useState<"ssh" | "manual">("ssh");
  const [version, setVersion] = useState(node.version || "v2.6.5");
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setVersion(node.version || "v2.6.5");
    setScript("");
    setError("");
  }, [node.id, node.version]);

  const queueOp = async (
    kind: "deploy" | "upgrade" | "reapply" | "detect",
    withVersion: boolean,
  ) => {
    setBusy(true);
    setError("");
    try {
      const res = await runAction(
        () =>
          api(`nodes/${node.id}/operation`, "POST", {
            kind,
            ...(withVersion ? { version } : {}),
          }),
        kind === "detect" ? "Detection queued" : `${kind} queued`,
      );
      if (res?.id) onTaskQueued(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const generateScript = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api(`nodes/${node.id}/command`, "POST", { version });
      setScript(res.script || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script");
    } finally {
      setBusy(false);
    }
  };

  const isDeployed = node.status === "ready";

  return (
    <div className="surface-card deploy-panel">
      <div className="card-head-row">
        <div>
          <h3>{isDeployed ? "Node lifecycle & operations" : "Deploy Hysteria 2"}</h3>
          <p className="muted-copy">
            Choose platform-managed SSH deployment or run the standard root
            script manually and detect it.
          </p>
        </div>
        <Badge tone={isDeployed ? "good" : "neutral"}>
          {isDeployed ? "Deployed" : "Planned"}
        </Badge>
      </div>

      <div className="segmented-tabs" role="tablist" aria-label="Deployment path">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ssh"}
          className={mode === "ssh" ? "seg-tab active" : "seg-tab"}
          onClick={() => setMode("ssh")}
        >
          <Play size={15} aria-hidden="true" />
          <span>Platform SSH deploy</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          className={mode === "manual" ? "seg-tab active" : "seg-tab"}
          onClick={() => setMode("manual")}
        >
          <Terminal size={15} aria-hidden="true" />
          <span>Manual command & detect</span>
        </button>
      </div>

      {!operationsWorkerOnline && (
        <p className="notice-banner warning">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Operations worker is offline. Queued tasks will remain pending until
            the operations worker runs.
          </span>
        </p>
      )}

      {mode === "ssh" ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!e.currentTarget.checkValidity()) {
              e.currentTarget.reportValidity();
              return;
            }
            void queueOp(isDeployed ? "upgrade" : "deploy", true);
          }}
        >
          <Field
            label="Target Hysteria 2 version"
            htmlFor={`${uid}-ssh-version`}
            hint="Use an exact release tag, e.g. v2.6.5."
            hintId={`${uid}-ssh-ver-hint`}
            errorText="Use a valid v2.x.y tag such as v2.6.5."
            errorId={`${uid}-ssh-ver-err`}
            required
          >
            <input
              id={`${uid}-ssh-version`}
              value={version}
              required
              pattern="v2\.\d+\.\d+"
              placeholder="v2.6.5"
              aria-describedby={`${uid}-ssh-ver-hint`}
              data-error={`${uid}-ssh-ver-err`}
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>

          <div className="inline-actions">
            <button type="submit" className="primary" disabled={busy || node.deleting}>
              <Play size={17} aria-hidden="true" />
              <span>
                {busy
                  ? "Queueing…"
                  : isDeployed
                    ? "Queue upgrade"
                    : "Queue SSH deployment"}
              </span>
            </button>
            {isDeployed && (
              <button
                type="button"
                disabled={busy || node.deleting}
                onClick={() => {
                  if (!/^v2\.\d+\.\d+$/.test(version)) {
                    setError("Enter a valid Hysteria 2 release tag, e.g. v2.6.5.");
                    return;
                  }
                  void queueOp("reapply", true);
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>Reapply configuration</span>
              </button>
            )}
          </div>
          {isDeployed && node.drift && (
            <p className="notice-banner warning">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                Remote configuration differs from platform settings. Reapplying
                overwrites manual remote edits.
              </span>
            </p>
          )}
        </form>
      ) : (
        <div className="manual-deploy-flow">
          <form className="inline-form" onSubmit={(e) => void generateScript(e)}>
            <Field
              label="Target Hysteria 2 version"
              htmlFor={`${uid}-manual-version`}
              hint="Generates an idempotent root script bound to this node's credentials."
              hintId={`${uid}-manual-ver-hint`}
              errorText="Use a valid v2.x.y tag such as v2.6.5."
              errorId={`${uid}-manual-ver-err`}
              required
            >
              <input
                id={`${uid}-manual-version`}
                value={version}
                required
                pattern="v2\.\d+\.\d+"
                placeholder="v2.6.5"
                aria-describedby={`${uid}-manual-ver-hint`}
                data-error={`${uid}-manual-ver-err`}
                onChange={(e) => setVersion(e.target.value)}
              />
            </Field>
            <div className="inline-actions">
              <button type="submit" disabled={busy || node.deleting}>
                <Terminal size={17} aria-hidden="true" />
                <span>
                  {busy ? "Generating…" : "Generate deploy script"}
                </span>
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || node.deleting}
                onClick={() => void queueOp("detect", false)}
              >
                <Search size={17} aria-hidden="true" />
                <span>Run installation detection</span>
              </button>
            </div>
          </form>

          {script && (
            <div className="terminal-card">
              <div className="terminal-head">
                <div className="terminal-dots" aria-hidden="true">
                  <i className="dot-r" />
                  <i className="dot-y" />
                  <i className="dot-g" />
                </div>
                <span className="terminal-title mono">
                  Run on {node.address} as root
                </span>
                <CopyButton text={script} label="Copy script" variant="compact" />
              </div>
              <p className="terminal-warning">
                <ShieldAlert size={16} aria-hidden="true" />
                <span>
                  Contains node API secrets. Execute only on the target VPS,
                  then run installation detection above.
                </span>
              </p>
              <pre className="terminal-body">{script}</pre>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
