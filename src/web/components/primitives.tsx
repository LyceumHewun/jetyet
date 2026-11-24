import { ScrollTextArea } from "./Scrollbars";
import { t as translate } from "../i18n";
import { Check, Copy, Eye, EyeOff, Search, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { copyToClipboard } from "../client";

export type ButtonVariant =
  "default" | "primary" | "subtle" | "text" | "icon" | "danger" | "danger-text";

export function Button({
  variant = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  const map: Record<ButtonVariant, string> = {
    default: "",
    primary: "primary",
    subtle: "subtle-button",
    text: "text-button",
    icon: "icon-button",
    danger: "danger-button",
    "danger-text": "danger-text",
  };
  return (
    <button
      type={type}
      className={[map[variant], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function Input({
  className = "",
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  if (type === "password") {
    return (
      <div className="ui-input-wrap">
        <input
          type={visible ? "text" : "password"}
          className={["ui-input", className].filter(Boolean).join(" ")}
          {...props}
        />
        <button
          type="button"
          className="ui-input-action"
          disabled={props.disabled}
          aria-label={
            visible ? translate("Hide password") : translate("Show password")
          }
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    );
  }
  return (
    <input
      type={type}
      className={["ui-input", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function TextArea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <ScrollTextArea className={className} {...props} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="search">
      <Search size={15} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        aria-label={placeholder ?? translate("Search")}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="ui-clear-btn"
          aria-label={translate("Clear search")}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  hintAbove = false,
  hintId,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  hintAbove?: boolean;
  hintId?: string;
}) {
  return (
    <div className="field">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="field-label">
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {hint && hintAbove && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
      {children}
      {hint && !hintAbove && (
        <small id={hintId} className="field-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

let lastCopyAnnouncement = "";

export function CopyButton({
  text,
  label = translate("Copy"),
  copiedLabel = translate("Copied"),
  ariaLabel,
  variant = "subtle",
  className = "",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  ariaLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [announcement, setAnnouncement] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    const nextStatus = ok ? "copied" : "failed";
    setStatus(nextStatus);
    let msg = ok ? copiedLabel : translate("Copy failed");
    if (msg === lastCopyAnnouncement) msg += "\u00A0";
    lastCopyAnnouncement = msg;
    setAnnouncement(msg);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setStatus("idle");
      setAnnouncement("");
    }, 2000);
  };

  return (
    <span className="copy-wrap">
      <Button
        variant={status === "copied" ? "primary" : variant}
        className={["copy-btn", className].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        onClick={() => void handleCopy()}
      >
        {status === "copied" ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
        <span>
          {status === "copied"
            ? copiedLabel
            : status === "failed"
              ? translate("Failed")
              : label}
        </span>
      </Button>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </span>
  );
}

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

export function Chip({
  children,
  mono = false,
  className = "",
}: {
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={["chip", mono ? "mono" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  fullWidth = false,
}: {
  value: T;
  options: readonly [T, string][];
  onChange: (value: T) => void;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={"segmented-control" + (fullWidth ? " full-width" : "")}
      role="tablist"
    >
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          className={value === v ? "selected" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SwitchPill({
  checked,
  onChange,
  onLabel = translate("Enabled"),
  offLabel = translate("Disabled"),
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={"toggle-pill" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <i />
      {checked ? onLabel : offLabel}
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={"ui-checkbox" + (checked ? " checked" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-checkbox-box">
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span className="ui-checkbox-label">{children}</span>
    </button>
  );
}

export function ChipPicker({
  options,
  selected,
  onToggle,
  emptyText = translate("None available."),
}: {
  options: { id: string; label: string; tag?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyText?: string;
}) {
  if (!options.length) return <small className="muted">{emptyText}</small>;
  return (
    <div className="chip-picker">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            className={"pick-chip" + (active ? " selected" : "")}
            onClick={() => onToggle(opt.id)}
          >
            {active && <Check size={13} />}
            <span>{opt.label}</span>
            {opt.tag && <span className="pick-chip-tag mono">{opt.tag}</span>}
          </button>
        );
      })}
    </div>
  );
}
