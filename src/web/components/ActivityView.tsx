import {
  ArrowUpRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, when } from "../client";
import {
  formatNumber,
  localizeMessage,
  t as translate,
} from "../i18n";
import { alertLabel, eventLabel, operationLabel, taskLabel } from "../labels";
import type { Row, State } from "../types";
import { LogsModal } from "./inspectors";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  SearchInput,
  SegmentedControl,
} from "./primitives";
import { ScrollArea } from "./Scrollbars";
import { Select } from "./Select";
import { VirtualList } from "./VirtualList";

type SubTab = "alerts" | "tasks" | "events";
type AlertStatus = "open" | "unread" | "closed" | "all";
type TaskFilter = "all" | "active" | "failed" | "succeeded";
type EventCategory = "all" | "credentials" | "traffic" | "config";

const BATCH_SIZE = 30;

function summarizeEventData(raw: string): string {
  if (!raw || raw.trim() === "{}") return "";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return raw;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object") {
        parts.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        parts.push(`${k}: ${String(v)}`);
      }
      if (parts.length >= 3) break;
    }
    return parts.join(" · ");
  } catch {
    return raw;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ActivityView({
  state,
  onMutate,
  onInspectHost,
  onInspectUser,
  onInspectControlPlane,
  onOpenModal,
}: {
  state: State;
  onMutate: (
    path: string,
    body?: unknown,
    method?: string,
    message?: string,
  ) => Promise<any>;
  onInspectHost: (hostId: string) => void;
  onInspectUser: (userId: string) => void;
  onInspectControlPlane: () => void;
  onOpenModal: (render: () => React.ReactNode) => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("alerts");
  const [alertStatus, setAlertStatus] = useState<AlertStatus>("open");
  const [alertCode, setAlertCode] = useState("");
  const [taskState, setTaskState] = useState<TaskFilter>("all");
  const [hideKick, setHideKick] = useState(true);
  const [eventCategory, setEventCategory] = useState<EventCategory>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [alertCounts, setAlertCounts] = useState({
    open: 0,
    unread: 0,
    closed: 0,
    all: 0,
  });
  const [alertCodes, setAlertCodes] = useState<string[]>([]);
  const [taskCounts, setTaskCounts] = useState({
    all: 0,
    active: 0,
    failed: 0,
    succeeded: 0,
    hiddenKicks: 0,
  });

  const nextOffsetRef = useRef(0);
  const itemsLenRef = useRef(0);
  itemsLenRef.current = items.length;
  const refreshControllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const [scrollResetNonce, setScrollResetNonce] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const filterKey = `${subTab}|${alertStatus}|${alertCode}|${taskState}|${hideKick}|${eventCategory}|${debouncedQuery}`;
  const prevFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    setFilterOpen(false);
  }, [subTab]);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        filterWrapRef.current?.contains(target) ||
        target?.closest(".ui-select-menu")
      ) {
        return;
      }
      setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const hasCustomFilter =
    subTab === "alerts"
      ? alertStatus !== "open" || alertCode !== ""
      : subTab === "tasks"
        ? taskState !== "all" || !hideKick
        : eventCategory !== "all";

  const resetFilters = () => {
    if (subTab === "alerts") {
      setAlertStatus("open");
      setAlertCode("");
    } else if (subTab === "tasks") {
      setTaskState("all");
      setHideKick(true);
    } else {
      setEventCategory("all");
    }
  };

  const buildEndpoint = useCallback(
    (offset: number, pageSize: number) => {
      const params = new URLSearchParams({
        offset: String(offset),
        pageSize: String(pageSize),
      });
      if (debouncedQuery) params.set("q", debouncedQuery);

      let endpoint = "activity/alerts";
      if (subTab === "alerts") {
        params.set("status", alertStatus);
        if (alertCode) params.set("code", alertCode);
      } else if (subTab === "tasks") {
        endpoint = "activity/tasks";
        params.set("state", taskState);
        params.set("hideKick", hideKick ? "1" : "0");
      } else {
        endpoint = "activity/events";
        params.set("category", eventCategory);
      }
      return `${endpoint}?${params.toString()}`;
    },
    [
      subTab,
      alertStatus,
      alertCode,
      taskState,
      hideKick,
      eventCategory,
      debouncedQuery,
    ],
  );

  useEffect(() => {
    const filterChanged = prevFilterKeyRef.current !== filterKey;
    prevFilterKeyRef.current = filterKey;
    if (filterChanged) {
      setExpandedRow(null);
      setItems([]);
    }
    setExhausted(false);
    setLoadMoreError(false);
    const load = (isInitial: boolean) => {
      refreshControllerRef.current?.abort();
      const controller = new AbortController();
      refreshControllerRef.current = controller;
      setRefreshing(true);
      moreControllerRef.current?.abort();
      moreControllerRef.current = null;
      setLoadingMore(false);
      if (isInitial) setLoading(true);

      const loadedCount = isInitial && filterChanged ? 0 : itemsLenRef.current;
      // Reconcile the entire loaded window in clean server-aligned chunks (max 5 chunks = 900 rows);
      // beyond 900 rows reset cleanly to the top batch to avoid stale tails or offset drift.
      const resetWindow = loadedCount > 900;
      const targetWindow = resetWindow
        ? BATCH_SIZE
        : Math.max(BATCH_SIZE, loadedCount);
      const CHUNK = 180;

      const fetchWindow = async () => {
        const merged: Row[] = [];
        const seen = new Set<string>();
        let offset = 0;
        let lastRes: any = null;
        let remaining = targetWindow;

        while (remaining > 0) {
          const size = Math.min(CHUNK, remaining);
          const res = await api(
            buildEndpoint(offset, size),
            "GET",
            undefined,
            controller.signal,
          );
          lastRes = res;
          const batch: Row[] = res.items || [];
          for (const row of batch) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              merged.push(row);
            }
          }
          offset =
            typeof res.nextOffset === "number"
              ? res.nextOffset
              : offset + batch.length;
          remaining -= size;
          if (!res.hasMore || batch.length < size) break;
        }
        return { merged, offset, lastRes };
      };

      void fetchWindow()
        .then(({ merged, offset, lastRes }) => {
          if (refreshControllerRef.current === controller && lastRes) {
            const nextTotal = lastRes.total ?? 0;
            setItems(merged);
            setTotal(nextTotal);
            nextOffsetRef.current = offset;
            setExhausted(
              lastRes.hasMore === false ||
                offset >= nextTotal ||
                merged.length === 0,
            );
            setLoadMoreError(false);
            if (resetWindow) setScrollResetNonce((n) => n + 1);
            if (subTab === "alerts") {
              if (lastRes.counts) setAlertCounts(lastRes.counts);
              if (Array.isArray(lastRes.codes)) setAlertCodes(lastRes.codes);
            } else if (subTab === "tasks" && lastRes.counts) {
              setTaskCounts(lastRes.counts);
            }
          }
        })
        .catch((err) => {
          if (
            refreshControllerRef.current === controller &&
            err?.name !== "AbortError"
          ) {
            if (isInitial) {
              setItems([]);
              setTotal(0);
              nextOffsetRef.current = 0;
            }
          }
        })
        .finally(() => {
          if (refreshControllerRef.current !== controller) return;
          refreshControllerRef.current = null;
          setRefreshing(false);
          setLoading(false);
        });
    };

    load(true);
    const timer = setInterval(() => load(false), 30000);
    return () => {
      clearInterval(timer);
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      moreControllerRef.current?.abort();
      moreControllerRef.current = null;
    };
  }, [filterKey, buildEndpoint, subTab, refreshTick]);

  const hasMore = !exhausted && items.length < total;

  const loadMore = useCallback(() => {
    if (refreshControllerRef.current || moreControllerRef.current || !hasMore)
      return;
    setLoadingMore(true);
    setLoadMoreError(false);
    const offsetToLoad = nextOffsetRef.current;
    const controller = new AbortController();
    moreControllerRef.current = controller;

    api(
      buildEndpoint(offsetToLoad, BATCH_SIZE),
      "GET",
      undefined,
      controller.signal,
    )
      .then((res) => {
        if (moreControllerRef.current !== controller) return;
        const incoming: Row[] = res.items || [];
        const nextTotal = res.total ?? 0;
        const nextOff =
          typeof res.nextOffset === "number"
            ? res.nextOffset
            : offsetToLoad + incoming.length;
        nextOffsetRef.current = nextOff;
        if (res.hasMore === false || incoming.length < BATCH_SIZE) {
          setExhausted(true);
        }
        setItems((prev) => {
          if (!incoming.length) return prev;
          const seen = new Set(prev.map((x) => x.id));
          const unique = incoming.filter((x) => !seen.has(x.id));
          return unique.length ? [...prev, ...unique] : prev;
        });
        setTotal(nextTotal);
        if (subTab === "alerts" && res.counts) setAlertCounts(res.counts);
        else if (subTab === "tasks" && res.counts) setTaskCounts(res.counts);
      })
      .catch((err) => {
        if (
          moreControllerRef.current === controller &&
          err?.name !== "AbortError"
        ) {
          setLoadMoreError(true);
        }
      })
      .finally(() => {
        if (moreControllerRef.current === controller) {
          moreControllerRef.current = null;
          setLoadingMore(false);
        }
      });
  }, [hasMore, buildEndpoint, subTab]);

  const now = Date.now();
  const workerAlive = (name: string) => {
    const hb = state.workers.find((w) => w.name === name);
    return !!hb && now - hb.at <= 30000;
  };

  const openAlerts = state.alerts.filter((a) => !a.closed);
  const openCount = state.activitySummary?.openAlerts ?? openAlerts.length;
  const unreadCount =
    state.activitySummary?.unreadAlerts ??
    openAlerts.filter((a) => !a.seen).length;
  const activeTaskCount =
    state.activitySummary?.activeTasks ??
    state.tasks.filter((t) => ["queued", "running"].includes(t.state)).length;

  const runAction = async (
    path: string,
    body?: unknown,
    method = "POST",
    message = "Saved",
  ) => {
    try {
      await onMutate(path, body, method, message);
      setRefreshTick((n) => n + 1);
    } catch {}
  };

  const resolveLocalEntity = (entityId: string, row?: Row) => {
    if (entityId === "platform") {
      return { label: translate("Platform"), jump: null as (() => void) | null, archived: false };
    }
    if (entityId === "control-plane") {
      return {
        label: translate("Control Plane"),
        jump: onInspectControlPlane,
        archived: false,
      };
    }
    const host = state.hosts.find((h) => h.id === entityId);
    if (host) {
      return {
        label: host.name,
        jump: () => onInspectHost(host.id),
        archived: false,
      };
    }
    const node = state.nodes.find((n) => n.id === entityId);
    if (node) {
      return {
        label: node.name,
        jump: () => onInspectHost(node.hostId),
        archived: false,
      };
    }
    const user = state.users.find((u) => u.id === entityId);
    if (user) {
      return {
        label: user.name,
        jump: () => onInspectUser(user.id),
        archived: false,
      };
    }
    if (row?.entityName) {
      return {
        label: row.entityName as string,
        jump:
          !row.entityDeleted && row.entityKind === "host"
            ? () => onInspectHost(entityId)
            : !row.entityDeleted && row.entityKind === "node" && row.entityHostId
              ? () => onInspectHost(row.entityHostId)
              : !row.entityDeleted && row.entityKind === "user"
                ? () => onInspectUser(entityId)
                : null,
        archived: Boolean(row.entityDeleted),
      };
    }
    return {
      label: translate("Removed"),
      jump: null as (() => void) | null,
      archived: true,
    };
  };

  const renderEntityChip = (entityId: string | null | undefined, row?: Row) => {
    if (!entityId) return null;
    const info = resolveLocalEntity(entityId, row);
    if (info.jump) {
      return (
        <button
          type="button"
          className="chip activity-entity-link"
          onClick={(e) => {
            e.stopPropagation();
            info.jump?.();
          }}
        >
          <span>{info.label}</span>
          <ArrowUpRight size={11} aria-hidden="true" />
        </button>
      );
    }
    return (
      <Chip>
        {info.label}
        {info.archived ? ` · ${translate("Archived")}` : ""}
      </Chip>
    );
  };

  const openLogs = (task: Row, hostLabel: string) => {
    void api(`tasks/${task.id}/logs`).then((logs) =>
      onOpenModal(() => (
        <LogsModal
          title={`${operationLabel(task.kind)} · ${hostLabel}`}
          logs={logs || []}
          onClose={() => onOpenModal(() => null)}
        />
      )),
    );
  };

  const getRowKey = useCallback((row: Row) => String(row.id), []);

  return (
    <div className="activity-stack">
      <div className="activity-triage-grid">
        <section
          className={
            "panel activity-triage-panel" + (openCount > 0 ? " is-warn" : "")
          }
        >
          <div className="activity-triage-head">
            <div className="chip-group">
              <h2>{translate("Open Alerts")}</h2>
              <span className={"count" + (openCount > 0 ? " warn" : "")}>
                {formatNumber(openCount)}
              </span>
              {unreadCount > 0 && (
                <Badge tone="warning">
                  {translate("{0} unread", formatNumber(unreadCount))}
                </Badge>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                variant="subtle"
                onClick={() =>
                  void runAction(
                    "alerts/read-all",
                    { openOnly: true },
                    "POST",
                    "Marked all read",
                  )
                }
              >
                <CheckCheck size={14} aria-hidden="true" />
                <span>{translate("Mark all read")}</span>
              </Button>
            )}
          </div>
          {openAlerts.length === 0 ? (
            <div className="activity-triage-clear">
              <ShieldCheck size={18} className="good-icon" aria-hidden="true" />
              <div>
                <strong>{translate("All quiet")}</strong>
                <p className="muted">
                  {translate("No open alerts right now.")}
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea axis="y" className="activity-triage-scroll">
              <div className="activity-triage-list">
                {openAlerts.map((a) => (
                  <div className="activity-triage-row" key={a.id}>
                    <span className="alert-mark" />
                    <div className="activity-triage-main">
                      <div className="activity-row-title">
                        <strong>{alertLabel(a.code)}</strong>
                        {renderEntityChip(a.entity)}
                        {!a.seen && (
                          <Badge tone="warning">{translate("Unread")}</Badge>
                        )}
                      </div>
                      <p className="activity-truncate muted">
                        {localizeMessage(a.message)}
                      </p>
                      <small className="mono muted">
                        {when(a.first)} → {when(a.last)}
                      </small>
                    </div>
                    <div className="row-buttons">
                      {!a.seen && (
                        <Button
                          onClick={() =>
                            void runAction(
                              `alerts/${a.id}/read`,
                              undefined,
                              "POST",
                              "Marked read",
                            )
                          }
                        >
                          <Check size={13} />
                          {translate("Read")}
                        </Button>
                      )}
                      <Button
                        onClick={() =>
                          void runAction(
                            `alerts/${a.id}/close`,
                            undefined,
                            "POST",
                            "Closed",
                          )
                        }
                      >
                        <X size={13} />
                        {translate("Close")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>

        <section className="panel activity-triage-panel">
          <div className="activity-triage-head">
            <div className="chip-group">
              <h2>{translate("Active Tasks & Workers")}</h2>
              {activeTaskCount > 0 && (
                <Chip mono>
                  {translate("{0} running", formatNumber(activeTaskCount))}
                </Chip>
              )}
            </div>
            <div className="chip-group">
              {(["monitor", "operations"] as const).map((name) => {
                const ok = workerAlive(name);
                return (
                  <Badge key={name} tone={ok ? "good" : "warning"}>
                    {name} · {ok ? translate("Healthy") : translate("Stale")}
                  </Badge>
                );
              })}
            </div>
          </div>
          {state.tasks.length === 0 ? (
            <div className="activity-triage-clear">
              <CheckCircle2
                size={18}
                className="good-icon"
                aria-hidden="true"
              />
              <div>
                <strong>{translate("No active tasks")}</strong>
                <p className="muted">
                  {translate("No running, queued, or recent failed tasks.")}
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea axis="y" className="activity-triage-scroll">
              <div className="activity-triage-list">
                {state.tasks.map((t) => {
                  const host = state.hosts.find((h) => h.id === t.host);
                  const hostLabel = host?.name || translate("Removed");
                  return (
                    <div className="activity-triage-row" key={t.id}>
                      <span
                        className={"op-icon " + t.state}
                        aria-label={translate(
                          "Task state {0}",
                          taskLabel(t.state),
                        )}
                        role="img"
                      >
                        {t.state === "failed" ? (
                          <XCircle size={15} />
                        ) : t.state === "running" ? (
                          <RefreshCw size={14} className="spinning" />
                        ) : (
                          <Clock size={14} />
                        )}
                      </span>
                      <div className="activity-triage-main">
                        <div className="activity-row-title">
                          <strong>{operationLabel(t.kind)}</strong>
                          {host ? (
                            <button
                              type="button"
                              className="chip activity-entity-link"
                              onClick={() => onInspectHost(host.id)}
                            >
                              <span>{host.name}</span>
                              <ArrowUpRight size={11} aria-hidden="true" />
                            </button>
                          ) : (
                            <Chip>{hostLabel}</Chip>
                          )}
                          <Chip mono>{translate("Step {0}", t.step)}</Chip>
                        </div>
                        {t.error ? (
                          <p className="activity-truncate op-error">
                            {translate("Operation failed. {0}", t.error)}
                          </p>
                        ) : (
                          <small className="mono muted">
                            {taskLabel(t.state)} · {when(t.updated)}
                          </small>
                        )}
                      </div>
                      <div className="row-buttons">
                        <Button
                          variant="subtle"
                          onClick={() => openLogs(t, hostLabel)}
                        >
                          <Terminal size={13} />
                          {translate("Logs")}
                        </Button>
                        {["queued", "running"].includes(t.state) && (
                          <Button
                            aria-label={translate("Cancel operation")}
                            onClick={() =>
                              void runAction(
                                `tasks/${t.id}/cancel`,
                                undefined,
                                "POST",
                                "Queued",
                              )
                            }
                          >
                            <X size={13} />
                          </Button>
                        )}
                        {["failed", "cancelled"].includes(t.state) && (
                          <Button
                            aria-label={translate("Retry operation")}
                            onClick={() =>
                              void runAction(
                                `tasks/${t.id}/retry`,
                                undefined,
                                "POST",
                                "Queued",
                              )
                            }
                          >
                            <RotateCw size={13} />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </section>
      </div>

      <section className="panel activity-history-panel">
        <div className="activity-history-head">
          <SegmentedControl
            value={subTab}
            options={[
              ["alerts", translate("Alerts")],
              ["tasks", translate("Operations")],
              ["events", translate("Audit Events")],
            ]}
            onChange={setSubTab}
          />
          <div className="activity-history-tools">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={
                subTab === "alerts"
                  ? translate("Filter alerts, hosts, users…")
                  : subTab === "tasks"
                    ? translate("Filter operations, hosts, errors…")
                    : translate("Filter audit events…")
              }
            />
            <div className="activity-filter-wrap" ref={filterWrapRef}>
              <Button
                variant="icon"
                className={
                  "activity-filter-btn" +
                  (filterOpen || hasCustomFilter ? " active" : "")
                }
                aria-label={translate("Filters")}
                aria-expanded={filterOpen}
                aria-haspopup="dialog"
                title={translate("Filters")}
                onClick={() => setFilterOpen((v) => !v)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                {hasCustomFilter && (
                  <span className="activity-filter-dot" aria-hidden="true" />
                )}
              </Button>
              {filterOpen && (
                <div
                  className="activity-filter-popover"
                  role="dialog"
                  aria-label={translate("Filters")}
                >
                  <div className="activity-filter-head">
                    <strong>{translate("Filters")}</strong>
                    {hasCustomFilter && (
                      <Button variant="text" onClick={resetFilters}>
                        {translate("Reset")}
                      </Button>
                    )}
                  </div>

                  {subTab === "alerts" && (
                    <>
                      <div className="activity-filter-section">
                        <span className="kpi-label">{translate("STATUS")}</span>
                        <div className="activity-filter-pills">
                          {(
                            [
                              ["open", translate("Open"), alertCounts.open],
                              ["unread", translate("Unread"), alertCounts.unread],
                              ["closed", translate("Closed"), alertCounts.closed],
                              ["all", translate("All"), alertCounts.all],
                            ] as const
                          ).map(([val, lbl, cnt]) => (
                            <button
                              key={val}
                              type="button"
                              className={
                                "activity-filter-pill" +
                                (alertStatus === val ? " active" : "")
                              }
                              onClick={() => setAlertStatus(val)}
                            >
                              <span>{lbl}</span>
                              <span className="mono">{formatNumber(cnt)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {alertCodes.length > 0 && (
                        <div className="activity-filter-section">
                          <span className="kpi-label">
                            {translate("ALERT TYPE")}
                          </span>
                          <Select
                            unclipped
                            value={alertCode}
                            onChange={setAlertCode}
                            options={[
                              { value: "", label: translate("All alert types") },
                              ...alertCodes.map((c) => ({
                                value: c,
                                label: alertLabel(c),
                              })),
                            ]}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {subTab === "tasks" && (
                    <>
                      <div className="activity-filter-section">
                        <span className="kpi-label">{translate("STATE")}</span>
                        <div className="activity-filter-pills">
                          {(
                            [
                              ["all", translate("All"), taskCounts.all],
                              ["active", translate("Active"), taskCounts.active],
                              ["failed", translate("Failed"), taskCounts.failed],
                              [
                                "succeeded",
                                translate("Succeeded"),
                                taskCounts.succeeded,
                              ],
                            ] as const
                          ).map(([val, lbl, cnt]) => (
                            <button
                              key={val}
                              type="button"
                              className={
                                "activity-filter-pill" +
                                (taskState === val ? " active" : "")
                              }
                              onClick={() => setTaskState(val)}
                            >
                              <span>{lbl}</span>
                              <span className="mono">{formatNumber(cnt)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="activity-filter-section">
                        <Checkbox checked={hideKick} onChange={setHideKick}>
                          {translate(
                            "Hide kick tasks ({0})",
                            formatNumber(taskCounts.hiddenKicks),
                          )}
                        </Checkbox>
                      </div>
                    </>
                  )}

                  {subTab === "events" && (
                    <div className="activity-filter-section">
                      <span className="kpi-label">{translate("CATEGORY")}</span>
                      <div className="activity-filter-pills">
                        {(
                          [
                            ["all", translate("All")],
                            ["credentials", translate("Credentials")],
                            ["traffic", translate("Traffic")],
                            ["config", translate("Configuration")],
                          ] as const
                        ).map(([val, lbl]) => (
                          <button
                            key={val}
                            type="button"
                            className={
                              "activity-filter-pill" +
                              (eventCategory === val ? " active" : "")
                            }
                            onClick={() => setEventCategory(val)}
                          >
                            <span>{lbl}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="icon"
              className="activity-filter-btn"
              aria-label={translate("Refresh")}
              title={translate("Refresh")}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              <RefreshCw
                size={14}
                className={loading ? "spinning" : ""}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="activity-empty muted">
            {translate("Loading activity…")}
          </div>
        ) : items.length === 0 ? (
          subTab === "alerts" &&
          alertStatus === "open" &&
          !debouncedQuery &&
          !alertCode ? (
            <div className="quiet radar-quiet">
              <span className="quiet-ring">
                <ShieldCheck size={24} />
              </span>
              <h3>{translate("All quiet")}</h3>
              {alertCounts.all > 0 && (
                <Button onClick={() => setAlertStatus("all")}>
                  {translate("View all history ({0})", formatNumber(alertCounts.all))}
                </Button>
              )}
            </div>
          ) : (
            <div className="activity-empty muted">
              {translate("No matching records.")}
            </div>
          )
        ) : (
          <VirtualList
            items={items}
            getKey={getRowKey}
            estimateHeight={64}
            overscan={8}
            hasMore={hasMore && !refreshing && !loadMoreError}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            resetKey={`${filterKey}#${scrollResetNonce}`}
            className="activity-virtual-scroll"
            footer={
              loadingMore ? (
                <div className="activity-load-more muted">
                  <LoaderCircle
                    size={14}
                    className="spinning"
                    aria-hidden="true"
                  />
                  <span>{translate("Loading more…")}</span>
                </div>
              ) : loadMoreError ? (
                <div className="activity-load-more activity-load-error" role="alert">
                  <span>{translate("Failed to load more records.")}</span>
                  <Button onClick={loadMore}>{translate("Retry")}</Button>
                </div>
              ) : null
            }
            renderItem={(row) => {
              if (subTab === "alerts") {
                const a = row;
                const isOpen = expandedRow === a.id;
                const msg = localizeMessage(a.message);
                return (
                  <div
                    className={
                      "activity-row" +
                      (a.closed ? " is-closed" : "") +
                      (isOpen ? " is-expanded" : "")
                    }
                  >
                    <span
                      className={
                        "status-dot " + (a.closed ? "good" : "warning")
                      }
                    />
                    <div className="activity-row-main">
                      <div className="activity-row-title">
                        <strong>{alertLabel(a.code)}</strong>
                        {renderEntityChip(a.entity, a)}
                        <Badge tone={a.closed ? "neutral" : "warning"}>
                          {a.closed
                            ? translate("Closed")
                            : a.seen
                              ? translate("Read")
                              : translate("Open")}
                        </Badge>
                      </div>
                      <button
                        type="button"
                        className="activity-disclosure-btn"
                        aria-expanded={isOpen}
                        onClick={() => setExpandedRow(isOpen ? null : a.id)}
                      >
                        <span
                          className={
                            isOpen
                              ? "activity-full-text muted"
                              : "activity-truncate muted"
                          }
                        >
                          {msg}
                        </span>
                        {isOpen ? (
                          <ChevronUp size={13} className="activity-disclosure-icon" aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} className="activity-disclosure-icon" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <span className="activity-row-time mono muted">
                      {when(a.first)} → {when(a.last)}
                    </span>
                    <div className="row-buttons">
                      {!a.seen && (
                        <Button
                          onClick={() =>
                            void runAction(
                              `alerts/${a.id}/read`,
                              undefined,
                              "POST",
                              "Marked read",
                            )
                          }
                        >
                          <Check size={13} />
                          {translate("Read")}
                        </Button>
                      )}
                      {!a.closed && (
                        <Button
                          onClick={() =>
                            void runAction(
                              `alerts/${a.id}/close`,
                              undefined,
                              "POST",
                              "Closed",
                            )
                          }
                        >
                          <X size={13} />
                          {translate("Close")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              }

              if (subTab === "tasks") {
                const t = row;
                const isOpen = expandedRow === t.id;
                const hostLabel = t.hostName || translate("Removed");
                const canJumpHost =
                  !t.hostDeleted && state.hosts.some((h) => h.id === t.host);
                return (
                  <div
                    className={"activity-row" + (isOpen ? " is-expanded" : "")}
                  >
                    <span
                      className={"op-icon " + t.state}
                      aria-label={translate(
                        "Task state {0}",
                        taskLabel(t.state),
                      )}
                      role="img"
                    >
                      {t.state === "succeeded" ? (
                        <CheckCircle2 size={15} />
                      ) : t.state === "failed" ? (
                        <XCircle size={15} />
                      ) : t.state === "running" ? (
                        <RefreshCw size={14} className="spinning" />
                      ) : (
                        <Clock size={14} />
                      )}
                    </span>
                    <div className="activity-row-main">
                      <div className="activity-row-title">
                        <strong>{operationLabel(t.kind)}</strong>
                        {canJumpHost ? (
                          <button
                            type="button"
                            className="chip activity-entity-link"
                            onClick={() => onInspectHost(t.host)}
                          >
                            <span>{hostLabel}</span>
                            <ArrowUpRight size={11} aria-hidden="true" />
                          </button>
                        ) : (
                          <Chip>
                            {hostLabel}
                            {t.hostDeleted ? ` · ${translate("Archived")}` : ""}
                          </Chip>
                        )}
                        <Chip mono>{translate("Step {0}", t.step)}</Chip>
                        <Badge
                          tone={
                            t.state === "succeeded"
                              ? "good"
                              : t.state === "failed"
                                ? "danger"
                                : t.state === "running"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {taskLabel(t.state)}
                        </Badge>
                      </div>
                      {t.error && (
                        <button
                          type="button"
                          className="activity-disclosure-btn is-error"
                          aria-expanded={isOpen}
                          onClick={() => setExpandedRow(isOpen ? null : t.id)}
                        >
                          <span
                            className={
                              isOpen
                                ? "activity-full-text op-error"
                                : "activity-truncate op-error"
                            }
                          >
                            {translate("Operation failed. {0}", t.error)}
                          </span>
                          {isOpen ? (
                            <ChevronUp size={13} className="activity-disclosure-icon" aria-hidden="true" />
                          ) : (
                            <ChevronDown size={13} className="activity-disclosure-icon" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                    <span className="activity-row-time mono muted">
                      {when(t.updated)}
                    </span>
                    <div className="row-buttons">
                      <Button
                        variant="subtle"
                        onClick={() => openLogs(t, hostLabel)}
                      >
                        <Terminal size={13} />
                        {translate("Logs")}
                      </Button>
                      {["queued", "running"].includes(t.state) && (
                        <Button
                          aria-label={translate("Cancel operation")}
                          onClick={() =>
                            void runAction(
                              `tasks/${t.id}/cancel`,
                              undefined,
                              "POST",
                              "Queued",
                            )
                          }
                        >
                          <X size={13} />
                        </Button>
                      )}
                      {["failed", "cancelled"].includes(t.state) && (
                        <Button
                          aria-label={translate("Retry operation")}
                          onClick={() =>
                            void runAction(
                              `tasks/${t.id}/retry`,
                              undefined,
                              "POST",
                              "Queued",
                            )
                          }
                        >
                          <RotateCw size={13} />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              }

              const ev = row;
              const isOpen = expandedRow === ev.id;
              const summary = summarizeEventData(ev.data);
              const detailId = `event-detail-${ev.id}`;
              return (
                <div
                  className={
                    "activity-row activity-event-row" +
                    (isOpen ? " is-expanded" : "")
                  }
                >
                  <span className="status-dot accent" />
                  <div className="activity-row-main">
                    <div className="activity-row-title">
                      <strong>{eventLabel(ev.type)}</strong>
                      {renderEntityChip(ev.entity, ev)}
                    </div>
                    {summary && (
                      <button
                        type="button"
                        className="activity-disclosure-btn"
                        aria-expanded={isOpen}
                        aria-controls={detailId}
                        onClick={() => setExpandedRow(isOpen ? null : ev.id)}
                      >
                        <span className="activity-truncate mono muted">
                          {summary}
                        </span>
                        {isOpen ? (
                          <ChevronUp size={13} className="activity-disclosure-icon" aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} className="activity-disclosure-icon" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {summary && isOpen && (
                      <pre id={detailId} className="activity-event-json mono">
                        {prettyJson(ev.data)}
                      </pre>
                    )}
                  </div>
                  <span className="activity-row-time mono muted">
                    {when(ev.at)}
                  </span>
                  <div />
                </div>
              );
            }}
          />
        )}

        <div className="activity-pager">
          <span className="mono muted">
            {total === 0
              ? translate("0 records")
              : translate(
                  "Loaded {0} of {1}",
                  formatNumber(items.length),
                  formatNumber(total),
                )}
          </span>
          <span className="muted">
            {loadingMore
              ? translate("Loading more…")
              : loadMoreError
                ? translate("Failed to load more records.")
                : total > 0 && !hasMore
                  ? translate("All records loaded")
                  : hasMore
                    ? translate("Scroll for more")
                    : ""}
          </span>
        </div>
      </section>
    </div>
  );
}
