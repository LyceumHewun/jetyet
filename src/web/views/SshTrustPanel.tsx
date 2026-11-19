import {
  AlertCircle,
  ArrowRight,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "../client";
import { Badge, CopyButton } from "../components";
import type { Row } from "../types";

export function SshTrustPanel({
  host,
  runAction,
  onTrusted,
  onEditConnection,
  onContinue,
  continueLabel = "Continue to node setup",
}: {
  host: Row;
  runAction: (fn: () => Promise<any>, message?: string) => Promise<any>;
  onTrusted?: () => void;
  onEditConnection?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const uid = useId();
  const [scanning, setScanning] = useState(false);
  const [trusting, setTrusting] = useState(false);
  const [scannedKey, setScannedKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    setScannedKey("");
    setConfirmed(false);
    setScanError("");
  }, [host.id, host.address, host.port, host.fingerprint]);

  const runScan = () => {
    setScanning(true);
    setScanError("");
    setConfirmed(false);
    void api(`hosts/${host.id}/fingerprint`, "POST")
      .then((res) => {
        setScannedKey(res.fingerprint || "");
      })
      .catch((err) => {
        setScannedKey("");
        setScanError(
          err instanceof Error ? err.message : "Failed to inspect SSH host key",
        );
      })
      .finally(() => setScanning(false));
  };

  const submitTrust = () => {
    if (!scannedKey || !confirmed) return;
    setTrusting(true);
    setScanError("");
    void runAction(
      () => api(`hosts/${host.id}/trust`, "POST", { fingerprint: scannedKey }),
      "SSH fingerprint trusted",
    )
      .then(() => {
        setScannedKey("");
        setConfirmed(false);
        onTrusted?.();
      })
      .catch((err) => {
        setScanError(
          err instanceof Error
            ? err.message
            : "Failed to verify and store fingerprint",
        );
      })
      .finally(() => setTrusting(false));
  };

  return (
    <div className="surface-card ssh-trust-card">
      <div className="card-head-row">
        <div>
          <h3>SSH Host Identity</h3>
          <p className="muted-copy mono">
            {host.username}@{host.address}:{host.port}
          </p>
        </div>
        {host.fingerprint ? (
          <Badge tone="good" icon={<ShieldCheck size={14} />}>
            Trusted
          </Badge>
        ) : (
          <Badge tone="warning" icon={<ShieldAlert size={14} />}>
            Verification required
          </Badge>
        )}
      </div>

      {host.fingerprint && !scannedKey && (
        <div className="fingerprint-box">
          <div className="fingerprint-row">
            <code className="fingerprint-value">{host.fingerprint}</code>
            <CopyButton
              text={host.fingerprint}
              label="Copy"
              variant="compact"
            />
          </div>
          <p className="muted-copy">
            Remote execution and monitoring verify this SHA-256 host key on
            every SSH connection.
          </p>
          <div className="inline-actions">
            <button
              type="button"
              className="compact-button"
              disabled={scanning}
              onClick={runScan}
            >
              <RefreshCw
                size={15}
                className={scanning ? "spin-active" : ""}
                aria-hidden="true"
              />
              <span>{scanning ? "Scanning…" : "Re-scan host key"}</span>
            </button>
            {onContinue && (
              <button
                type="button"
                className="primary"
                onClick={onContinue}
              >
                <span>{continueLabel}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {!host.fingerprint && !scannedKey && (
        <div className="fingerprint-prompt">
          <p className="body-copy">
            Jetyet never auto-trusts SSH keys. Fetch the server's public key
            fingerprint, compare it against your provider console or a known
            session, then confirm explicitly.
          </p>
          {!scanError && (
            <div className="inline-actions">
              <button
                type="button"
                className="primary"
                disabled={scanning}
                onClick={runScan}
              >
                <RefreshCw
                  size={17}
                  className={scanning ? "spin-active" : ""}
                  aria-hidden="true"
                />
                <span>
                  {scanning ? "Scanning SSH key…" : "Scan SSH host key"}
                </span>
              </button>
              {onEditConnection && (
                <button type="button" onClick={onEditConnection}>
                  <Pencil size={16} aria-hidden="true" />
                  <span>Edit SSH connection</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {scanError && (
        <div className="error-panel" role="alert">
          <div className="error-panel-row">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{scanError}</span>
          </div>
          <p className="muted-copy">
            Check that the IP/hostname, SSH port, and firewall allow incoming
            TCP connections from this server.
          </p>
          <div className="inline-actions">
            <button
              type="button"
              className="compact-button"
              disabled={scanning}
              onClick={runScan}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Retry scan</span>
            </button>
            {onEditConnection && (
              <button
                type="button"
                className="compact-button"
                onClick={onEditConnection}
              >
                <Pencil size={15} aria-hidden="true" />
                <span>Edit SSH connection</span>
              </button>
            )}
          </div>
        </div>
      )}

      {scannedKey && (
        <div className="fingerprint-review">
          <p className="eyebrow">PENDING VERIFICATION</p>
          <p className="body-copy">
            Match this SHA-256 fingerprint before enabling remote access:
          </p>
          <div className="fingerprint-row">
            <code className="fingerprint-value">{scannedKey}</code>
            <CopyButton text={scannedKey} label="Copy" variant="compact" />
          </div>

          <label htmlFor={`${uid}-confirm`} className="check-card">
            <input
              id={`${uid}-confirm`}
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              <strong>
                I verified this SHA-256 fingerprint against my provider console
                or a trusted SSH session.
              </strong>
              <small>Required before Jetyet trusts this host.</small>
            </span>
          </label>

          <div className="inline-actions">
            <button
              type="button"
              className="primary"
              disabled={!confirmed || trusting}
              onClick={submitTrust}
            >
              <ShieldCheck size={17} aria-hidden="true" />
              <span>{trusting ? "Trusting…" : "Trust fingerprint"}</span>
            </button>
            <button
              type="button"
              disabled={scanning || trusting}
              onClick={runScan}
            >
              Re-scan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
