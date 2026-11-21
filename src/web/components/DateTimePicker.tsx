import { formatDate, t as translate } from "../i18n";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";

const displayZone = "Asia/Hong_Kong";
const weekdays = Array.from({ length: 7 }, (_, day) =>
  Date.UTC(2024, 0, 7 + day),
);
const pad = (n: number) => String(n).padStart(2, "0");
const now = () => DateTime.now().setZone(displayZone);

function parseValue(value: string): DateTime | null {
  const date = DateTime.fromISO(value, { zone: "UTC" }).setZone(displayZone);
  return date.isValid ? date : null;
}

function formatIsoMinute(date: DateTime): string {
  return date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm");
}

function formatDisplay(date: DateTime): string {
  return formatDate(date.toMillis(), {
    timeZone: displayZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = translate("Select date & time (HKT)"),
  allowClear = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const parsed = parseValue(value);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [viewYear, setViewYear] = useState(() => (parsed ?? now()).year);
  const [viewMonth, setViewMonth] = useState(() => (parsed ?? now()).month - 1);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = parseValue(value) ?? now();
    setViewYear(base.year);
    setViewMonth(base.month - 1);
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
  }, [open, value]);

  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(
    Date.UTC(viewYear, viewMonth + 1, 0),
  ).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const updateDate = (year: number, month: number, day: number) => {
    const base = parsed ?? now();
    onChange(formatIsoMinute(base.set({ year, month: month + 1, day })));
  };

  const updateTime = (hours: number, minutes: number) => {
    const base = parsed ?? now();
    const hour = Math.max(
      0,
      Math.min(23, Number.isFinite(hours) ? Math.trunc(hours) : 0),
    );
    const minute = Math.max(
      0,
      Math.min(59, Number.isFinite(minutes) ? Math.trunc(minutes) : 0),
    );
    onChange(formatIsoMinute(base.set({ hour, minute })));
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };

  const toggleOpen = () => {
    if (!open && root.current) {
      const r = root.current.getBoundingClientRect();
      setDropUp(window.innerHeight - r.bottom < 310 && r.top > 310);
    }
    setOpen((o) => !o);
  };

  return (
    <div
      ref={root}
      className={
        "ui-datetime" + (open ? " open" : "") + (dropUp ? " drop-up" : "")
      }
    >
      <div className="ui-datetime-trigger-wrap">
        <button
          type="button"
          className="ui-datetime-trigger"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <Calendar size={14} className="muted" />
          <span className={parsed ? "mono" : "muted"}>
            {parsed ? formatDisplay(parsed) : placeholder}
          </span>
        </button>
        {allowClear && parsed && (
          <button
            type="button"
            className="ui-clear-btn"
            aria-label={translate("Clear date")}
            onClick={() => onChange("")}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="ui-datetime-popover">
          <div className="ui-cal-head">
            <button
              type="button"
              className="icon-button"
              aria-label={translate("Previous month")}
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={15} />
            </button>
            <strong className="mono">
              {formatDate(Date.UTC(viewYear, viewMonth, 1), {
                timeZone: "UTC",
                month: "short",
                year: "numeric",
              })}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label={translate("Next month")}
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="ui-cal-weekdays">
            {weekdays.map((day) => (
              <span key={day}>
                {formatDate(day, { timeZone: "UTC", weekday: "short" })}
              </span>
            ))}
          </div>
          <div className="ui-cal-days">
            {cells.map((day, idx) =>
              day === null ? (
                <span key={`empty-${idx}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  className={
                    "ui-cal-day" +
                    (parsed &&
                    parsed.year === viewYear &&
                    parsed.month === viewMonth + 1 &&
                    parsed.day === day
                      ? " selected"
                      : "")
                  }
                  onClick={() => updateDate(viewYear, viewMonth, day)}
                >
                  {day}
                </button>
              ),
            )}
          </div>
          <div className="ui-cal-time">
            <span className="muted">{translate("HKT")}</span>
            <input
              type="number"
              min={0}
              max={23}
              aria-label={translate("Hour")}
              value={parsed ? pad(parsed.hour) : "00"}
              onChange={(e) =>
                updateTime(Number(e.target.value), parsed ? parsed.minute : 0)
              }
            />
            <span>:</span>
            <input
              type="number"
              min={0}
              max={59}
              aria-label={translate("Minute")}
              value={parsed ? pad(parsed.minute) : "00"}
              onChange={(e) =>
                updateTime(parsed ? parsed.hour : 0, Number(e.target.value))
              }
            />
            <button
              type="button"
              className="text-button"
              onClick={() => onChange(formatIsoMinute(now()))}
            >
              {translate("Now")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
