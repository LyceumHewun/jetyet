import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { directionMeta, fmt, when } from "../client";
import { formatDate, formatNumber, t as translate } from "../i18n";
import type { PortalTraffic } from "../types";
import { Badge, Chip } from "./primitives";

type PortalTrafficSample = PortalTraffic["samples"][number];

function formatHourHKT(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return formatDate(value, {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function chartScale(samples: PortalTrafficSample[]): {
  unit: "GiB" | "MiB" | "KiB";
  divisor: number;
} {
  let peak = 0;
  for (const sample of samples) {
    if (sample.inbound > peak) peak = sample.inbound;
    if (sample.outbound > peak) peak = sample.outbound;
  }
  if (peak >= 1024 ** 3) return { unit: "GiB", divisor: 1024 ** 3 };
  if (peak >= 1024 ** 2) return { unit: "MiB", divisor: 1024 ** 2 };
  return { unit: "KiB", divisor: 1024 };
}

type ChartPoint = {
  at: number;
  hour: string;
  fullTime: string;
  inboundBytes: number;
  outboundBytes: number;
  inVal: number;
  outVal: number;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
};

function PortalChartTooltip({ active, payload }: ChartTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="portal-chart-tooltip">
      <div className="portal-chart-tooltip-time mono">
        {point.fullTime} ({translate("HKT")})
      </div>
      <div className="portal-chart-tooltip-row">
        <span className="io-legend">
          <i className="dot-accent" aria-hidden="true" />
          {translate("Outbound")}
        </span>
        <strong className="mono">{fmt(point.outboundBytes)}</strong>
      </div>
      <div className="portal-chart-tooltip-row">
        <span className="io-legend">
          <i className="dot-good" aria-hidden="true" />
          {translate("Inbound")}
        </span>
        <strong className="mono">{fmt(point.inboundBytes)}</strong>
      </div>
    </div>
  );
}

/**
 * Compact subscriber portal traffic, quota, billing cycle, and 24-hour chart.
 */
export function PortalTrafficSection({
  traffic,
}: {
  traffic: PortalTraffic;
}) {
  const headingId = useId();
  const inbound = Math.max(0, traffic.inbound || 0);
  const outbound = Math.max(0, traffic.outbound || 0);
  const used = Math.max(0, traffic.used || 0);
  const limit = traffic.limit;
  const isUnlimited = limit === null;
  const exhausted = !isUnlimited && (limit <= 0 || used >= limit);
  const pct = isUnlimited
    ? 0
    : limit <= 0
      ? 100
      : Math.min(100, Math.max(0, (used / limit) * 100));
  const pctDecimals = pct > 0 && pct < 10 ? 1 : 0;

  const totalIO = inbound + outbound;
  const outShare = totalIO > 0 ? Math.round((outbound / totalIO) * 100) : 0;
  const dirMeta = directionMeta(traffic.direction);

  const samples = Array.isArray(traffic.samples) ? traffic.samples : [];
  const scale = chartScale(samples);
  const chartData: ChartPoint[] = samples.map((sample) => {
    const inBytes = Math.max(0, sample.inbound || 0);
    const outBytes = Math.max(0, sample.outbound || 0);
    return {
      at: sample.at,
      hour: formatHourHKT(sample.at),
      fullTime: when(sample.at),
      inboundBytes: inBytes,
      outboundBytes: outBytes,
      inVal: inBytes / scale.divisor,
      outVal: outBytes / scale.divisor,
    };
  });

  return (
    <section
      className="studio-card portal-traffic"
      aria-labelledby={headingId}
    >
      <div className="portal-traffic-head">
        <div className="portal-traffic-title">
          <h2 id={headingId}>{translate("Traffic")}</h2>
          <Chip>{dirMeta.short}</Chip>
        </div>
        {exhausted ? (
          <Badge tone="warning">{translate("Quota exhausted")}</Badge>
        ) : (
          isUnlimited && <Chip mono>{translate("∞ Unlimited")}</Chip>
        )}
      </div>

      <div className="portal-traffic-grid">
        <div className="portal-traffic-summary">
          <div className="portal-traffic-box">
            <span className="kpi-label">{translate("PERIOD USAGE")}</span>
            <div className="portal-usage-row">
              <strong className="metric-big mono">{fmt(used)}</strong>
              <span className="portal-usage-limit mono">
                / {isUnlimited ? "∞" : fmt(limit)}
              </span>
              {!isUnlimited && (
                <span className="portal-usage-pct mono">
                  {formatNumber(pct, pctDecimals)}%
                </span>
              )}
            </div>

            {!isUnlimited && (
              <div
                className="quota-track"
                role="progressbar"
                aria-label={translate("Quota usage")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <i
                  className={exhausted ? "exhausted" : ""}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}

            <small className="portal-direction-note muted">
              {translate("Counted: {0}", dirMeta.label)}
            </small>

            <div className="io-split">
              <div className="io-split-head">
                <span className="io-legend">
                  <i className="dot-accent" aria-hidden="true" />
                  {translate("↑ Out") + " "}
                  <b className="mono">{fmt(outbound)}</b>
                </span>
                <span className="io-legend">
                  <i className="dot-good" aria-hidden="true" />
                  {translate("↓ In") + " "}
                  <b className="mono">{fmt(inbound)}</b>
                </span>
              </div>
              <div
                className={
                  "io-split-track" + (totalIO === 0 ? " is-empty" : "")
                }
              >
                <i style={{ width: `${outShare}%` }} />
              </div>
            </div>
          </div>

          <dl className="portal-traffic-box portal-cycle-grid">
            <div className="portal-cycle-item">
              <dt className="kpi-label">{translate("Cycle start")}</dt>
              <dd className="mono">{when(traffic.periodStart)}</dd>
            </div>
            <div className="portal-cycle-item">
              <dt className="kpi-label">{translate("Next reset")}</dt>
              <dd className="mono">{when(traffic.nextReset)}</dd>
            </div>
          </dl>
        </div>

        <div className="portal-traffic-chart">
          <div className="expanded-chart-head">
            <div className="chart-title-group">
              <strong>
                {samples.length > 0
                  ? translate(
                      "Last 24 hours ({0}{1})",
                      scale.unit,
                      translate("/hr"),
                    )
                  : translate("Last 24 hours")}
              </strong>
              {samples.length > 0 && (
                <div className="chart-legends">
                  <span className="io-legend">
                    <i className="dot-accent" aria-hidden="true" />
                    {translate("Outbound")}
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" aria-hidden="true" />
                    {translate("Inbound")}
                  </span>
                </div>
              )}
            </div>
            <Chip mono>{translate("HKT")}</Chip>
          </div>

          {samples.length === 0 ? (
            <div className="portal-chart-empty muted">
              <p>{translate("No traffic recorded in the last 24 hours.")}</p>
            </div>
          ) : (
            <div
              className="chart portal-chart"
              role="group"
              aria-label={translate("Last 24 hours")}
            >
              <ResponsiveContainer width="100%" height={184}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 6, right: 20, left: -10, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="hour"
                    stroke="var(--border)"
                    tick={{ fontSize: "var(--text-2xs)", fill: "var(--muted)" }}
                    minTickGap={28}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="var(--border)"
                    tick={{ fontSize: "var(--text-2xs)", fill: "var(--muted)" }}
                    width={40}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      formatNumber(v, v > 0 && v < 10 ? 1 : 0)
                    }
                  />
                  <Tooltip
                    content={<PortalChartTooltip />}
                    cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="outVal"
                    name={translate("Outbound")}
                    stroke="var(--accent)"
                    strokeWidth={1.75}
                    fill="var(--accent-soft)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="inVal"
                    name={translate("Inbound")}
                    stroke="var(--good)"
                    strokeWidth={1.75}
                    fill="var(--good-soft)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
