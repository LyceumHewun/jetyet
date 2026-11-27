import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Radio,
  Server,
  Users,
} from "lucide-react";
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
  amount,
  api,
  bucketUnitSuffix,
  fmt,
  formatUptime,
  readTelemetryRange,
  subscribeTelemetryRange,
  when,
  writeTelemetryRange,
} from "../client";
import { formatNumber, t as translate } from "../i18n";
import { alertLabel } from "../labels";
import type { Row, State } from "../types";
import { MiniBar } from "./meters";
import { Badge, Button, Chip, SegmentedControl } from "./primitives";

export function Overview({
  state,
  hostsReachable,
  nodeHealthy,
  totalOnline,
  activeAlerts,
  runningTasks,
  onJumpTab,
  onInspectHost,
  onInspectUser,
  onInspectControlPlane,
}: {
  state: State;
  hostsReachable: number;
  nodeHealthy: number;
  totalOnline: number;
  activeAlerts: Row[];
  runningTasks: number;
  onJumpTab: (tab: "Infra" | "Users" | "Activity") => void;
  onInspectHost: (hostId: string) => void;
  onInspectUser: (userId: string) => void;
  onInspectControlPlane: () => void;
}) {
  const [scope, setScope] = useState<"hosts" | "users">("hosts");
  const [range, setRangeState] = useState<string>(readTelemetryRange);
  const setRange = (next: string) => {
    setRangeState(next);
    writeTelemetryRange(next);
  };
  useEffect(() => subscribeTelemetryRange(setRangeState), []);
  const [topTab, setTopTab] = useState<"hosts" | "users">("hosts");
  const [samples, setSamples] = useState<Row[]>([]);
  const [resolution, setResolution] = useState("hour");
  const [bucketMs, setBucketMs] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;

    const load = (isInitial: boolean) => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const end = Date.now();
      const start = end - Number(range) * 3600000;
      if (isInitial) setLoading(true);
      api(
        `overview/traffic?scope=${scope}&start=${start}&end=${end}&maxPoints=96`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((res) => {
          if (!cancelled && activeController === controller) {
            setSamples(res.samples || []);
            setResolution(res.resolution || "hour");
            setBucketMs(
              typeof res.bucketMs === "number" ? res.bucketMs : undefined,
            );
            setLoading(false);
          }
        })
        .catch((err) => {
          if (
            !cancelled &&
            activeController === controller &&
            err?.name !== "AbortError"
          ) {
            if (isInitial) setSamples([]);
            setLoading(false);
          }
        });
    };

    load(true);
    const timer = setInterval(() => load(false), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      activeController?.abort();
    };
  }, [scope, range]);

  const now = Date.now();
  const unitSuffix = bucketUnitSuffix(bucketMs, resolution);
  const rangeOut = samples.reduce((sum, p) => sum + (p.outbound || 0), 0);
  const rangeIn = samples.reduce((sum, p) => sum + (p.inbound || 0), 0);

  const activeUsers = state.users.filter(
    (u) => u.enabled && !u.exhausted && !(u.expires && Date.parse(u.expires) < now),
  ).length;

  const cp = state.controlPlane;
  const cpFresh = !!cp?.lastSeen && now - cp.lastSeen <= 180000;
  const workerAlive = (name: string) => {
    const hb = state.workers.find((w) => w.name === name);
    return !!hb && now - hb.at <= 30000;
  };

  const entityName = (id: string) => {
    if (id === "platform") return translate("Platform");
    if (id === "control-plane") return translate("Control Plane");
    return (
      state.hosts.find((h) => h.id === id)?.name ||
      state.nodes.find((n) => n.id === id)?.name ||
      state.users.find((u) => u.id === id)?.name ||
      id
    );
  };

  const quotaAlerts: {
    id: string;
    kind: "host" | "user";
    name: string;
    detail: string;
    tone: "warning" | "danger";
  }[] = [];

  for (const h of state.hosts) {
    const used = amount(h);
    const limit = h.quota?.limit;
    if (h.exhausted) {
      quotaAlerts.push({
        id: h.id,
        kind: "host",
        name: h.name,
        detail: `${fmt(used)} / ${limit === null ? "∞" : fmt(limit)}`,
        tone: "danger",
      });
    } else if (limit && limit > 0 && used / limit >= 0.8) {
      quotaAlerts.push({
        id: h.id,
        kind: "host",
        name: h.name,
        detail: `${Math.round((used / limit) * 100)}% · ${fmt(used)} / ${fmt(limit)}`,
        tone: "warning",
      });
    }
  }

  for (const u of state.users) {
    const used = amount(u);
    const limit = u.quota?.limit;
    const expired = u.expires && Date.parse(u.expires) < now;
    if (u.exhausted || expired) {
      quotaAlerts.push({
        id: u.id,
        kind: "user",
        name: u.name,
        detail: expired
          ? translate("Expired")
          : `${fmt(used)} / ${limit === null ? "∞" : fmt(limit)}`,
        tone: "danger",
      });
    } else if (limit && limit > 0 && used / limit >= 0.8) {
      quotaAlerts.push({
        id: u.id,
        kind: "user",
        name: u.name,
        detail: `${Math.round((used / limit) * 100)}% · ${fmt(used)} / ${fmt(limit)}`,
        tone: "warning",
      });
    }
  }

  const unhealthyNodes = state.nodes.filter((n) => {
    const host = state.hosts.find((h) => h.id === n.hostId);
    if (!n.enabled || n.deleting || !host?.enabled || host.exhausted) return false;
    return (
      n.drift ||
      n.service === false ||
      (n.status === "ready" && n.probe === "failed")
    );
  });

  const topSource = topTab === "hosts" ? state.hosts : state.users;
  const topList = [...topSource]
    .map((item) => ({
      item,
      used: amount(item),
      limit: item.quota?.limit ?? null,
    }))
    .sort((a, b) => b.used - a.used)
    .slice(0, 5);
  const topMax = Math.max(1, topList[0]?.used ?? 0);

  const totalWatchItems =
    activeAlerts.length + quotaAlerts.length + unhealthyNodes.length;

  return (
    <div className="overview-stack">
      <div className="overview-kpis">
        <button
          type="button"
          className="overview-kpi-card"
          onClick={() => onJumpTab("Infra")}
        >
          <div className="overview-kpi-head">
            <span className="kpi-label">{translate("REACHABLE VPS")}</span>
            <Server size={15} className="muted" aria-hidden="true" />
          </div>
          <strong className="overview-kpi-val mono">
            {formatNumber(hostsReachable)}
            <span className="muted">/{formatNumber(state.hosts.length)}</span>
          </strong>
          <small className="muted">
            {state.hosts.length === 0
              ? translate("No VPS added yet")
              : hostsReachable === state.hosts.length
                ? translate("All managed VPS reachable")
                : translate(
                    "{0} unreachable or disabled",
                    state.hosts.length - hostsReachable,
                  )}
          </small>
        </button>

        <button
          type="button"
          className="overview-kpi-card"
          onClick={() => onJumpTab("Infra")}
        >
          <div className="overview-kpi-head">
            <span className="kpi-label">{translate("HEALTHY NODES")}</span>
            <Radio size={15} className="muted" aria-hidden="true" />
          </div>
          <strong className="overview-kpi-val mono">
            {formatNumber(nodeHealthy)}
            <span className="muted">/{formatNumber(state.nodes.length)}</span>
          </strong>
          <small className="muted">
            {state.nodes.length === 0
              ? translate("No nodes deployed")
              : unhealthyNodes.length > 0
                ? translate("{0} need attention", unhealthyNodes.length)
                : translate("All active probes passing")}
          </small>
        </button>

        <button
          type="button"
          className="overview-kpi-card"
          onClick={() => onJumpTab("Users")}
        >
          <div className="overview-kpi-head">
            <span className="kpi-label">{translate("ONLINE CLIENTS")}</span>
            <Users size={15} className="muted" aria-hidden="true" />
          </div>
          <strong className="overview-kpi-val mono">
            {formatNumber(totalOnline)}
          </strong>
          <small className="muted">
            {translate(
              "{0}/{1} active users",
              formatNumber(activeUsers),
              formatNumber(state.users.length),
            )}
          </small>
        </button>

        <button
          type="button"
          className={
            "overview-kpi-card" + (activeAlerts.length > 0 ? " is-warn" : "")
          }
          onClick={() => onJumpTab("Activity")}
        >
          <div className="overview-kpi-head">
            <span className="kpi-label">{translate("ALERTS & TASKS")}</span>
            <Activity size={15} className="muted" aria-hidden="true" />
          </div>
          <strong className="overview-kpi-val mono">
            {formatNumber(activeAlerts.length)}
            <span className="overview-kpi-sub muted">
              {" · "}
              {translate("{0} running", formatNumber(runningTasks))}
            </span>
          </strong>
          <small className="muted">
            {activeAlerts.length > 0
              ? translate("Open alerts need review")
              : translate("No active alerts")}
          </small>
        </button>
      </div>

      <div className="overview-main-grid">
        <section className="panel overview-traffic-panel">
          <div className="overview-panel-head">
            <div className="chart-title-group">
              <h2>
                {scope === "hosts"
                  ? translate("All VPS Traffic (MiB{0})", unitSuffix)
                  : translate("All User VPN Traffic (MiB{0})", unitSuffix)}
              </h2>
              <div className="chart-legends">
                <span className="io-legend">
                  <i className="dot-accent" />
                  {translate("↑ Out")} <b className="mono">{fmt(rangeOut)}</b>
                </span>
                <span className="io-legend">
                  <i className="dot-good" />
                  {translate("↓ In")} <b className="mono">{fmt(rangeIn)}</b>
                </span>
              </div>
            </div>
            <div className="overview-panel-controls">
              <SegmentedControl
                value={scope}
                options={[
                  ["hosts", "VPS"],
                  ["users", translate("Users")],
                ]}
                onChange={setScope}
              />
              <SegmentedControl
                value={range}
                options={[
                  ["1", translate("1h")],
                  ["24", translate("24h")],
                  ["168", translate("7d")],
                  ["720", translate("30d")],
                ]}
                onChange={setRange}
              />
            </div>
          </div>

          {loading ? (
            <div className="chart-placeholder muted">
              {translate("Loading telemetry…")}
            </div>
          ) : !samples.length ? (
            <div className="chart-placeholder muted">
              {translate("No observations in this range")}
            </div>
          ) : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={232}>
                <AreaChart
                  margin={{ top: 6, right: 24, left: -4, bottom: 0 }}
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
        </section>

        <section className="panel overview-cp-panel">
          <div className="overview-panel-head">
            <div className="overview-cp-title">
              <span
                className={"status-dot " + (cpFresh ? "good" : "warning")}
              />
              <div>
                <h2>{translate("Control Plane")}</h2>
                <small className="mono muted">
                  {cp?.hostname || translate("Local host")}
                </small>
              </div>
            </div>
            <Button variant="subtle" onClick={onInspectControlPlane}>
              <span>{translate("Details")}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          </div>

          <div className="overview-cp-body">
            {cp ? (
              <>
                <div className="overview-cp-bars">
                  <MiniBar label="CPU" percent={cp.cpu} />
                  <MiniBar label="RAM" percent={cp.memory} />
                  <MiniBar label={translate("Disk")} percent={cp.disk} />
                </div>
                <div className="overview-cp-meta">
                  <div>
                    <span className="kpi-label">{translate("HOST UPTIME")}</span>
                    <strong className="mono">{formatUptime(cp.uptime)}</strong>
                  </div>
                  <div>
                    <span className="kpi-label">{translate("LAST SAMPLE")}</span>
                    <strong className="mono">{when(cp.lastSeen)}</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted overview-cp-empty">
                <Cpu size={15} aria-hidden="true" />
                {translate("Waiting for monitor worker sample…")}
              </p>
            )}

            <div className="overview-workers">
              <span className="kpi-label">{translate("WORKERS")}</span>
              <div className="chip-group">
                {(["monitor", "operations"] as const).map((name) => {
                  const ok = workerAlive(name);
                  return (
                    <Badge key={name} tone={ok ? "good" : "warning"}>
                      {name} · {ok ? translate("Healthy") : translate("Stale")}
                    </Badge>
                  );
                })}
                {cp && cp.networkAvailable === false && (
                  <Badge tone="warning">
                    {translate("Traffic counters unavailable")}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="overview-bottom-grid">
        <section className="panel overview-list-panel">
          <div className="overview-panel-head">
            <div className="chip-group">
              <h2>{translate("Alerts & Quota Watchlist")}</h2>
              {totalWatchItems > 0 && (
                <Chip mono>{formatNumber(totalWatchItems)}</Chip>
              )}
            </div>
            <Button variant="subtle" onClick={() => onJumpTab("Activity")}>
              <span>{translate("Activity")}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          </div>

          {totalWatchItems === 0 ? (
            <div className="overview-clear-state">
              <CheckCircle2 size={18} className="good-icon" aria-hidden="true" />
              <div>
                <strong>{translate("All systems normal")}</strong>
                <p className="muted">
                  {translate(
                    "No open alerts, node issues, or quota warnings right now.",
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="overview-watch-list">
              {activeAlerts.slice(0, 4).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="overview-list-row"
                  onClick={() => onJumpTab("Activity")}
                >
                  <div className="overview-list-row-main">
                    <AlertTriangle
                      size={14}
                      className="warn-icon"
                      aria-hidden="true"
                    />
                    <div className="overview-list-text">
                      <strong>{alertLabel(a.code)}</strong>
                      <small className="muted">
                        {entityName(a.entity)} · {when(a.last)}
                      </small>
                    </div>
                  </div>
                  <Badge tone="warning">{translate("Alert")}</Badge>
                </button>
              ))}
              {unhealthyNodes.slice(0, 3).map((n) => (
                <button
                  key={`node-${n.id}`}
                  type="button"
                  className="overview-list-row"
                  onClick={() => onInspectHost(n.hostId)}
                >
                  <div className="overview-list-row-main">
                    <Radio size={14} className="warn-icon" aria-hidden="true" />
                    <div className="overview-list-text">
                      <strong>{n.name}</strong>
                      <small className="muted mono">
                        {n.address}:{n.port}
                      </small>
                    </div>
                  </div>
                  <Badge tone="warning">
                    {n.drift
                      ? translate("Drift")
                      : n.service === false
                        ? translate("Stopped")
                        : translate("Probe failed")}
                  </Badge>
                </button>
              ))}
              {quotaAlerts.slice(0, 4).map((q) => (
                <button
                  key={`quota-${q.kind}-${q.id}`}
                  type="button"
                  className="overview-list-row"
                  onClick={() =>
                    q.kind === "host"
                      ? onInspectHost(q.id)
                      : onInspectUser(q.id)
                  }
                >
                  <div className="overview-list-row-main">
                    {q.kind === "host" ? (
                      <Server size={14} className="muted" aria-hidden="true" />
                    ) : (
                      <Users size={14} className="muted" aria-hidden="true" />
                    )}
                    <div className="overview-list-text">
                      <strong>{q.name}</strong>
                      <small className="muted mono">{q.detail}</small>
                    </div>
                  </div>
                  <Badge tone={q.tone}>
                    {q.tone === "danger"
                      ? translate("Restricted")
                      : translate("Near limit")}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel overview-list-panel">
          <div className="overview-panel-head">
            <h2>{translate("Top Traffic (Current Period)")}</h2>
            <SegmentedControl
              value={topTab}
              options={[
                ["hosts", "VPS"],
                ["users", translate("Users")],
              ]}
              onChange={setTopTab}
            />
          </div>

          {topList.length === 0 ? (
            <div className="overview-clear-state muted">
              {topTab === "hosts"
                ? translate("No VPS added yet")
                : translate("No users yet")}
            </div>
          ) : (
            <div className="overview-top-list">
              {topList.map(({ item, used, limit }, idx) => {
                const pct =
                  limit && limit > 0
                    ? Math.min(100, (used / limit) * 100)
                    : Math.min(100, (used / topMax) * 100);
                const tone =
                  item.exhausted || (limit && limit > 0 && used >= limit)
                    ? "danger"
                    : limit && limit > 0 && used / limit >= 0.8
                      ? "warning"
                      : "accent";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="overview-top-row"
                    onClick={() =>
                      topTab === "hosts"
                        ? onInspectHost(item.id)
                        : onInspectUser(item.id)
                    }
                  >
                    <div className="overview-top-row-head">
                      <div className="overview-top-name">
                        <span className="overview-rank mono">{idx + 1}</span>
                        <strong>{item.name}</strong>
                      </div>
                      <span className="mono overview-top-val">
                        {fmt(used)}
                        <span className="muted">
                          {" / "}
                          {limit === null ? "∞" : fmt(limit)}
                        </span>
                      </span>
                    </div>
                    <div className="overview-top-track">
                      <i
                        className={tone}
                        style={{ width: `${Math.max(used > 0 ? 2 : 0, pct)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
