import { ScrollArea } from "./Scrollbars";
import { t as translate } from "../i18n";
import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import { when } from "../client";
import type { Row } from "../types";
import { Badge, Button, Chip, CopyButton } from "./primitives";
import { Modal, ModalBody } from "./workspace";

export function DriftModal({
  nodeName,
  desired,
  observed,
  onReapply,
  onClose,
}: {
  nodeName: string;
  desired: string;
  observed: string | null;
  onReapply?: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const desiredLines = desired.split("\n");
  const observedLines = (observed || "").split("\n");
  const maxLen = Math.max(desiredLines.length, observedLines.length);
  const diffCount = observed
    ? Array.from({ length: maxLen }).filter(
        (_, i) => (desiredLines[i] ?? "") !== (observedLines[i] ?? ""),
      ).length
    : 0;

  return (
    <Modal
      title={nodeName}
      tag={translate("Config Drift")}
      subtitle={
        !observed
          ? translate("No remote observation captured yet.")
          : diffCount === 0
            ? translate("Remote configuration matches platform state.")
            : translate(
                "{0} differing lines between platform and remote. Credentials are redacted.",
                diffCount,
              )
      }
      onClose={onClose}
      wide
    >
      <ModalBody>
        <div className="diff-grid">
          <div className="diff-pane">
            <div className="diff-pane-head">
              <Chip className="accent-chip">
                {translate("Platform · Desired")}
              </Chip>
            </div>
            <ScrollArea axis="x" className="diff-lines mono">
              {desiredLines.map((line, i) => {
                const changed = !!observed && (observedLines[i] ?? "") !== line;
                return (
                  <div
                    key={i}
                    className={"diff-line" + (changed ? " changed-good" : "")}
                  >
                    <span className="diff-ln">{i + 1}</span>
                    <span>{line || " "}</span>
                  </div>
                );
              })}
            </ScrollArea>
          </div>
          <div className="diff-pane">
            <div className="diff-pane-head">
              <Chip>
                {observed
                  ? translate("Remote · Observed")
                  : translate("Remote · None")}
              </Chip>
            </div>
            {observed ? (
              <ScrollArea axis="x" className="diff-lines mono">
                {observedLines.map((line, i) => {
                  const changed = (desiredLines[i] ?? "") !== line;
                  return (
                    <div
                      key={i}
                      className={"diff-line" + (changed ? " changed-warn" : "")}
                    >
                      <span className="diff-ln">{i + 1}</span>
                      <span>{line || " "}</span>
                    </div>
                  );
                })}
              </ScrollArea>
            ) : (
              <div className="diff-empty muted">
                {translate("No remote observation yet.")}
              </div>
            )}
          </div>
        </div>
      </ModalBody>
      <div className="modal-foot">
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(
                `PLATFORM\n${desired}\n\nOBSERVED\n${observed || "None"}`,
              )
              .then(() => setCopied(true))
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? translate("Copied") : translate("Copy diff")}
        </Button>
        {onReapply && diffCount > 0 && (
          <Button variant="primary" onClick={onReapply}>
            {translate("Reapply config")}
          </Button>
        )}
        <Button
          variant={onReapply && diffCount > 0 ? "default" : "primary"}
          onClick={onClose}
        >
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}

export function LogsModal({
  title,
  logs,
  onClose,
}: {
  title: string;
  logs: Row[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const raw =
    logs.map((l) => `${when(l.at)}  ${l.message}`).join("\n") ||
    translate("No detailed log recorded.");
  return (
    <Modal
      title={title}
      tag={translate("Execution Log")}
      onClose={onClose}
      wide
    >
      <ModalBody>
        {logs.length ? (
          <div className="log-timeline mono">
            {logs.map((l, idx) => (
              <div className="log-entry" key={idx}>
                <span className="log-idx">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="log-ts">{when(l.at)}</span>
                <span className="log-msg">{l.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="diff-empty muted">
            <Terminal size={18} />
            <span>{translate("No detailed log recorded.")}</span>
          </div>
        )}
      </ModalBody>
      <div className="modal-foot">
        <Button
          onClick={() =>
            void navigator.clipboard.writeText(raw).then(() => setCopied(true))
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? translate("Copied") : translate("Copy log")}
        </Button>
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}

export function DeployCommandModal({
  nodeName,
  command,
  expiresAt,
  congestion,
  tuning,
  tlsSecurity,
  sni,
  ech,
  echPublicName,
  onDetect,
  onClose,
}: {
  nodeName: string;
  command: string;
  expiresAt: string;
  congestion: "brutal" | "bbr";
  tuning: boolean;
  tlsSecurity: "legacy" | "pinned";
  sni: string;
  ech: boolean;
  echPublicName: string;
  onDetect: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={nodeName}
      tag={translate("Deploy command")}
      subtitle={translate("Run this single-line command on the VPS as root.")}
      onClose={onClose}
      className="link-dialog deploy-command-dialog"
    >
      <ModalBody>
        <div className="deploy-command-box">
          <div className="deploy-command-head">
            <div className="chip-group">
              <Chip>Hysteria 2</Chip>
              <Chip>{congestion === "bbr" ? "BBR" : "Brutal"}</Chip>
              {tlsSecurity === "pinned" ? (
                <Chip mono>{`pinSHA256 · ${sni}`}</Chip>
              ) : (
                <Badge tone="warning">{translate("Legacy TLS")}</Badge>
              )}
              {ech && (
                <Chip mono className="accent-chip">{`ECH · ${echPublicName}`}</Chip>
              )}
              <Chip>
                {tuning
                  ? translate("Adaptive tuning: On")
                  : translate("Adaptive tuning: Off")}
              </Chip>
            </div>
            <CopyButton
              text={command}
              label={translate("Copy command")}
              ariaLabel={translate("Copy deploy command")}
            />
          </div>
          <ScrollArea
            axis="x"
            className="deploy-command-scroll"
            role="region"
            aria-label={translate("Deploy command")}
            tabIndex={0}
          >
            <code className="deploy-command-line">{command}</code>
          </ScrollArea>
        </div>
        <div className="password-link-meta">
          <div className="chip-group">
            <Badge tone="warning">{translate("Valid for 15 minutes")}</Badge>
            {expiresAt && (
              <Chip mono>
                {translate("Expires") + " "}
                {when(expiresAt)}
              </Chip>
            )}
          </div>
          <p className="muted">
            {translate(
              "This command is bound to the selected options, expires in 15 minutes, and can be re-downloaded before expiry for retries. After running it on the VPS, select Detect installation to verify the deployment.",
            )}
          </p>
        </div>
      </ModalBody>
      <div className="modal-foot">
        <Button onClick={onDetect}>{translate("Detect installation")}</Button>
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}

export function PasswordLinkModal({
  userName,
  username,
  url,
  expires,
  onClose,
}: {
  userName: string;
  username?: string;
  url: string;
  expires: number;
  onClose: () => void;
}) {
  return (
    <Modal
      title={translate("Portal Password Link")}
      subtitle={translate(
        "Single-use link for setting or replacing the subscriber's portal password.",
      )}
      onClose={onClose}
      className="link-dialog"
    >
      <ModalBody>
        <div className="link-row is-featured">
          <div className="link-row-name chip-group">
            <strong>{userName}</strong>
            {username && <span className="muted">@{username}</span>}
            <Badge tone="good">{translate("Single-use")}</Badge>
          </div>
          <code className="link-row-url" title={url}>
            {url}
          </code>
          <div className="link-card-actions">
            <CopyButton text={url} label={translate("Copy link")} />
          </div>
        </div>
        <div className="password-link-meta">
          <Chip mono>
            {translate("Expires") + " "}
            {when(expires)}
          </Chip>
          <p className="muted">
            {translate(
              "Generating this link invalidated any prior unused link; existing password and sessions stay active until replaced.",
            )}
          </p>
        </div>
      </ModalBody>
      <div className="modal-foot">
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}
