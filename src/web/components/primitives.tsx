import { Check, Eye, EyeOff, Search, X } from "lucide-react";
import {
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export type ButtonVariant =
  | "default"
  | "primary"
  | "subtle"
  | "text"
  | "icon"
  | "danger"
  | "danger-text";

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
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
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
  return (
    <textarea
      className={["ui-textarea", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
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
  return (
    <label className="search">
      <Search size={15} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="ui-clear-btn"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={13} />
        </button>
      )}
    </label>
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
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
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
  onLabel = "Enabled",
  offLabel = "Disabled",
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
  emptyText = "None available.",
}: {
  options: { id: string; label: string }[];
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
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
