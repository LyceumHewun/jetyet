import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Minus,
  MoreHorizontal,
  Network,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { amount, directionMeta, fmt, supportsTopLayerExit } from "./client";
import type { Row } from "./types";

const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose() {
  return useContext(DialogCloseContext);
}

const defaultBadgeIcons: Record<string, ReactNode> = {
  good: <CheckCircle2 size={14} aria-hidden="true" />,
  warning: <AlertTriangle size={14} aria-hidden="true" />,
  danger: <XCircle size={14} aria-hidden="true" />,
  accent: <ArrowUpRight size={14} aria-hidden="true" />,
  neutral: <Minus size={14} aria-hidden="true" />,
};

export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "accent";
  icon?: ReactNode;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-icon" aria-hidden="true">
        {icon ?? defaultBadgeIcons[tone] ?? defaultBadgeIcons.neutral}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function Empty({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon ?? <Network size={28} strokeWidth={2} />}
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  hintId,
  required,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  hintId?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <div className="label-row">
        <label htmlFor={htmlFor}>{label}</label>
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </div>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

export function SwitchField({
  id,
  label,
  detail,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="switch-field">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-copy">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
    </label>
  );
}

export function Stat({
  label,
  value,
  detail,
  icon,
  tone = "accent",
  onClick,
  index = 0,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: "accent" | "good" | "warning" | "danger" | "neutral";
  onClick?: () => void;
  index?: number;
}) {
  const style = { "--i": index } as CSSProperties;
  const content = (
    <>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-bottom">
        <small>{detail}</small>
        {onClick && (
          <ArrowUpRight size={16} className="stat-arrow" aria-hidden="true" />
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`stat stat-interactive ${tone}`}
        style={style}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`stat ${tone}`} style={style}>
      {content}
    </div>
  );
}

export function QuotaBar({ row }: { row: Row }) {
  const used = amount(row);
  const limit = row.quota?.limit ?? null;
  const ratio =
    limit === null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
  const dir = directionMeta(row.quota?.direction);
  const DirIcon =
    row.quota?.direction === "out"
      ? ArrowUp
      : row.quota?.direction === "in"
        ? ArrowDown
        : ArrowUpDown;
  const fillClass = row.exhausted
    ? "exhausted"
    : ratio >= 0.85 && limit !== null
      ? "near"
      : "";

  return (
    <div className="quota">
      <div className="quota-head">
        <span className="quota-amounts">
          <strong>{fmt(used)}</strong>
          <small> / {limit === null ? "Unlimited" : fmt(limit)}</small>
        </span>
        <span className="quota-dir">
          <DirIcon size={12} aria-hidden="true" />
          <span>{dir.short}</span>
          <span className="visually-hidden"> ({dir.label})</span>
        </span>
      </div>
      <div className={`quota-track ${limit === null ? "unlimited" : ""}`}>
        <span
          className={`quota-fill ${fillClass}`.trim()}
          style={{ "--ratio": String(ratio) } as CSSProperties}
        />
      </div>
      {row.usageStale && (
        <div className="quota-stale">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>Stale observations</span>
        </div>
      )}
    </div>
  );
}

export function Table({
  caption,
  headings,
  children,
}: {
  caption: string;
  headings: string[];
  children: ReactNode;
}) {
  const captionId = useId();
  const labelVars = Object.fromEntries(
    headings.map((h, i) => [`--label-${i + 1}`, JSON.stringify(h)]),
  ) as CSSProperties;

  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-labelledby={captionId}
    >
      <table role="table" style={labelVars}>
        <caption id={captionId} className="visually-hidden">
          {caption}
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            {headings.map((h) => (
              <th key={h} scope="col" role="columnheader">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
      </table>
    </div>
  );
}

export type ActionItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: ReactNode;
};

export function Actions({
  label = "Row actions",
  items,
}: {
  label?: string;
  items: ActionItem[];
}) {
  const id = useId();
  const [fallbackStyle, setFallbackStyle] = useState<CSSProperties | undefined>(
    undefined,
  );

  return (
    <>
      <button
        type="button"
        className="icon-button action-trigger"
        aria-label={label}
        popoverTarget={id}
        onClick={(e) => {
          if (
            typeof CSS !== "undefined" &&
            CSS.supports("position-area: block-end")
          ) {
            setFallbackStyle(undefined);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          const menuWidth = 236;
          const menuHeight = Math.min(360, items.length * 46 + 16);
          setFallbackStyle({
            position: "fixed",
            inset: "auto",
            margin: 0,
            left: Math.max(
              10,
              Math.min(window.innerWidth - menuWidth - 10, r.right - menuWidth),
            ),
            top: Math.max(
              10,
              Math.min(window.innerHeight - menuHeight - 10, r.bottom + 6),
            ),
          });
        }}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      <div
        popover="auto"
        id={id}
        className="action-popover"
        style={fallbackStyle}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.label}
            className={item.danger ? "action-item danger" : "action-item"}
            onClick={(e) => {
              const pop = e.currentTarget.closest(
                "[popover]",
              ) as HTMLElement | null;
              try {
                pop?.hidePopover();
              } catch {}
              item.onClick();
            }}
          >
            {item.icon && (
              <span className="action-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const finishAnimations = async (el: HTMLDialogElement) => {
    const animations = el.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 340)),
      ]);
    }
  };

  const requestClose = useCallback(() => {
    const el = dialogRef.current;
    if (!el || closingRef.current) return;
    closingRef.current = true;
    void (async () => {
      if (!el.open) {
        onCloseRef.current();
        return;
      }
      if (!supportsTopLayerExit()) {
        el.setAttribute("data-closing", "");
        await finishAnimations(el);
        if (!el.isConnected) return;
        el.removeAttribute("data-closing");
        if (el.open) el.close();
        onCloseRef.current();
      } else {
        el.close();
        await finishAnimations(el);
        if (!el.isConnected) return;
        onCloseRef.current();
      }
    })();
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) {
      el.showModal();
      const target = el.querySelector<HTMLElement>(
        "[autofocus], [data-autofocus='true']",
      );
      target?.focus();
    }

    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible || e.type === "cancel") {
        requestClose();
      }
    };

    const onNativeClose = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      void (async () => {
        await finishAnimations(el);
        if (el.isConnected) onCloseRef.current();
      })();
    };

    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", onNativeClose);

    let onPointerDown: ((e: PointerEvent) => void) | undefined;
    let onPointerUp: ((e: PointerEvent) => void) | undefined;
    if (dismissible && !("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) requestClose();
      };
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointerup", onPointerUp);
    }

    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", onNativeClose);
      if (onPointerDown) el.removeEventListener("pointerdown", onPointerDown);
      if (onPointerUp) el.removeEventListener("pointerup", onPointerUp);
    };
  }, [dismissible, requestClose]);

  return (
    <DialogCloseContext.Provider value={requestClose}>
      <dialog
        ref={dialogRef}
        className={wide ? "dialog wide" : "dialog"}
        aria-labelledby={titleId}
        {...({ closedby: dismissible ? "any" : "closerequest" } as any)}
      >
        <div className="dialog-heading">
          <div className="dialog-title-group">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="dialog-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={requestClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </dialog>
    </DialogCloseContext.Provider>
  );
}

export function DialogDismissButton({
  children = "Cancel",
  className = "",
  autoFocus = false,
}: {
  children?: ReactNode;
  className?: string;
  autoFocus?: boolean;
}) {
  const close = useDialogClose();
  return (
    <button
      type="button"
      className={className}
      autoFocus={autoFocus}
      data-autofocus={autoFocus ? "true" : undefined}
      onClick={() => close?.()}
    >
      {children}
    </button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog title={title} onClose={onClose} dismissible={!busy}>
      <div className="dialog-body">
        {children}
        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <DialogDismissButton autoFocus={danger}>Cancel</DialogDismissButton>
        <button
          type="button"
          className={danger ? "danger-button" : "primary"}
          autoFocus={!danger}
          data-autofocus={!danger ? "true" : undefined}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            onConfirm().catch((e) => {
              setError(e instanceof Error ? e.message : "Action failed");
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
  notice = "Sensitive output. Share only with the intended recipient.",
  text,
  onClose,
}: {
  title: string;
  notice?: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Dialog title={title} onClose={onClose} wide>
      <div className="dialog-body">
        <p className="notice-banner">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>{notice}</span>
        </p>
        <pre className="code-output">{text}</pre>
        {copyError && (
          <p className="form-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{copyError}</span>
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <button
          type="button"
          onClick={() => {
            setCopyError("");
            navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() =>
                setCopyError(
                  "Clipboard access unavailable. Select and copy the text manually.",
                ),
              );
          }}
        >
          {copied ? (
            <Check size={17} className="copy-pop" aria-hidden="true" />
          ) : (
            <Copy size={17} aria-hidden="true" />
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <DialogDismissButton className="primary" autoFocus>
          Done
        </DialogDismissButton>
      </div>
    </Dialog>
  );
}

export function ToastRegion({
  message,
  onDismiss,
  suppressed = false,
}: {
  message: string;
  onDismiss: () => void;
  suppressed?: boolean;
}) {
  const toastRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [liveText, setLiveText] = useState("");
  const visible = Boolean(message) && !suppressed;

  useEffect(() => {
    const el = toastRef.current;
    if (!el) return;
    if (visible) {
      try {
        if (!el.matches(":popover-open")) el.showPopover();
      } catch {}
    } else {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {}
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setLiveText("");
      return;
    }
    const doc = document as Document & { ariaNotify?: (text: string) => void };
    if (typeof doc.ariaNotify === "function") {
      doc.ariaNotify(message);
    } else {
      setLiveText(message);
    }
  }, [visible, message]);

  useEffect(() => {
    if (!visible || paused) return;
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [visible, paused, onDismiss, message]);

  return (
    <div role="region" aria-label="Notifications" className="toast-region">
      <div className="visually-hidden" aria-live="polite">
        {liveText}
      </div>
      <div
        ref={toastRef}
        className="toast"
        {...({ popover: "manual" } as any)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setPaused(false);
          }
        }}
      >
        <CheckCircle2 size={18} className="toast-icon" aria-hidden="true" />
        <span className="toast-text">{message}</span>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss notification"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
