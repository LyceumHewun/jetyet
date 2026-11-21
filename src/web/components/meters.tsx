import { amount, fmt } from "../client";
import type { Row } from "../types";

export function RingMeter({
  percent,
  size = 68,
  tone = "accent",
  label,
}: {
  percent: number;
  size?: number;
  tone?: "accent" | "good" | "warning" | "danger";
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <div
      className={"ring-meter " + tone}
      style={{ width: size, height: size }}
      aria-label={label ? `${label} ${Math.round(clamped)}%` : undefined}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-value mono">{Math.round(clamped)}%</span>
    </div>
  );
}

export function MiniBar({
  label,
  percent,
}: {
  label: string;
  percent: number | null | undefined;
}) {
  const valid = typeof percent === "number" && Number.isFinite(percent);
  const clamped = valid ? Math.max(0, Math.min(100, percent)) : 0;
  const tone = !valid
    ? ""
    : clamped >= 85
      ? "danger"
      : clamped >= 65
        ? "warning"
        : "good";
  return (
    <div className="mini-bar">
      <div className="mini-bar-head">
        <span>{label}</span>
        <span className="mono">{valid ? `${Math.round(clamped)}%` : "—"}</span>
      </div>
      <div className="mini-bar-track">
        <i className={tone} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function Sparkline({
  points,
  tone = "accent",
}: {
  points: number[];
  tone?: "accent" | "good" | "warning" | "danger" | "muted";
}) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = Math.max(max - min, 1);
  const w = 72;
  const h = 22;
  const poly = points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * w;
      const y = h - 3 - ((p - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className={"sparkline " + tone}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden="true"
    >
      <polyline
        points={poly}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function QuotaBar({ row }: { row: Row }) {
  const used = amount(row),
    limit = row.quota.limit,
    pct =
      limit === null
        ? 0
        : Math.min(100, limit === 0 ? 100 : (used / limit) * 100);
  return (
    <div className="quota">
      <div className="quota-head">
        <span className="mono">
          {fmt(used)} <small>/ {limit === null ? "∞" : fmt(limit)}</small>
        </span>
        <span className="quota-meta">
          {row.usageStale && <span className="stale-tag">Stale</span>}
          <small className="mono">
            {limit === null ? "∞" : `${Math.round(pct)}%`}
          </small>
        </span>
      </div>
      <div className="quota-track">
        <i
          className={row.exhausted ? "exhausted" : ""}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
