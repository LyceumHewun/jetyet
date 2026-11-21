import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "../i18n";

const choices = [
  { locale: "en", label: "English" },
  { locale: "zh-Hans", label: "简体中文" },
] as const;

function Flag({ locale }: { locale: Locale }) {
  if (locale === "en") {
    return (
      <svg viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <path fill="#012169" d="M0 0h30v20H0z" />
        <path stroke="#fff" strokeWidth="4" d="m0 0 30 20m0-20L0 20" />
        <path
          fill="#c8102e"
          d="M0 0v1.5l15 10V10Zm30 0h-2.2L15 8.5V10ZM0 20h2.2L15 11.5V10Zm30 0v-1.5l-15-10V10Z"
        />
        <path stroke="#fff" strokeWidth="7" d="M15 0v20M0 10h30" />
        <path stroke="#c8102e" strokeWidth="4" d="M15 0v20M0 10h30" />
      </svg>
    );
  }

  const star =
    "M0-1 0.224-.309.951-.309.363.118.588.809 0 .382-.588.809-.363.118-.951-.309-.224-.309Z";
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <path fill="#de2910" d="M0 0h30v20H0z" />
      <g fill="#ffde00">
        <path d={star} transform="translate(5 5) scale(3)" />
        <path d={star} transform="translate(10 2) rotate(-121)" />
        <path d={star} transform="translate(12 4) rotate(-98)" />
        <path d={star} transform="translate(12 7) rotate(-74)" />
        <path d={star} transform="translate(10 9) rotate(-51)" />
      </g>
    </svg>
  );
}

export function LanguageControl({
  locale,
  onChange,
  label,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionsId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const currentName = locale === "en" ? choices[0].label : choices[1].label;
  return (
    <div
      className="language-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusTrigger();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="language-trigger"
        aria-label={`${label} · ${currentName}`}
        aria-expanded={open}
        aria-controls={optionsId}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <Flag locale={locale} />
      </button>
      <div
        className="language-options"
        id={optionsId}
        role="group"
        aria-label={label}
        hidden={!open}
      >
        {choices.map(({ locale: choice, label: name }) => (
          <button
            key={choice}
            type="button"
            lang={choice}
            aria-pressed={locale === choice}
            onClick={() => {
              onChange(choice);
              closeAndFocusTrigger();
            }}
          >
            <Flag locale={choice} />
            <span>{name}</span>
            {locale === choice && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
