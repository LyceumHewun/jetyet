import { Check, Copy, MoreHorizontal, Network, X } from "lucide-react";
import { useEffect, useState, useId, useRef, type ReactNode } from "react";
import { amount, fmt } from "./client";
import type { Row } from "./types";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={"badge " + tone}>
      <i />
      {children}
    </span>
  );
}

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

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function QuotaBar({ row }: { row: Row }) {
  const used = amount(row),
    limit = row.quota.limit;
  return (
    <div className="quota">
      <span>
        {fmt(used)} <small>/ {limit === null ? "Unlimited" : fmt(limit)}</small>
      </span>
      <div className="quota-track">
        <i
          className={row.exhausted ? "exhausted" : ""}
          style={{
            width:
              limit === null
                ? "0%"
                : `${Math.min(100, limit === 0 ? 100 : (used / limit) * 100)}%`,
          }}
        />
      </div>
      {row.usageStale && <small>Stale observations</small>}
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
    <div className="table-scroll">
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
    </div>
  );
}

export function Actions({ items }: { items: [string, () => void][] }) {
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  return (
    <>
      <button
        className="icon-button"
        aria-label="Actions"
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
      <div popover="auto" id={id} className="action-popover" style={position}>
        {items.map(([name, fn]) => (
          <button
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
      </div>
    </>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = focusables(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <section
      ref={root}
      className={"dialog " + (wide ? "wide" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </section>
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
    [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-body">
        {children}
        {error && <p className="form-error">{error}</p>}
      </div>
      <div className="dialog-footer">
        <button onClick={onClose}>Cancel</button>
        <button
          className={danger ? "danger-button" : "primary"}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((e) => {
              setError(e.message);
              setBusy(false);
            });
          }}
        >
          {busy ? "Working…" : action}
        </button>
      </div>
    </Dialog>
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
    <Dialog title={title} onClose={onClose} wide>
      <div className="dialog-body">
        <p className="muted">
          Contains sensitive information. Share only with the intended
          recipient.
        </p>
        <pre className="code-output">{text}</pre>
      </div>
      <div className="dialog-footer">
        <button
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => setCopied(true))
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}Copy
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
