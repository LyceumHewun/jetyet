import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, fmt, when } from "../client";
import type { Row } from "../types";
import { MiniBar, QuotaBar, RingMeter } from "./meters";
import { SegmentedControl } from "./primitives";

export function InlineTelemetry({
  entity,
  range,
}: {
  entity: Row;
  range: string;
}) {
  const [metric, setMetric] = useState<"traffic" | "resources">("traffic");
  const [samples, setSamples] = useState<Row[]>([]);
  const [resolution, setResolution] = useState<string>("hour");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const end = Date.now();
    const start = end - Number(range) * 3600000;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    api(
      `history/${entity.id}?start=${start}&end=${end}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((res) => {
        if (!cancelled) {
          setSamples(res.samples || []);
          setResolution(res.resolution || "hour");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSamples([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [entity.id, range]);

  const observations = samples.filter((p) => p.reachable !== null);
  const availability = observations.length
    ? (observations.reduce((sum, p) => sum + p.successes, 0) /
        observations.reduce((sum, p) => sum + p.observations, 0)) *
      100
    : entity.reachable
      ? 100
      : 0;
  const hasResources =
    entity.kind === "host" && samples.some((p) => p.cpu !== null);
  const unitSuffix =
    resolution === "day" ? "/day" : resolution === "hour" ? "/hr" : "/min";
  const uptimeText = entity.uptime
    ? `${Math.floor(entity.uptime / 86400)}d ${Math.floor((entity.uptime % 86400) / 3600)}h`
    : "—";

  const inbound = entity.usage?.inbound || 0;
  const outbound = entity.usage?.outbound || 0;
  const totalTraffic = inbound + outbound;
  const outShare = totalTraffic > 0 ? Math.round((outbound / totalTraffic) * 100) : 50;
  const quotaPct = entity.quota?.limit
    ? Math.min(100, (totalTraffic / Math.max(entity.quota.limit, 1)) * 100)
    : 0;

  return (
    <>
      <div className="expanded-metrics-col">
        {entity.kind === "host" ? (
          <div className="metric-box ring-box">
            <RingMeter
              percent={availability}
              size={58}
              tone={
                availability >= 95
                  ? "good"
                  : availability >= 80
                    ? "warning"
                    : "danger"
              }
              label="Availability"
            />
            <div>
              <span className="kpi-label">UPTIME · {availability.toFixed(1)}%</span>
              <strong className="metric-big mono">{uptimeText}</strong>
              <small className="mono">
                {entity.lastSeen ? `Seen ${when(entity.lastSeen)}` : "No heartbeat"}
              </small>
            </div>
          </div>
        ) : (
          <div className="metric-box ring-box">
            <RingMeter
              percent={quotaPct}
              size={58}
              tone={entity.exhausted ? "warning" : "accent"}
              label="Quota"
            />
            <div>
              <span className="kpi-label">PERIOD USAGE</span>
              <strong className="metric-big mono">{fmt(totalTraffic)}</strong>
              <small className="mono">
                of {entity.quota?.limit === null ? "∞" : fmt(entity.quota.limit)} · Reset{" "}
                {when(entity.usage?.next)}
              </small>
            </div>
          </div>
        )}
        <div className="metric-box bars-box">
          {entity.kind === "host" ? (
            <>
              <MiniBar label="CPU" percent={entity.cpu} />
              <MiniBar label="RAM" percent={entity.memory} />
              <MiniBar label="DISK" percent={entity.disk} />
              <QuotaBar row={entity} />
            </>
          ) : (
            <>
              <QuotaBar row={entity} />
              <div className="io-split">
                <div className="io-split-head">
                  <span className="io-legend">
                    <i className="dot-accent" />↑ Out <b className="mono">{fmt(outbound)}</b>
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />↓ In <b className="mono">{fmt(inbound)}</b>
                  </span>
                </div>
                <div className="io-split-track">
                  <i style={{ width: `${outShare}%` }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="expanded-chart-col">
        <div className="expanded-chart-head">
          <div className="chart-title-group">
            <strong>
              {metric === "resources" && hasResources
                ? "Resources (%)"
                : `Traffic (MiB${unitSuffix})`}
            </strong>
            <div className="chart-legends">
              {metric === "resources" && hasResources ? (
                <>
                  <span className="io-legend">
                    <i className="dot-accent" />CPU
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />RAM
                  </span>
                  <span className="io-legend">
                    <i className="dot-muted" />Disk
                  </span>
                </>
              ) : (
                <>
                  <span className="io-legend">
                    <i className="dot-accent" />Outbound
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />Inbound
                  </span>
                </>
              )}
            </div>
          </div>
          {hasResources && (
            <SegmentedControl
              value={metric}
              options={[
                ["traffic", "Traffic"],
                ["resources", "Resources"],
              ]}
              onChange={setMetric}
            />
          )}
        </div>
        {loading ? (
          <div className="chart-placeholder muted">Loading telemetry…</div>
        ) : !samples.length ? (
          <div className="chart-placeholder muted">
            No observations in this range
          </div>
        ) : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={206}>
              {metric === "resources" && hasResources ? (
                <AreaChart
                  margin={{ top: 6, right: 28, left: -8, bottom: 0 }}
                  data={samples.map((p) => ({ ...p, time: when(p.at) }))}
                >
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="var(--border)"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    minTickGap={64}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="var(--border)"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      color: "var(--ink)",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "var(--muted)" }}
                  />
                  <Area
                    dataKey="cpu"
                    name="CPU %"
                    stroke="var(--accent)"
                    fill="var(--accent-soft)"
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="memory"
                    name="RAM %"
                    stroke="var(--good)"
                    fill="var(--good-soft)"
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="disk"
                    name="Disk %"
                    stroke="var(--muted)"
                    fill="none"
                    isAnimationActive={false}
                  />
                </AreaChart>
              ) : (
                <AreaChart
                  margin={{ top: 6, right: 28, left: -4, bottom: 0 }}
                  data={samples.map((p) => ({
                    ...p,
                    time: when(p.at),
                    inMiB: (p.inbound || 0) / 1024 ** 2,
                    outMiB: (p.outbound || 0) / 1024 ** 2,
                  }))}
                >
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="var(--border)"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    minTickGap={64}
                  />
                  <YAxis
                    stroke="var(--border)"
                    tick={{ fontSize: 10, fill: "var(--muted)" }}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      color: "var(--ink)",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "var(--muted)" }}
                  />
                  <Area
                    dataKey="outMiB"
                    name={`Outbound MiB${unitSuffix}`}
                    stroke="var(--accent)"
                    fill="var(--accent-soft)"
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="inMiB"
                    name={`Inbound MiB${unitSuffix}`}
                    stroke="var(--good)"
                    fill="var(--good-soft)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
