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
import { Dialog, Empty, Field } from "./components";
import type { Row } from "./types";
export function History({
  entity,
  onClose,
}: {
  entity: Row;
  onClose: () => void;
}) {
  const [range, setRange] = useState("24"),
    [custom, setCustom] = useState({ start: "", end: "" }),
    [data, setData] = useState<Row>({ samples: [], events: [] }),
    [error, setError] = useState("");
  useEffect(() => {
    const end = range === "custom" ? Date.parse(custom.end + "Z") : Date.now(),
      start =
        range === "custom"
          ? Date.parse(custom.start + "Z")
          : end - Number(range) * 3600000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    api(`history/${entity.id}?start=${start}&end=${end}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [range, custom.start, custom.end]);
  const samples = data.samples as Row[],
    observations = samples.filter((p) => p.reachable !== null),
    expected =
      range === "custom"
        ? (Date.parse(custom.end + "Z") - Date.parse(custom.start + "Z")) /
          60000
        : Number(range) * 60,
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
      : null;
  return (
    <Dialog title={`${entity.name} · history`} onClose={onClose} wide>
      <div className="dialog-body">
        <div className="range-tabs">
          {[
            ["24", "24 hours"],
            ["168", "7 days"],
            ["720", "30 days"],
            ["custom", "Custom"],
          ].map(([v, label]) => (
            <button
              className={range === v ? "selected" : ""}
              key={v}
              onClick={() => setRange(v)}
            >
              {label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="form-grid">
            <Field label="Start (UTC)">
              <input
                type="datetime-local"
                value={custom.start}
                onChange={(e) =>
                  setCustom({ ...custom, start: e.target.value })
                }
              />
            </Field>
            <Field label="End (UTC)">
              <input
                type="datetime-local"
                value={custom.end}
                onChange={(e) => setCustom({ ...custom, end: e.target.value })}
              />
            </Field>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        {entity.kind === "host" && (
          <div className="history-stats">
            <span>
              Observed availability{" "}
              <strong>
                {availability === null ? "—" : availability.toFixed(2) + "%"}
              </strong>
            </span>
            <span>
              Monitoring coverage <strong>{coverage.toFixed(1)}%</strong>
            </span>
            <span>
              Host uptime{" "}
              <strong>
                {entity.uptime
                  ? Math.floor(entity.uptime / 86400) +
                    "d " +
                    Math.floor((entity.uptime % 86400) / 3600) +
                    "h"
                  : "—"}
              </strong>
            </span>
          </div>
        )}
        <h3>Traffic</h3>
        {!samples.length ? (
          <Empty title="No observations in this range">
            Unknown periods are not recorded as host downtime.
          </Empty>
        ) : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart
                data={samples.map((p) => ({
                  ...p,
                  time: when(p.at),
                  inMiB: p.inbound / 1024 ** 2,
                  outMiB: p.outbound / 1024 ** 2,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={60} />
                <YAxis tick={{ fontSize: 10 }} width={45} />
                <Tooltip />
                <Area
                  dataKey="outMiB"
                  name="Outbound MiB"
                  stroke="var(--accent)"
                  fill="var(--accent-soft)"
                />
                <Area
                  dataKey="inMiB"
                  name="Inbound MiB"
                  stroke="var(--good)"
                  fill="var(--good-soft)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {entity.kind === "host" && samples.some((p) => p.cpu !== null) && (
          <>
            <h3>Resource utilization (%)</h3>
            <div className="chart">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={samples.map((p) => ({ ...p, time: when(p.at) }))}
                >
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    minTickGap={60}
                  />
                  <YAxis domain={[0, 100]} width={35} />
                  <Tooltip />
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
          </>
        )}
        <h3>Accounting & operation events</h3>
        {data.events.length ? (
          data.events.map((e: Row) => (
            <div className="event-line" key={e.id}>
              <strong>{e.type}</strong>
              <small>{when(e.at)}</small>
              <pre>{e.data}</pre>
            </div>
          ))
        ) : (
          <p className="muted">No events in this range.</p>
        )}
      </div>
    </Dialog>
  );
}
