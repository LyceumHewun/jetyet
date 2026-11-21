import { lockDocumentScroll, ScrollArea } from "./Scrollbars";
import {
  asUiError,
  type UiError,
  localizeError,
  t as translate,
} from "../i18n";
import {
  ArrowLeft,
  Check,
  Copy,
  MoreHorizontal,
  Network,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Network size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Table({
  headings,
  children,
}: {
  headings: string[];
  children: ReactNode;
}) {
  return (
    <ScrollArea className="table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollArea>
  );
}

export function Actions({ items }: { items: [string, () => void][] }) {
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={translate("Actions")}
        popoverTarget={id}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              10,
              Math.min(window.innerWidth - 210, r.right - 200),
            ),
            top: Math.max(10, Math.min(window.innerHeight - 340, r.bottom + 5)),
          });
        }}
      >
        <MoreHorizontal size={19} />
      </button>
      <ScrollArea
        axis="y"
        popover="auto"
        id={id}
        className="action-popover"
        style={position}
      >
        {items.map(([name, fn]) => (
          <button
            type="button"
            key={name}
            onClick={(e) => {
              (
                e.currentTarget.closest("[popover]") as HTMLElement
              ).hidePopover();
              fn();
            }}
          >
            {name}
          </button>
        ))}
      </ScrollArea>
    </>
  );
}

export function Stage({
  title,
  tag,
  subtitle,
  actions,
  children,
  onClose,
  narrow = false,
}: {
  title: string;
  tag?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  narrow?: boolean;
}) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector(
          ".modal-backdrop, .ui-select.open, .ui-datetime.open",
        )
      )
        onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section className={"stage" + (narrow ? " narrow" : "")}>
      <div className="stage-header">
        <div className="stage-header-left">
          <button
            type="button"
            className="stage-back"
            onClick={onClose}
            aria-label={translate("Back")}
          >
            <ArrowLeft size={15} />
            <span>{translate("Back")}</span>
          </button>
          <div className="stage-heading">
            <div className="stage-title-row">
              {tag && <span className="chip">{tag}</span>}
              <h1>{title}</h1>
            </div>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="stage-actions">{actions}</div>}
      </div>
      <div className="stage-body">{children}</div>
    </section>
  );
}

export function Modal({
  title,
  tag,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  tag?: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(lockDocumentScroll, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector(".ui-select.open, .ui-datetime.open")
      )
        onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={"modal-box" + (wide ? " wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="stage-title-row">
              {tag && (
                <span
                  className={
                    "chip" + (tag === translate("Danger") ? " danger-chip" : "")
                  }
                >
                  {tag}
                </span>
              )}
              <h2>{title}</h2>
            </div>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={translate("Close")}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Confirm({
  title,
  children,
  onClose,
  onConfirm,
  action,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  action: string;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<UiError>("");
  return (
    <Modal
      title={title}
      tag={danger ? translate("Danger") : translate("Confirm")}
      onClose={onClose}
    >
      <ScrollArea axis="y" className="modal-body">
        {children}
        {error && <p className="form-error">{localizeError(error)}</p>}
      </ScrollArea>
      <div className="modal-foot">
        <button type="button" onClick={onClose}>
          {translate("Cancel")}
        </button>
        <button
          type="button"
          className={danger ? "danger-button" : "primary"}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((e) => {
              setError(asUiError(e));
              setBusy(false);
            });
          }}
        >
          {busy ? translate("Working…") : action}
        </button>
      </div>
    </Modal>
  );
}

export function Code({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title={title}
      tag={translate("Inspector")}
      subtitle={translate(
        "Contains sensitive information. Share only with the intended recipient.",
      )}
      onClose={onClose}
      wide
    >
      <ScrollArea axis="y" className="modal-body">
        <ScrollArea className="code-output">
          <pre>{text}</pre>
        </ScrollArea>
      </ScrollArea>
      <div className="modal-foot">
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => setCopied(true))
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? translate("Copied") : translate("Copy")}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          {translate("Done")}
        </button>
      </div>
    </Modal>
  );
}
