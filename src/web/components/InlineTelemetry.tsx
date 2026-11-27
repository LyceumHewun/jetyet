import { formatNumber, t as translate } from "../i18n";
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
import { api, bucketUnitSuffix, fmt, formatUptime, when } from "../client";
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
  const [bucketMs, setBucketMs] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const end = Date.now();
    const start = end - Number(range) * 3600000;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    api(
      `history/${entity.id}?start=${start}&end=${end}&maxPoints=96&includeEvents=0`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((res) => {
        if (!cancelled) {
          setSamples(res.samples || []);
          setResolution(res.resolution || "hour");
          setBucketMs(typeof res.bucketMs === "number" ? res.bucketMs : undefined);
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

  const isHostLike =
    entity.kind === "host" || entity.kind === "control-plane";
  const isControlPlane = entity.kind === "control-plane";
  const observations = samples.filter((p) => p.reachable !== null && p.reachable !== undefined);
  const availability = observations.length
    ? (observations.reduce((sum, p) => sum + (p.successes || 0), 0) /
        Math.max(
          1,
          observations.reduce((sum, p) => sum + (p.observations || 0), 0),
        )) *
      100
    : entity.reachable
      ? 100
      : 0;
  const hasResources =
    isHostLike && samples.some((p) => p.cpu !== null && p.cpu !== undefined);
  const showResources = metric === "resources" && hasResources;
  const unitSuffix = bucketUnitSuffix(bucketMs, resolution);
  const uptimeText = formatUptime(entity.uptime);

  const inbound = entity.usage?.inbound || 0;
  const outbound = entity.usage?.outbound || 0;
  const totalTraffic = inbound + outbound;
  const outShare =
    totalTraffic > 0 ? Math.round((outbound / totalTraffic) * 100) : 50;
  const quotaPct = entity.quota?.limit
    ? Math.min(100, (totalTraffic / Math.max(entity.quota.limit, 1)) * 100)
    : 0;
  const hasTraffic = samples.some((p) => p.inbound != null);
  const rangeIn = samples.reduce((sum, p) => sum + (p.inbound || 0), 0);
  const rangeOut = samples.reduce((sum, p) => sum + (p.outbound || 0), 0);
  const rangeTotal = rangeIn + rangeOut;
  const rangeOutShare =
    rangeTotal > 0 ? Math.round((rangeOut / rangeTotal) * 100) : 50;

  return (
    <>
      <div className="expanded-metrics-col">
        {isHostLike ? (
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
              label={translate("Availability")}
            />
            <div>
              <span className="kpi-label">
                {translate("UPTIME · {0}%", formatNumber(availability, 1))}
              </span>
              <strong className="metric-big mono">{uptimeText}</strong>
              <small className="mono">
                {entity.lastSeen
                  ? translate("Seen {0}", when(entity.lastSeen))
                  : translate("No heartbeat")}
              </small>
            </div>
          </div>
        ) : (
          <div className="metric-box ring-box">
            <RingMeter
              percent={quotaPct}
              size={58}
              tone={entity.exhausted ? "warning" : "accent"}
              label={translate("Quota")}
            />
            <div>
              <span className="kpi-label">{translate("PERIOD USAGE")}</span>
              <strong className="metric-big mono">{fmt(totalTraffic)}</strong>
              <small className="mono">
                {translate(
                  "Limit {0} · Reset {1}",
                  entity.quota?.limit === null ? "∞" : fmt(entity.quota.limit),
                  when(entity.usage?.next),
                )}
              </small>
            </div>
          </div>
        )}
        <div className="metric-box bars-box">
          {isHostLike ? (
            <>
              <MiniBar label="CPU" percent={entity.cpu} />
              <MiniBar label="RAM" percent={entity.memory} />
              <MiniBar label={translate("Disk")} percent={entity.disk} />
              {isControlPlane ? (
                entity.networkAvailable === false ? (
                  <div className="io-split">
                    <small className="muted">
                      {translate("Traffic counters unavailable")}
                    </small>
                  </div>
                ) : (
                  <div className="io-split">
                    <div className="io-split-head">
                      <span className="io-legend">
                        <i className="dot-accent" />
                        {translate("↑ Out") + " "}
                        <b className="mono">{hasTraffic ? fmt(rangeOut) : "—"}</b>
                      </span>
                      <span className="io-legend">
                        <i className="dot-good" />
                        {translate("↓ In") + " "}
                        <b className="mono">{hasTraffic ? fmt(rangeIn) : "—"}</b>
                      </span>
                    </div>
                    {hasTraffic && (
                      <div className="io-split-track">
                        <i style={{ width: `${rangeOutShare}%` }} />
                      </div>
                    )}
                  </div>
                )
              ) : (
                <QuotaBar row={entity} />
              )}
            </>
          ) : (
            <>
              <QuotaBar row={entity} />
              <div className="io-split">
                <div className="io-split-head">
                  <span className="io-legend">
                    <i className="dot-accent" />
                    {translate("↑ Out") + " "}
                    <b className="mono">{fmt(outbound)}</b>
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />
                    {translate("↓ In") + " "}
                    <b className="mono">{fmt(inbound)}</b>
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
                ? translate("Resources (%)")
                : translate("Traffic (MiB{0})", unitSuffix)}
            </strong>
            <div className="chart-legends">
              {metric === "resources" && hasResources ? (
                <>
                  <span className="io-legend">
                    <i className="dot-accent" />
                    CPU
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />
                    RAM
                  </span>
                  <span className="io-legend">
                    <i className="dot-muted" />
                    {translate("Disk")}
                  </span>
                </>
              ) : (
                <>
                  <span className="io-legend">
                    <i className="dot-accent" />
                    {translate("Outbound")}
                  </span>
                  <span className="io-legend">
                    <i className="dot-good" />
                    {translate("Inbound")}
                  </span>
                </>
              )}
            </div>
          </div>
          {hasResources && (
            <SegmentedControl
              value={metric}
              options={[
                ["traffic", translate("Traffic")],
                ["resources", translate("Resources")],
              ]}
              onChange={setMetric}
            />
          )}
        </div>
        {loading ? (
          <div className="chart-placeholder muted">
            {translate("Loading telemetry…")}
          </div>
        ) : !showResources &&
          isControlPlane &&
          samples.length > 0 &&
          !hasTraffic ? (
          <div className="chart-placeholder muted">
            {translate("Traffic counters unavailable on this host.")}
          </div>
        ) : !samples.length ? (
          <div className="chart-placeholder muted">
            {translate("No observations in this range")}
          </div>
        ) : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={206}>
              {showResources ? (
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
                    formatter={(value: any, name: any, item: any) => {
                      const num =
                        typeof value === "number"
                          ? formatNumber(value, 1)
                          : value;
                      const key = item?.dataKey as string | undefined;
                      const peak =
                        key === "cpu"
                          ? item?.payload?.cpu_max
                          : key === "memory"
                            ? item?.payload?.memory_max
                            : key === "disk"
                              ? item?.payload?.disk_max
                              : null;
                      if (
                        typeof peak === "number" &&
                        typeof value === "number" &&
                        peak > value + 0.05
                      ) {
                        return [
                          `${num}% (${translate("peak {0}%", formatNumber(peak, 1))})`,
                          name,
                        ];
                      }
                      return [`${num}%`, name];
                    }}
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
                    name={translate("Disk %")}
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
                    inMiB: p.inbound == null ? null : p.inbound / 1024 ** 2,
                    outMiB: p.outbound == null ? null : p.outbound / 1024 ** 2,
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
                    formatter={(value: any, name: any) => [
                      typeof value === "number"
                        ? `${formatNumber(value, 2)} MiB`
                        : value,
                      name,
                    ]}
                  />
                  <Area
                    dataKey="outMiB"
                    name={translate("Outbound MiB{0}", unitSuffix)}
                    stroke="var(--accent)"
                    fill="var(--accent-soft)"
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="inMiB"
                    name={translate("Inbound MiB{0}", unitSuffix)}
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
