import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");

function parseValue(val: string): Date | null {
  if (!val) return null;
  const norm = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)
    ? val + ":00Z"
    : val.endsWith("Z")
      ? val
      : val + "Z";
  const ms = Date.parse(norm);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function formatIsoMinute(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatDisplay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Select date & time (UTC)",
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
  const [viewYear, setViewYear] = useState(
    () => (parsed || new Date()).getUTCFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    () => (parsed || new Date()).getUTCMonth(),
  );
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = parseValue(value) || new Date();
    setViewYear(base.getUTCFullYear());
    setViewMonth(base.getUTCMonth());
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
    const base = parsed || new Date();
    const next = new Date(
      Date.UTC(year, month, day, base.getUTCHours(), base.getUTCMinutes()),
    );
    onChange(formatIsoMinute(next));
  };

  const updateTime = (hours: number, minutes: number) => {
    const base = parsed || new Date();
    const h = Math.max(0, Math.min(23, Number.isFinite(hours) ? hours : 0));
    const m = Math.max(0, Math.min(59, Number.isFinite(minutes) ? minutes : 0));
    const next = new Date(
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        h,
        m,
      ),
    );
    onChange(formatIsoMinute(next));
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
            aria-label="Clear date"
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
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={15} />
            </button>
            <strong className="mono">
              {MONTHS[viewMonth]} {viewYear}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="ui-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
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
                    parsed.getUTCFullYear() === viewYear &&
                    parsed.getUTCMonth() === viewMonth &&
                    parsed.getUTCDate() === day
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
            <span className="muted">UTC</span>
            <input
              type="number"
              min={0}
              max={23}
              aria-label="Hour"
              value={parsed ? pad(parsed.getUTCHours()) : "00"}
              onChange={(e) =>
                updateTime(
                  Number(e.target.value),
                  parsed ? parsed.getUTCMinutes() : 0,
                )
              }
            />
            <span>:</span>
            <input
              type="number"
              min={0}
              max={59}
              aria-label="Minute"
              value={parsed ? pad(parsed.getUTCMinutes()) : "00"}
              onChange={(e) =>
                updateTime(
                  parsed ? parsed.getUTCHours() : 0,
                  Number(e.target.value),
                )
              }
            />
            <button
              type="button"
              className="text-button"
              onClick={() => onChange(formatIsoMinute(new Date()))}
            >
              Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
