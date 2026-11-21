import { Check, ChevronDown, Languages } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type AppLocale = "en" | "zh-Hans";

export type LanguageControlProps = {
  locale: AppLocale;
  onChange: (locale: AppLocale) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  compact?: boolean;
};

const LOCALE_OPTIONS: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
];

/**
 * Compact custom language switcher without native `<select>` for toolbars and auth views.
 */
export function LanguageControl({
  locale,
  onChange,
  label,
  className = "",
  disabled = false,
  compact = false,
}: LanguageControlProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(
      0,
      LOCALE_OPTIONS.findIndex((opt) => opt.value === locale),
    ),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const valueId = useId();
  const menuId = useId();

  const current =
    LOCALE_OPTIONS.find((opt) => opt.value === locale) ?? LOCALE_OPTIONS[0];

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  const openMenu = (targetIdx?: number) => {
    if (disabled) return;
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 120 && rect.top > 120);
      setAlignEnd(rect.left + 156 > window.innerWidth - 12);
    }
    const activeIdx = Math.max(
      0,
      LOCALE_OPTIONS.findIndex((opt) => opt.value === locale),
    );
    setFocusIndex(targetIdx ?? activeIdx);
    setOpen(true);
  };

  const selectOption = (nextLocale: AppLocale) => {
    onChange(nextLocale);
    closeMenu(true);
  };

  const onControlKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        const activeIdx = Math.max(
          0,
          LOCALE_OPTIONS.findIndex((opt) => opt.value === locale),
        );
        const nextIdx =
          e.key === "ArrowDown"
            ? (activeIdx + 1) % LOCALE_OPTIONS.length
            : (activeIdx - 1 + LOCALE_OPTIONS.length) % LOCALE_OPTIONS.length;
        openMenu(nextIdx);
      } else {
        optionRefs.current[focusIndex]?.focus();
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setFocusIndex(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setFocusIndex(LOCALE_OPTIONS.length - 1);
    }
  };

  const onOptionKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((idx + 1) % LOCALE_OPTIONS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((idx - 1 + LOCALE_OPTIONS.length) % LOCALE_OPTIONS.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIndex(LOCALE_OPTIONS.length - 1);
    }
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={onControlKeyDown}
      className={[
        "ui-lang",
        open ? "open" : "",
        dropUp ? "drop-up" : "",
        alignEnd ? "align-end" : "",
        compact ? "compact" : "",
        disabled ? "disabled" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span id={labelId} className="visually-hidden">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="ui-lang-trigger"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        title={label}
        onClick={() => {
          if (open) {
            closeMenu(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <Languages size={14} className="ui-lang-icon" aria-hidden="true" />
        <span id={valueId} className="ui-lang-value" lang={locale}>
          {current.label}
        </span>
        <ChevronDown
          size={13}
          className="ui-lang-chevron"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="listbox"
          aria-label={label}
          className="ui-lang-menu"
        >
          {LOCALE_OPTIONS.map((opt, idx) => {
            const active = opt.value === locale;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                type="button"
                role="option"
                lang={opt.value}
                aria-selected={active}
                tabIndex={idx === focusIndex ? 0 : -1}
                className={"ui-lang-option" + (active ? " active" : "")}
                onClick={() => selectOption(opt.value)}
                onKeyDown={(e) => onOptionKeyDown(e, idx)}
              >
                <span>{opt.label}</span>
                {active && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
