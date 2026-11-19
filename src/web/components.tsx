import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Minus,
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
import {
  amount,
  copyText,
  directionMeta,
  fmt,
  supportsTopLayerExit,
} from "./client";
import type { Row } from "./types";

const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose() {
  return useContext(DialogCloseContext);
}

export function BrandMark({
  size = "md",
  showText = true,
}: {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}) {
  const iconSize = size === "sm" ? 18 : size === "lg" ? 26 : 20;
  return (
    <span className={`brand-lockup ${size}`}>
      <span className={`brand-mark ${size}`} aria-hidden="true">
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.5 14.5L11.2 4.5L13.4 10.6L19.5 9.5L12.8 19.5L10.6 13.4L4.5 14.5Z"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="18.5" cy="5.5" r="2" fill="currentColor" />
        </svg>
      </span>
      {showText && (
        <span className="brand-text">
          jetyet<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}

export function BrushWord({ children }: { children: ReactNode }) {
  return (
    <span className="brush-word">
      <span>{children}</span>
      <svg
        className="brush-stroke"
        viewBox="0 0 220 18"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M4 13.5C58 5.5 148 4.5 216 11.5"
          stroke="url(#jetyet-brush-grad)"
          strokeWidth="6.5"
          strokeLinecap="round"
          fill="none"
        />
        <defs>
          <linearGradient
            id="jetyet-brush-grad"
            x1="0"
            y1="0"
            x2="220"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#cdb0e8" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#b074d1" stopOpacity="0.72" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
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
        {icon ?? <AlertCircle size={26} strokeWidth={2} />}
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
  errorText,
  errorId,
  required,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  hintId?: string;
  errorText?: string;
  errorId?: string;
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
      {errorText && errorId && (
        <span id={errorId} className="field-error">
          <span role="img" aria-label="Error">
            !
          </span>{" "}
          {errorText}
        </span>
      )}
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

export function QuotaBar({
  row,
  compact = false,
}: {
  row: Row;
  compact?: boolean;
}) {
  const used = amount(row);
  const rawLimit = row.quota?.limit;
  const limit = rawLimit === undefined ? null : rawLimit;
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
    <div className={compact ? "quota compact" : "quota"}>
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

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "default",
  className = "",
  disabled = false,
  onCopied,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: "default" | "primary" | "compact";
  className?: string;
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const cls = [
    variant === "primary"
      ? "primary"
      : variant === "compact"
        ? "compact-button"
        : "",
    copied ? "is-copied" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="copy-wrap">
      <button
        type="button"
        className={cls}
        disabled={disabled || !text}
        onClick={() => {
          setCopyError("");
          void copyText(text)
            .then(() => {
              setCopied(true);
              onCopied?.();
            })
            .catch((e) =>
              setCopyError(
                e instanceof Error
                  ? e.message
                  : "Clipboard unavailable. Copy text manually.",
              ),
            );
        }}
      >
        {copied ? (
          <Check size={16} className="copy-pop" aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
        <span>{copied ? copiedLabel : label}</span>
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
      {copyError && (
        <span className="copy-error" role="alert">
          {copyError}
        </span>
      )}
    </span>
  );
}

export function ProgressRing({
  percent,
  tone = "accent",
  size = 56,
}: {
  percent: number;
  tone?: "accent" | "good" | "danger" | "neutral";
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={`progress-ring ${tone}`}
      style={{ width: size, height: size }}
      aria-label={`${clamped}% progress`}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="progress-ring-bg" cx="24" cy="24" r={radius} />
        <circle
          className="progress-ring-fill"
          cx="24"
          cy="24"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="progress-ring-text">{clamped}%</span>
    </div>
  );
}

export function SectionTabs({
  tabs,
  active,
  onChange,
  label = "Workspace views",
}: {
  tabs: Array<{ id: string; label: string; badge?: string | number }>;
  active: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="section-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "section-tab active" : "section-tab"}
            onClick={() => onChange(t.id)}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== "" && (
              <span className="section-tab-badge">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StackDrillDown({
  hasDetail,
  backLabel,
  detailTitle,
  onBack,
  listPane,
  detailPane,
  listAriaLabel = "Records",
}: {
  hasDetail: boolean;
  backLabel: string;
  detailTitle: string;
  onBack: () => void;
  listPane: ReactNode;
  detailPane: ReactNode;
  listAriaLabel?: string;
}) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 959px)").matches
      : false,
  );
  const [prevNav, setPrevNav] = useState({ hasDetail, isMobile });
  const [animDir, setAnimDir] = useState<"forward" | "back" | null>(null);
  const listContentRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const returnHrefRef = useRef<string | null>(null);
  const prevHasDetailRef = useRef(hasDetail);

  if (prevNav.hasDetail !== hasDetail || prevNav.isMobile !== isMobile) {
    const nextDir =
      isMobile && prevNav.isMobile && prevNav.hasDetail !== hasDetail
        ? hasDetail
          ? "forward"
          : "back"
        : null;
    setPrevNav({ hasDetail, isMobile });
    setAnimDir(nextDir);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 959px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const wasDetail = prevHasDetailRef.current;
    prevHasDetailRef.current = hasDetail;
    if (!isMobile || wasDetail === hasDetail) return;

    if (hasDetail) {
      window.scrollTo({ top: 0, behavior: "instant" });
      const frame = requestAnimationFrame(() => {
        backButtonRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }

    const frame = requestAnimationFrame(() => {
      const targetHref = returnHrefRef.current;
      returnHrefRef.current = null;
      const listEl = listContentRef.current;
      let focusTarget: HTMLElement | null = listEl;
      if (targetHref && listEl) {
        for (const anchor of listEl.querySelectorAll<HTMLAnchorElement>(
          "a[href]",
        )) {
          if (anchor.getAttribute("href") === targetHref) {
            focusTarget = anchor;
            break;
          }
        }
      }
      focusTarget?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hasDetail, isMobile]);

  if (!isMobile) {
    return (
      <div className="workspace-split">
        <section className="workspace-list-pane" aria-label={listAriaLabel}>
          {listPane}
        </section>
        <section className="workspace-detail-pane" aria-label={detailTitle}>
          {detailPane}
        </section>
      </div>
    );
  }

  const paneAnimClass =
    animDir === "forward"
      ? " drill-forward"
      : animDir === "back"
        ? " drill-back"
        : "";

  return (
    <div
      className="mobile-drill"
      onClick={(e) => {
        const trigger = (e.target as HTMLElement | null)?.closest(
          "a[href]",
        ) as HTMLAnchorElement | null;
        if (trigger && listContentRef.current?.contains(trigger)) {
          returnHrefRef.current = trigger.getAttribute("href");
        }
      }}
    >
      {hasDetail ? (
        <section
          key="detail"
          className={`drill-pane${paneAnimClass}`}
          aria-label={detailTitle}
        >
          <div className="stack-detail-bar">
            <button
              ref={backButtonRef}
              type="button"
              className="stack-back-btn"
              aria-label={`Back to ${backLabel}`}
              onClick={onBack}
            >
              <ArrowLeft size={18} aria-hidden="true" />
              <span>{backLabel}</span>
            </button>
            <span className="stack-detail-title">{detailTitle}</span>
          </div>
          <div className="stack-detail-body">{detailPane}</div>
        </section>
      ) : (
        <section
          key="list"
          ref={listContentRef}
          className={`drill-pane${paneAnimClass}`}
          tabIndex={-1}
          aria-label={listAriaLabel}
        >
          {listPane}
        </section>
      )}
    </div>
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
