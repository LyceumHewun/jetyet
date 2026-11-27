import {
  type UiError,
  formatDate,
  formatNumber,
  localizeError,
  t as translate,
} from "./i18n";
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
import {
  api,
  bucketUnitSuffix,
  formatUptime,
  readTelemetryRange,
  subscribeTelemetryRange,
  when,
  writeTelemetryRange,
} from "./client";
import {
  DateTimePicker,
  Empty,
  Field,
  RingMeter,
  SegmentedControl,
  Stage,
} from "./components";
import { eventLabel } from "./labels";
import type { Row } from "./types";

function eventTime(at: number) {
  return formatDate(at, {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function EventDetails({ type, data }: { type: string; data: string }) {
  const issued = type === "portal.password-link.issued";
  if (!issued && type !== "portal.password.changed") {
    return data && data.trim() !== "{}" ? <pre>{data}</pre> : null;
  }

  let values: Record<string, unknown> = {};
  try {
    values = JSON.parse(data) ?? {};
  } catch {
    // Invalid data has no displayable audit fields.
  }
  if (typeof values.username !== "string") {
    return (
      <p className="muted">
        {translate("No additional details were recorded.")}
      </p>
    );
  }

  return (
    <dl className="event-details">
      {issued && typeof values.actor === "string" && (
        <div>
          <dt>{translate("Issued by")}</dt>
          <dd>{values.actor}</dd>
        </div>
      )}
      <div>
        <dt>{translate("Username")}</dt>
        <dd>{values.username}</dd>
      </div>
      {issued && typeof values.expires === "number" && (
        <div>
          <dt>{translate("Expires")}</dt>
          <dd className="mono">{eventTime(values.expires)}</dd>
        </div>
      )}
      {issued && typeof values.replacedLink === "boolean" && (
        <div>
          <dt>{translate("Previous link")}</dt>
          <dd>
            {values.replacedLink
              ? translate("Revoked")
              : translate("No active link")}
          </dd>
        </div>
      )}
      {!issued && typeof values.replacedPassword === "boolean" && (
        <div>
          <dt>{translate("Password")}</dt>
          <dd>
            {values.replacedPassword
              ? translate("Replaced password")
              : translate("Set initial password")}
          </dd>
        </div>
      )}
    </dl>
  );
}

type HistorySnapshot = {
  entityId: string;
  start: number;
  end: number;
  resolution?: string;
  bucketMs?: number;
  samples: Row[];
  events: Row[];
};

export function History({
  entity,
  onClose,
}: {
  entity: Row;
  onClose: () => void;
}) {
  const [range, setRangeState] = useState<string>(readTelemetryRange),
    [custom, setCustom] = useState({ start: "", end: "" }),
    [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<UiError>("");
  const setRange = (next: string) => {
    setRangeState(next);
    if (next !== "custom") writeTelemetryRange(next);
  };
  useEffect(
    () =>
      subscribeTelemetryRange((next) =>
        setRangeState((cur) => (cur === "custom" ? cur : next)),
      ),
    [],
  );
  useEffect(() => {
    setSnapshot(null);
    if (range === "custom" && (!custom.start || !custom.end)) {
      setLoading(false);
      setError("");
      return;
    }
    const end = range === "custom" ? Date.parse(custom.end + "Z") : Date.now(),
      start =
        range === "custom"
          ? Date.parse(custom.start + "Z")
          : end - Number(range) * 3600000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setLoading(false);
      if (range === "custom") setError("Enter valid start and end timestamps.");
      return;
    }
    if (end <= start) {
      setLoading(false);
      setError("End time must be after start time.");
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");
    api(
      `history/${entity.id}?start=${start}&end=${end}&maxPoints=180`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((res) => {
        if (!cancelled) {
          setSnapshot({
            entityId: entity.id,
            start,
            end,
            resolution: res.resolution,
            bucketMs:
              typeof res.bucketMs === "number" ? res.bucketMs : undefined,
            samples: res.samples || [],
            events: res.events || [],
          });
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled && e?.name !== "AbortError") {
          setSnapshot(null);
          setError(e instanceof Error ? e : "Failed to load history.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [entity.id, range, custom.start, custom.end]);
  const current = snapshot?.entityId === entity.id ? snapshot : null,
    samples = current?.samples ?? [],
    events = current?.events ?? [],
    isHostLike = entity.kind === "host" || entity.kind === "control-plane",
    observations = samples.filter(
      (p) => p.reachable !== null && p.reachable !== undefined,
    ),
    unitSuffix = bucketUnitSuffix(current?.bucketMs, current?.resolution),
    createdAt =
      typeof entity.created === "number"
        ? entity.created
        : entity.created
          ? Date.parse(entity.created)
          : NaN,
    effectiveStart = current
      ? Number.isFinite(createdAt)
        ? Math.max(current.start, createdAt)
        : current.start
      : 0,
    expected = current
      ? Math.max(0, (current.end - effectiveStart) / 60000)
      : 0,
    coverage = expected
      ? Math.min(
          100,
          (observations.reduce((sum, p) => sum + (p.observations || 0), 0) /
            expected) *
            100,
        )
      : 0,
    availability = observations.length
      ? (observations.reduce((sum, p) => sum + (p.successes || 0), 0) /
          Math.max(
            1,
            observations.reduce((sum, p) => sum + (p.observations || 0), 0),
          )) *
        100
      : null,
    incompleteCustom = range === "custom" && (!custom.start || !custom.end);
  return (
    <Stage
      title={entity.name}
      tag={translate("Telemetry")}
      subtitle={
        entity.address
          ? `${entity.address}${entity.port ? ":" + entity.port : ""}`
          : entity.hostname || undefined
      }
      onClose={onClose}
      actions={
        <SegmentedControl
          value={range}
          options={[
            ["1", translate("1h")],
            ["24", translate("24h")],
            ["168", translate("7d")],
            ["720", translate("30d")],
            ["custom", translate("Custom")],
          ]}
          onChange={setRange}
        />
      }
    >
      <div className="telemetry-stack" aria-busy={loading}>
        {range === "custom" && (
          <div className="studio-card">
            <div className="form-grid">
              <Field label={translate("Start (HKT)")}>
                <DateTimePicker
                  value={custom.start}
                  onChange={(start) =>
                    setCustom((prev) => ({ ...prev, start }))
                  }
                />
              </Field>
              <Field label={translate("End (HKT)")}>
                <DateTimePicker
                  value={custom.end}
                  onChange={(end) => setCustom((prev) => ({ ...prev, end }))}
                />
              </Field>
            </div>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {localizeError(error)}
          </p>
        )}
        {isHostLike && (
          <div className="telemetry-kpis">
            <div className="studio-card telemetry-kpi-card">
              <RingMeter
                percent={availability ?? 0}
                size={60}
                tone={
                  availability === null
                    ? "accent"
                    : availability >= 95
                      ? "good"
                      : availability >= 80
                        ? "warning"
                        : "danger"
                }
                label={translate("Availability")}
              />
              <div>
                <span className="kpi-label">{translate("AVAILABILITY")}</span>
                <strong className="telemetry-big">
                  {availability === null
                    ? "—"
                    : formatNumber(availability, 2) + "%"}
                </strong>
              </div>
            </div>
            <div className="studio-card telemetry-kpi-card">
              <RingMeter
                percent={current ? coverage : 0}
                size={60}
                tone="accent"
                label={translate("Coverage")}
              />
              <div>
                <span className="kpi-label">{translate("COVERAGE")}</span>
                <strong className="telemetry-big">
                  {current ? formatNumber(coverage, 1) + "%" : "—"}
                </strong>
              </div>
            </div>
            <div className="studio-card telemetry-kpi-card">
              <div>
                <span className="kpi-label">{translate("HOST UPTIME")}</span>
                <strong className="telemetry-big mono">
                  {formatUptime(entity.uptime)}
                </strong>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="studio-card">
            <p className="muted">{translate("Loading telemetry…")}</p>
          </div>
        ) : !current ? (
          !error &&
          incompleteCustom && (
            <div className="studio-card">
              <p className="muted">
                {translate("Enter start and end timestamps to load history.")}
              </p>
            </div>
          )
        ) : (
          <>
            <div
              className={
                isHostLike && samples.some((p) => p.cpu !== null && p.cpu !== undefined)
                  ? "charts-grid"
                  : ""
              }
            >
              <section className="panel">
                <div className="panel-heading compact">
                  <h2>{translate("Traffic (MiB{0})", unitSuffix)}</h2>
                </div>
                <div className="chart-pad">
                  {entity.kind === "control-plane" &&
                  samples.length > 0 &&
                  samples.every((p) => p.inbound == null) ? (
                    <Empty title={translate("Traffic counters unavailable")}>
                      {translate("Traffic counters unavailable on this host.")}
                    </Empty>
                  ) : !samples.length ? (
                    <Empty title={translate("No observations")}>
                      {translate(
                        "Unknown periods are not recorded as downtime.",
                      )}
                    </Empty>
                  ) : (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart
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
                            minTickGap={60}
                          />
                          <YAxis
                            stroke="var(--border)"
                            tick={{ fontSize: 10, fill: "var(--muted)" }}
                            width={45}
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
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </section>
              {isHostLike &&
                samples.some((p) => p.cpu !== null && p.cpu !== undefined) && (
                  <section className="panel">
                    <div className="panel-heading compact">
                      <h2>{translate("Resource utilization (%)")}</h2>
                    </div>
                    <div className="chart-pad">
                      <div className="chart">
                        <ResponsiveContainer width="100%" height={260}>
                          <AreaChart
                            data={samples.map((p) => ({
                              ...p,
                              time: when(p.at),
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
                              minTickGap={60}
                            />
                            <YAxis
                              domain={[0, 100]}
                              stroke="var(--border)"
                              tick={{ fontSize: 10, fill: "var(--muted)" }}
                              width={35}
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
                              name={translate("CPU mean")}
                              stroke="var(--accent)"
                              fill="var(--accent-soft)"
                              isAnimationActive={false}
                            />
                            <Area
                              dataKey="cpu_max"
                              name={translate("CPU max")}
                              stroke="var(--warning)"
                              fill="none"
                              isAnimationActive={false}
                            />
                            <Area
                              dataKey="memory"
                              name={translate("Memory mean")}
                              stroke="var(--good)"
                              fill="none"
                              isAnimationActive={false}
                            />
                            <Area
                              dataKey="disk"
                              name={translate("Disk mean")}
                              stroke="var(--muted)"
                              fill="none"
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>
                )}
            </div>
            <section className="panel">
              <div className="panel-heading compact">
                <h2>{translate("Events")}</h2>
                <span className="count">{formatNumber(events.length)}</span>
              </div>
              <div className="events-pad">
                {events.length ? (
                  events.map((e: Row) => (
                    <div className="event-line" key={e.id}>
                      <div className="event-line-head">
                        <strong>{eventLabel(e.type)}</strong>
                        <time
                          className="mono"
                          dateTime={new Date(e.at).toISOString()}
                        >
                          {eventTime(e.at)}
                        </time>
                      </div>
                      <EventDetails type={e.type} data={e.data} />
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    {translate("No events in this range.")}
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </Stage>
  );
}
