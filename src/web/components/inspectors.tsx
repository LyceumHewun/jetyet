import { ScrollArea } from "./Scrollbars";
import { t as translate } from "../i18n";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { copyToClipboard, when } from "../client";
import type { Row } from "../types";
import { Badge, Button, Chip, CopyButton, SearchInput } from "./primitives";
import { Modal } from "./workspace";

export type LinkItem = {
  id: string;
  label: string;
  url: string;
  isDefault?: boolean;
};

export function SubscriptionLinksModal({
  userName,
  items,
  onClose,
}: {
  userName: string;
  items: LinkItem[];
  onClose: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const copy = (id: string, text: string) => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    });
  };

  const defaultItem = items.find((i) => i.isDefault);
  const templateItems = items.filter((i) => !i.isDefault);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? templateItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q) || i.url.toLowerCase().includes(q),
      )
    : templateItems;
  const allText = items.map((i) => `${i.label}\n${i.url}`).join("\n\n");

  return (
    <Modal
      title={userName}
      tag={translate("Subscription Links")}
      subtitle={translate(
        "Personal subscription URLs. Keep private and share only with this user.",
      )}
      onClose={onClose}
      wide
    >
      <ScrollArea axis="y" className="modal-body">
        {defaultItem && (
          <div className="link-card default">
            <div className="link-card-head">
              <div className="chip-group">
                <Link2 size={14} className="muted" />
                <strong>{defaultItem.label}</strong>
                <Badge tone="good">{translate("Default")}</Badge>
              </div>
              <div className="link-card-actions">
                <Button
                  variant={copiedId === defaultItem.id ? "primary" : "subtle"}
                  className="link-action-btn"
                  onClick={() => copy(defaultItem.id, defaultItem.url)}
                >
                  {copiedId === defaultItem.id ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  {copiedId === defaultItem.id
                    ? translate("Copied")
                    : translate("Copy")}
                </Button>
                <a
                  href={defaultItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="icon-button link-open-btn"
                  title={translate("Open URL")}
                  aria-label={translate("Open default subscription")}
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
            <ScrollArea axis="x" className="link-url mono">
              {defaultItem.url}
            </ScrollArea>
          </div>
        )}

        {templateItems.length > 0 && (
          <div className="link-templates-block">
            <div className="link-templates-bar">
              <div className="chip-group">
                <span className="kpi-label">{translate("TEMPLATES")}</span>
                <Chip mono>
                  {q
                    ? `${filtered.length}/${templateItems.length}`
                    : templateItems.length}
                </Chip>
              </div>
              {templateItems.length > 3 && (
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder={translate(
                    "Filter {0} templates…",
                    templateItems.length,
                  )}
                />
              )}
            </div>
            <ScrollArea axis="y" className="link-compact-list">
              {filtered.length ? (
                filtered.map((item) => {
                  const done = copiedId === item.id;
                  return (
                    <div key={item.id} className="link-row">
                      <strong className="link-row-name" title={item.label}>
                        {item.label}
                      </strong>
                      <span className="link-row-url mono" title={item.url}>
                        {item.url}
                      </span>
                      <div className="link-card-actions">
                        <Button
                          variant={done ? "primary" : "subtle"}
                          className="link-action-btn"
                          onClick={() => copy(item.id, item.url)}
                        >
                          {done ? <Check size={13} /> : <Copy size={13} />}
                          {done ? translate("Copied") : translate("Copy")}
                        </Button>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-button link-open-btn"
                          title={translate("Open URL")}
                          aria-label={translate("Open {0}", item.label)}
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="diff-empty muted">
                  {translate("No templates matching “{0}”.", query)}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </ScrollArea>
      <div className="modal-foot">
        <Button onClick={() => copy("__all__", allText)}>
          {copiedId === "__all__" ? <Check size={14} /> : <Copy size={14} />}
          {copiedId === "__all__"
            ? translate("Copied all")
            : translate("Copy all ({0})", items.length)}
        </Button>
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}

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
      <ScrollArea axis="y" className="modal-body">
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
      </ScrollArea>
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
      <ScrollArea axis="y" className="modal-body">
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
      </ScrollArea>
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
      title={userName}
      tag={translate("Portal Password Link")}
      subtitle={translate(
        "Single-use link for setting or replacing the subscriber's portal password.",
      )}
      onClose={onClose}
      wide
    >
      <ScrollArea axis="y" className="modal-body">
        <div className="link-card default">
          <div className="link-card-head">
            <div className="chip-group">
              <KeyRound size={14} className="muted" />
              <strong>{username ? `@${username}` : userName}</strong>
              <Badge tone="good">{translate("Single-use")}</Badge>
            </div>
            <CopyButton
              text={url}
              label={translate("Copy link")}
              copiedLabel={translate("Copied")}
              variant="primary"
              className="link-action-btn"
            />
          </div>
          <ScrollArea axis="x" className="link-url mono">
            {url}
          </ScrollArea>
        </div>
        <div className="chip-group">
          <Chip mono>
            {translate("Expires") + " "}
            {when(expires)}
          </Chip>
          <span className="muted">
            {translate(
              "Generating this link invalidated any prior unused link; existing password and sessions stay active until replaced.",
            )}
          </span>
        </div>
      </ScrollArea>
      <div className="modal-foot">
        <Button variant="primary" onClick={onClose}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}
