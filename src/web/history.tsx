import { Activity, AlertCircle, Clock } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, formatUptime, when } from "./client";
import { Badge, Dialog, Empty, Field } from "./components";
import type { Row } from "./types";

type HistorySnapshot = {
  entityId: string;
  start: number;
  end: number;
  resolution?: string;
  samples: Row[];
  events: Row[];
};

const chartTooltipStyle = {
  backgroundColor: "#ffffff",
  border: "2px solid #8f7588",
  borderRadius: "10px",
  boxShadow: "none",
  fontSize: "13px",
  color: "#191018",
};

export function History({
  entity,
  onClose,
}: {
  entity: Row;
  onClose: () => void;
}) {
  const uid = useId();
  const [range, setRange] = useState("24");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    setSnapshot(null);
    if (range === "custom" && (!custom.start || !custom.end)) {
      setLoading(false);
      setError("");
      return;
    }
    const end = range === "custom" ? Date.parse(custom.end + "Z") : Date.now();
    const start =
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
      `history/${entity.id}?start=${start}&end=${end}`,
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
          setError(e instanceof Error ? e.message : "Failed to load history.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [entity.id, range, custom.start, custom.end]);

  const current = snapshot?.entityId === entity.id ? snapshot : null;
  const samples = current?.samples ?? [];
  const events = current?.events ?? [];
  const observations = samples.filter((p) => p.reachable !== null);
  const unitSuffix =
    current?.resolution === "day"
      ? "/day"
      : current?.resolution === "hour"
        ? "/hr"
        : "/min";

  const createdAt =
    typeof entity.created === "number"
      ? entity.created
      : entity.created
        ? Date.parse(entity.created)
        : NaN;
  const effectiveStart = current
    ? Number.isFinite(createdAt)
      ? Math.max(current.start, createdAt)
      : current.start
    : 0;
  const expected = current
    ? Math.max(0, (current.end - effectiveStart) / 60000)
    : 0;
  const coverage = expected
    ? Math.min(
        100,
        (observations.reduce((sum, p) => sum + p.observations, 0) / expected) *
          100,
      )
    : 0;
  const availability = observations.length
    ? (observations.reduce((sum, p) => sum + p.successes, 0) /
        observations.reduce((sum, p) => sum + p.observations, 0)) *
      100
    : null;
  const incompleteCustom = range === "custom" && (!custom.start || !custom.end);

  const trafficData = samples.map((p) => ({
    ...p,
    time: when(p.at),
    inMiB: Number(((p.inbound || 0) / 1024 ** 2).toFixed(2)),
    outMiB: Number(((p.outbound || 0) / 1024 ** 2).toFixed(2)),
  }));

  const resourceData = samples.map((p) => ({
    ...p,
    time: when(p.at),
    cpu: p.cpu !== null ? Number(p.cpu.toFixed(1)) : null,
    cpu_max: p.cpu_max !== null ? Number(p.cpu_max.toFixed(1)) : null,
    memory: p.memory !== null ? Number(p.memory.toFixed(1)) : null,
    disk: p.disk !== null ? Number(p.disk.toFixed(1)) : null,
  }));

  return (
    <Dialog
      title={`${entity.name} · History`}
      subtitle="Asia/Hong_Kong display · custom range inputs in UTC"
      onClose={onClose}
      wide
    >
      <div className="dialog-body" aria-busy={loading}>
        <div className="range-tabs" role="group" aria-label="Reporting range">
          {[
            ["24", "24 hours"],
            ["168", "7 days"],
            ["720", "30 days"],
            ["custom", "Custom"],
          ].map(([v, label]) => (
            <button
              type="button"
              className={range === v ? "range-tab selected" : "range-tab"}
              aria-pressed={range === v}
              key={v}
              onClick={() => setRange(v)}
            >
              {label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="form-grid custom-range-grid">
            <Field label="Start (UTC)" htmlFor={`${uid}-start`}>
              <input
                id={`${uid}-start`}
                type="datetime-local"
                value={custom.start}
                onChange={(e) =>
                  setCustom((prev) => ({ ...prev, start: e.target.value }))
                }
              />
            </Field>
            <Field label="End (UTC)" htmlFor={`${uid}-end`}>
              <input
                id={`${uid}-end`}
                type="datetime-local"
                value={custom.end}
                onChange={(e) =>
                  setCustom((prev) => ({ ...prev, end: e.target.value }))
                }
              />
            </Field>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {entity.kind === "host" && (
          <div className="history-stats">
            <div className="history-kpi">
              <span>Observed availability</span>
              <strong>
                {availability === null ? "—" : availability.toFixed(2) + "%"}
              </strong>
            </div>
            <div className="history-kpi">
              <span>Monitoring coverage</span>
              <strong>{current ? coverage.toFixed(1) + "%" : "—"}</strong>
            </div>
            <div className="history-kpi">
              <span>Host uptime</span>
              <strong>{formatUptime(entity.uptime)}</strong>
            </div>
          </div>
        )}

        {loading ? (
          <div className="history-loading">
            <progress aria-label="Loading history" className="flat-progress" />
            <div className="skeleton-block" />
            <div className="skeleton-block short" />
          </div>
        ) : !current ? (
          !error &&
          incompleteCustom && (
            <p className="muted-copy">
              Enter start and end timestamps in UTC to load history.
            </p>
          )
        ) : (
          <>
            <section className="history-section">
              <div className="history-section-head">
                <h3>Traffic (MiB{unitSuffix})</h3>
                <div className="chart-legend" aria-hidden="true">
                  <span>
                    <i className="swatch accent" /> Outbound
                  </span>
                  <span>
                    <i className="swatch good" /> Inbound
                  </span>
                </div>
              </div>
              {!samples.length ? (
                <Empty
                  title="No observations in this range"
                  icon={<Activity size={24} />}
                >
                  Unobserved periods are recorded as unknown, never as VPS
                  downtime.
                </Empty>
              ) : (
                <div className="chart">
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={trafficData}>
                      <CartesianGrid
                        stroke="#dcc6d5"
                        strokeDasharray="4 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 12, fill: "#5b4957" }}
                        tickLine={false}
                        axisLine={{ stroke: "#dcc6d5" }}
                        minTickGap={60}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: "#5b4957" }}
                        tickLine={false}
                        axisLine={false}
                        width={54}
                      />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="outMiB"
                        name={`Outbound MiB${unitSuffix}`}
                        stroke="#c20e70"
                        strokeWidth={2.5}
                        fill="#fce6f2"
                        fillOpacity={0.9}
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                      <Area
                        type="monotone"
                        dataKey="inMiB"
                        name={`Inbound MiB${unitSuffix}`}
                        stroke="#0e7a56"
                        strokeWidth={2.5}
                        fill="#e3f7ef"
                        fillOpacity={0.65}
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {entity.kind === "host" && samples.some((p) => p.cpu !== null) && (
              <section className="history-section">
                <div className="history-section-head">
                  <h3>Resource utilization (%)</h3>
                  <div className="chart-legend" aria-hidden="true">
                    <span>
                      <i className="swatch accent" /> CPU mean
                    </span>
                    <span>
                      <i className="swatch warning" /> CPU max
                    </span>
                    <span>
                      <i className="swatch good" /> Memory
                    </span>
                    <span>
                      <i className="swatch ink" /> Disk
                    </span>
                  </div>
                </div>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={resourceData}>
                      <CartesianGrid
                        stroke="#dcc6d5"
                        strokeDasharray="4 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 12, fill: "#5b4957" }}
                        tickLine={false}
                        axisLine={{ stroke: "#dcc6d5" }}
                        minTickGap={60}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 12, fill: "#5b4957" }}
                        tickLine={false}
                        axisLine={false}
                        width={42}
                      />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="cpu"
                        name="CPU mean (%)"
                        stroke="#c20e70"
                        strokeWidth={2.5}
                        fill="#fce6f2"
                        fillOpacity={0.75}
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                      <Area
                        type="monotone"
                        dataKey="cpu_max"
                        name="CPU max (%)"
                        stroke="#9a5500"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        fill="none"
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                      <Area
                        type="monotone"
                        dataKey="memory"
                        name="Memory mean (%)"
                        stroke="#0e7a56"
                        strokeWidth={2}
                        fill="none"
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                      <Area
                        type="monotone"
                        dataKey="disk"
                        name="Disk mean (%)"
                        stroke="#5b4957"
                        strokeWidth={2}
                        strokeDasharray="2 3"
                        fill="none"
                        isAnimationActive={!reduceMotion}
                        animationDuration={450}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            <section className="history-section">
              <div className="history-section-head">
                <h3>Accounting & operation events</h3>
                <Badge tone="neutral" icon={<Clock size={14} />}>
                  {events.length} events
                </Badge>
              </div>
              {events.length ? (
                <div className="event-list">
                  {events.map((e: Row) => (
                    <article className="event-line" key={e.id}>
                      <div className="event-line-head">
                        <Badge tone="accent">{e.type}</Badge>
                        <small className="mono">{when(e.at)}</small>
                      </div>
                      <pre>{e.data}</pre>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No events in this range.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
