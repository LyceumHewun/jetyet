import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  compact = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && root.current) {
      const r = root.current.getBoundingClientRect();
      setDropUp(window.innerHeight - r.bottom < 220 && r.top > 220);
    }
    setOpen((o) => !o);
  };

  return (
    <div
      ref={root}
      className={[
        "ui-select",
        open ? "open" : "",
        dropUp ? "drop-up" : "",
        compact ? "compact" : "",
        disabled ? "disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="ui-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className={current ? "" : "muted"}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={14} className="ui-select-chevron" />
      </button>
      {open && (
        <div className="ui-select-menu" role="listbox">
          {options.length ? (
            options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={"ui-select-option" + (active ? " active" : "")}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {active && <Check size={13} />}
                </button>
              );
            })
          ) : (
            <div className="ui-select-empty">No options</div>
          )}
        </div>
      )}
    </div>
  );
}
