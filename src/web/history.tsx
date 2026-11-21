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
import { api, when } from "./client";
import {
  DateTimePicker,
  Empty,
  Field,
  RingMeter,
  SegmentedControl,
  Stage,
} from "./components";
import type { Row } from "./types";
type HistorySnapshot = {
  entityId: string;
  start: number;
  end: number;
  resolution?: string;
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
  const [range, setRange] = useState("24"),
    [custom, setCustom] = useState({ start: "", end: "" }),
    [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
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
  const current = snapshot?.entityId === entity.id ? snapshot : null,
    samples = current?.samples ?? [],
    events = current?.events ?? [],
    observations = samples.filter((p) => p.reachable !== null),
    unitSuffix =
      current?.resolution === "day"
        ? "/day"
        : current?.resolution === "hour"
          ? "/hr"
          : "/min",
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
          (observations.reduce((sum, p) => sum + p.observations, 0) /
            expected) *
            100,
        )
      : 0,
    availability = observations.length
      ? (observations.reduce((sum, p) => sum + p.successes, 0) /
          observations.reduce((sum, p) => sum + p.observations, 0)) *
        100
      : null,
    incompleteCustom = range === "custom" && (!custom.start || !custom.end);
  return (
    <Stage
      title={entity.name}
      tag="Telemetry"
      subtitle={entity.address ? `${entity.address}${entity.port ? ":" + entity.port : ""}` : undefined}
      onClose={onClose}
      actions={
        <SegmentedControl
          value={range}
          options={[
            ["24", "24h"],
            ["168", "7d"],
            ["720", "30d"],
            ["custom", "Custom"],
          ]}
          onChange={setRange}
        />
      }
    >
      <div className="telemetry-stack" aria-busy={loading}>
        {range === "custom" && (
          <div className="studio-card">
            <div className="form-grid">
              <Field label="Start (UTC)">
                <DateTimePicker
                  value={custom.start}
                  onChange={(start) =>
                    setCustom((prev) => ({ ...prev, start }))
                  }
                />
              </Field>
              <Field label="End (UTC)">
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
            {error}
          </p>
        )}
        {entity.kind === "host" && (
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
                label="Availability"
              />
              <div>
                <span className="kpi-label">AVAILABILITY</span>
                <strong className="telemetry-big">
                  {availability === null ? "—" : availability.toFixed(2) + "%"}
                </strong>
              </div>
            </div>
            <div className="studio-card telemetry-kpi-card">
              <RingMeter
                percent={current ? coverage : 0}
                size={60}
                tone="accent"
                label="Coverage"
              />
              <div>
                <span className="kpi-label">COVERAGE</span>
                <strong className="telemetry-big">
                  {current ? coverage.toFixed(1) + "%" : "—"}
                </strong>
              </div>
            </div>
            <div className="studio-card telemetry-kpi-card">
              <div>
                <span className="kpi-label">HOST UPTIME</span>
                <strong className="telemetry-big mono">
                  {entity.uptime
                    ? Math.floor(entity.uptime / 86400) +
                      "d " +
                      Math.floor((entity.uptime % 86400) / 3600) +
                      "h"
                    : "—"}
                </strong>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="studio-card">
            <p className="muted">Loading telemetry…</p>
          </div>
        ) : !current ? (
          !error &&
          incompleteCustom && (
            <div className="studio-card">
              <p className="muted">
                Enter start and end timestamps to load history.
              </p>
            </div>
          )
        ) : (
          <>
            <div
              className={
                entity.kind === "host" && samples.some((p) => p.cpu !== null)
                  ? "charts-grid"
                  : ""
              }
            >
              <section className="panel">
                <div className="panel-heading compact">
                  <h2>Traffic (MiB{unitSuffix})</h2>
                </div>
                <div className="chart-pad">
                  {!samples.length ? (
                    <Empty title="No observations">
                      Unknown periods are not recorded as downtime.
                    </Empty>
                  ) : (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart
                          data={samples.map((p) => ({
                            ...p,
                            time: when(p.at),
                            inMiB: p.inbound / 1024 ** 2,
                            outMiB: p.outbound / 1024 ** 2,
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
                          />
                          <Area
                            dataKey="outMiB"
                            name={`Outbound MiB${unitSuffix}`}
                            stroke="var(--accent)"
                            fill="var(--accent-soft)"
                          />
                          <Area
                            dataKey="inMiB"
                            name={`Inbound MiB${unitSuffix}`}
                            stroke="var(--good)"
                            fill="var(--good-soft)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </section>
              {entity.kind === "host" &&
                samples.some((p) => p.cpu !== null) && (
                  <section className="panel">
                    <div className="panel-heading compact">
                      <h2>Resource utilization (%)</h2>
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
                            />
                            <Area
                              dataKey="cpu"
                              name="CPU mean"
                              stroke="var(--accent)"
                              fill="var(--accent-soft)"
                            />
                            <Area
                              dataKey="cpu_max"
                              name="CPU max"
                              stroke="var(--warning)"
                              fill="none"
                            />
                            <Area
                              dataKey="memory"
                              name="Memory mean"
                              stroke="var(--good)"
                              fill="none"
                            />
                            <Area
                              dataKey="disk"
                              name="Disk mean"
                              stroke="var(--muted)"
                              fill="none"
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
                <h2>Events</h2>
                <span className="count">{events.length}</span>
              </div>
              <div className="events-pad">
                {events.length ? (
                  events.map((e: Row) => (
                    <div className="event-line" key={e.id}>
                      <strong>{e.type}</strong>
                      <small className="mono">{when(e.at)}</small>
                      <pre>{e.data}</pre>
                    </div>
                  ))
                ) : (
                  <p className="muted">No events in this range.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </Stage>
  );
}
