import {
  AlertCircle,
  Archive,
  ArrowRight,
  Plus,
  Radio,
  Search,
  Server,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  api,
  formatTaskKind,
  nodeStatusLabel,
  parsePayload,
  when,
} from "../client";
import {
  Badge,
  Confirm,
  CopyButton,
  Empty,
  SectionTabs,
  StackDrillDown,
} from "../components";
import { NodeFormPanel } from "../forms";
import { HistoryPanel } from "../history";
import type { Row } from "../types";
import { NodeDeployPanel } from "./NodeDeployPanel";
import type { ViewContext } from "./viewTypes";

export function NodesWorkspace({ ctx }: { ctx: ViewContext }) {
  const {
    state,
    route,
    navigate,
    goBackToRoot,
    linkProps,
    runAction,
    confirmModal,
    closeModal,
    workerOnline,
  } = ctx;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [archived, setArchived] = useState<Row[] | null>(null);
  const [driftDiff, setDriftDiff] = useState<{
    desired: string;
    observed: string | null;
  } | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftError, setDriftError] = useState("");

  const isArchive = route.mode === "archive";
  const subTab = route.sub || "deploy";

  useEffect(() => {
    if (!isArchive) return;
    let cancelled = false;
    void api("archive/nodes")
      .then((rows) => {
        if (!cancelled) setArchived(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setArchived([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isArchive]);

  const sourceList = isArchive ? archived || [] : state.nodes;
  const filtered = sourceList.filter((n) => {
    if (!isArchive && filter === "attention") {
      const lbl = nodeStatusLabel(n, state.hosts);
      const stale = n.probed && Date.now() - n.probed > 600000;
      if (
        lbl === "Running" &&
        !n.drift &&
        n.probe === "healthy" &&
        !stale
      ) {
        return false;
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hostName = state.hosts.find((h) => h.id === n.hostId)?.name || "";
    return [n.name, n.address, hostName, n.version]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const hasDetail = Boolean(route.id || route.mode === "new");
  const selectedNode =
    route.mode === "new"
      ? undefined
      : isArchive
        ? (archived || []).find((n) => n.id === route.id) || filtered[0]
        : state.nodes.find((n) => n.id === route.id) || filtered[0];

  const parentHost = selectedNode
    ? state.hosts.find((h) => h.id === selectedNode.hostId)
    : undefined;

  useEffect(() => {
    if (!selectedNode || isArchive || subTab !== "drift") {
      setDriftDiff(null);
      setDriftError("");
      return;
    }
    let cancelled = false;
    setDriftLoading(true);
    setDriftError("");
    void api(`nodes/${selectedNode.id}/drift`)
      .then((res) => {
        if (!cancelled) setDriftDiff(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setDriftError(
            err instanceof Error ? err.message : "Failed to inspect drift",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDriftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNode?.id, isArchive, subTab]);

  const eligibleTrustedHosts = state.hosts.filter(
    (h) =>
      h.fingerprint &&
      !h.deleting &&
      !state.nodes.some((n) => n.hostId === h.id),
  );

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">ENDPOINTS</p>
            <h1 id="main-heading" tabIndex={-1}>
              Hysteria 2 Nodes
            </h1>
          </div>
          <a
            {...linkProps({ section: "nodes", mode: "new" })}
            className="btn primary compact-button"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Plan node</span>
          </a>
        </div>

        <search className="pane-search">
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Nodes"
              placeholder="Search node, IP, or VPS…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="icon-button search-clear"
                aria-label="Clear search query"
                onClick={() => setSearch("")}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </search>

        <div className="pane-filter-row">
          <div className="segmented-tabs compact" role="tablist" aria-label="List mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isArchive}
              className={!isArchive ? "seg-tab active" : "seg-tab"}
              onClick={() => navigate({ section: "nodes" })}
            >
              Active ({state.nodes.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isArchive}
              className={isArchive ? "seg-tab active" : "seg-tab"}
              onClick={() => navigate({ section: "nodes", mode: "archive" })}
            >
              <Archive size={14} aria-hidden="true" />
              <span>Archive</span>
            </button>
          </div>

          {!isArchive && (
            <div className="filter-pills">
              <button
                type="button"
                className={filter === "all" ? "filter-pill active" : "filter-pill"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={
                  filter === "attention" ? "filter-pill active" : "filter-pill"
                }
                onClick={() => setFilter("attention")}
              >
                Attention
              </button>
            </div>
          )}
        </div>
      </div>

      {isArchive && archived === null ? (
        <progress aria-label="Loading archived nodes" className="flat-progress" />
      ) : !filtered.length ? (
        <Empty
          title={
            search
              ? "No matching nodes"
              : isArchive
                ? "No archived nodes"
                : "No Hysteria 2 nodes yet"
          }
          icon={isArchive ? <Archive size={26} /> : <Radio size={26} />}
          action={
            search ? (
              <button type="button" onClick={() => setSearch("")}>
                Clear search
              </button>
            ) : !isArchive ? (
              <a
                {...linkProps(
                  eligibleTrustedHosts.length
                    ? { section: "nodes", mode: "new" }
                    : { section: "onboard" },
                )}
                className="btn primary"
              >
                <Plus size={17} aria-hidden="true" />
                <span>
                  {eligibleTrustedHosts.length ? "Plan node" : "Onboard VPS"}
                </span>
              </a>
            ) : undefined
          }
        >
          {isArchive
            ? "Deleted nodes keep historical traffic and event records here."
            : search
              ? "Try another node name or address."
              : "Trust a VPS SSH fingerprint first, then plan and deploy its Hysteria 2 node."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="Node list">
          {filtered.map((n) => {
            const active = selectedNode?.id === n.id && route.mode !== "new";
            const label = isArchive ? "Archived" : nodeStatusLabel(n, state.hosts);
            const online = Object.values(n.online || {}).reduce(
              (a: number, b: any) => a + Number(b || 0),
              0,
            );
            return (
              <li key={n.id}>
                <a
                  {...linkProps(
                    isArchive
                      ? { section: "nodes", mode: "archive", id: n.id }
                      : { section: "nodes", id: n.id },
                  )}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span className="flow-medallion lavender" aria-hidden="true">
                      <Radio size={16} />
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{n.name}</strong>
                      <small className="mono">
                        {n.address}:{n.port}
                      </small>
                    </div>
                    <Badge
                      tone={
                        label === "Running"
                          ? "good"
                          : label === "Planned" || label === "Archived"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {label}
                    </Badge>
                  </div>
                  {!isArchive && (
                    <div className="selector-card-meta">
                      <span>
                        {online} {online === 1 ? "instance" : "instances"}
                      </span>
                      <span>
                        {n.drift
                          ? "Config drift"
                          : n.version || "Draft"}
                      </span>
                    </div>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  let detailPane = (
    <div className="surface-card detail-empty">
      <Empty
        title="Select a Hysteria 2 node"
        icon={<Radio size={28} />}
        action={
          <a
            {...linkProps(
              eligibleTrustedHosts.length
                ? { section: "nodes", mode: "new" }
                : { section: "onboard" },
            )}
            className="btn primary"
          >
            <Plus size={17} aria-hidden="true" />
            <span>
              {eligibleTrustedHosts.length ? "Plan node" : "Onboard VPS"}
            </span>
          </a>
        }
      >
        Inspect deployment state, probe health, configuration drift, and active
        client instances.
      </Empty>
    </div>
  );

  if (route.mode === "new") {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <p className="eyebrow">PLAN ENDPOINT</p>
          <h2>Add Hysteria 2 node</h2>
          {!eligibleTrustedHosts.length ? (
            <Empty
              title="No trusted VPS available"
              icon={<Server size={26} />}
              action={
                <a {...linkProps({ section: "onboard" })} className="btn primary">
                  <span>Onboard & verify VPS</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              }
            >
              Each VPS requires a verified SSH fingerprint and can host at most
              one Hysteria 2 node.
            </Empty>
          ) : (
            <NodeFormPanel
              state={state}
              onCancel={() => goBackToRoot("nodes")}
              onSave={async (payload) => {
                const created = await runAction(
                  () => api("nodes", "POST", payload),
                  "Node planned · Deploy when ready",
                );
                navigate({ section: "nodes", id: created.id });
              }}
            />
          )}
        </div>
      </div>
    );
  } else if (selectedNode && isArchive) {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-title-badges">
            <h2>{selectedNode.name}</h2>
            <Badge tone="neutral">Archived</Badge>
          </div>
          <p className="muted-copy mono">
            {selectedNode.address}:{selectedNode.port} · Created{" "}
            {when(selectedNode.created)}
          </p>
        </div>
        <HistoryPanel entity={selectedNode} />
      </div>
    );
  } else if (selectedNode) {
    const label = nodeStatusLabel(selectedNode, state.hosts);
    const probeText = ["Disabled", "Quota exhausted", "Pending deletion"].includes(
      label,
    )
      ? "Probing paused"
      : selectedNode.probed && Date.now() - selectedNode.probed > 600000
        ? "Probe stale"
        : selectedNode.probe || "Not probed";
    const onlineEntries = Object.entries(selectedNode.online || {}).filter(
      ([, count]) => Number(count) > 0,
    );
    const nodeTasks = state.tasks.filter((t) => {
      const p = parsePayload(t.payload);
      return t.host === selectedNode.hostId && p.nodeId === selectedNode.id;
    });

    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{selectedNode.name}</h2>
                <Badge
                  tone={
                    label === "Running"
                      ? "good"
                      : label === "Planned"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {label}
                </Badge>
                {selectedNode.drift && (
                  <Badge tone="warning" icon={<Wrench size={13} />}>
                    Config drift
                  </Badge>
                )}
              </div>
              <p className="muted-copy mono">
                {selectedNode.address}:{selectedNode.port}
                {selectedNode.hopping ? ` · hops ${selectedNode.hopping}` : ""}
                {selectedNode.version ? ` · ${selectedNode.version}` : ""}
              </p>
            </div>

            <div className="detail-actions-row">
              {parentHost && (
                <a
                  {...linkProps({ section: "vps", id: parentHost.id })}
                  className="btn compact-button"
                >
                  <Server size={15} aria-hidden="true" />
                  <span>{parentHost.name}</span>
                </a>
              )}
              <button
                type="button"
                className="compact-button"
                onClick={() =>
                  navigate(
                    { section: "nodes", id: selectedNode.id, sub: "drift" },
                    true,
                  )
                }
              >
                <Wrench size={15} aria-hidden="true" />
                <span>Inspect drift</span>
              </button>
            </div>
          </div>

          <SectionTabs
            active={subTab}
            onChange={(next) =>
              navigate({ section: "nodes", id: selectedNode.id, sub: next }, true)
            }
            tabs={[
              { id: "deploy", label: "Deploy & Health" },
              {
                id: "drift",
                label: "Config Drift",
                badge: selectedNode.drift ? "!" : undefined,
              },
              { id: "history", label: "History" },
              { id: "settings", label: "Settings & Danger" },
            ]}
          />
        </div>

        {subTab === "deploy" && (
          <div className="detail-stack">
            <div className="three-col-kpis">
              <div className="surface-card kpi-mini">
                <span>Service</span>
                <strong>{label}</strong>
              </div>
              <div className="surface-card kpi-mini">
                <span>Connection probe</span>
                <strong>{probeText}</strong>
              </div>
              <div className="surface-card kpi-mini">
                <span>Observed clients</span>
                <strong>
                  {onlineEntries.reduce((s, [, c]) => s + Number(c), 0)} active
                </strong>
              </div>
            </div>

            <NodeDeployPanel
              node={selectedNode}
              operationsWorkerOnline={workerOnline("operations")}
              runAction={runAction}
              onTaskQueued={(taskId) =>
                navigate({ section: "operations", id: taskId })
              }
            />

            <div className="two-col-cards">
              <section className="surface-card">
                <div className="card-head-row">
                  <h3>Online Client Instances</h3>
                  <Users size={16} className="muted-icon" aria-hidden="true" />
                </div>
                {onlineEntries.length ? (
                  <ul className="compact-link-list">
                    {onlineEntries.map(([uid, count]) => {
                      const u = state.users.find((x) => x.id === uid);
                      return (
                        <li key={uid}>
                          <a
                            {...linkProps({ section: "users", id: uid })}
                            className="compact-link-row"
                          >
                            <strong>{u?.name || uid.slice(0, 8)}</strong>
                            <Badge tone="accent">
                              {String(count)}{" "}
                              {Number(count) === 1 ? "instance" : "instances"}
                            </Badge>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted-copy">
                    No active client instances reported by Hysteria 2.
                  </p>
                )}
              </section>

              <section className="surface-card">
                <div className="card-head-row">
                  <h3>Recent Node Operations</h3>
                  <a
                    {...linkProps({ section: "operations" })}
                    className="inline-link"
                  >
                    All operations →
                  </a>
                </div>
                {nodeTasks.length ? (
                  <ul className="compact-link-list">
                    {nodeTasks.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <a
                          {...linkProps({ section: "operations", id: t.id })}
                          className="compact-link-row"
                        >
                          <span>
                            <strong>{formatTaskKind(t.kind)}</strong>{" "}
                            <small className="mono">{when(t.updated)}</small>
                          </span>
                          <Badge
                            tone={
                              t.state === "succeeded"
                                ? "good"
                                : t.state === "failed"
                                  ? "danger"
                                  : "accent"
                            }
                          >
                            {t.state}
                          </Badge>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy">No operations recorded yet.</p>
                )}
              </section>
            </div>
          </div>
        )}

        {subTab === "drift" && (
          <section className="surface-card">
            <div className="card-head-row">
              <div>
                <h3>Desired vs Observed Configuration</h3>
                <p className="muted-copy">
                  Secrets are redacted. Reapply configuration from Deploy &
                  Health to overwrite remote edits.
                </p>
              </div>
              <button
                type="button"
                className="primary compact-button"
                onClick={() =>
                  navigate(
                    { section: "nodes", id: selectedNode.id, sub: "deploy" },
                    true,
                  )
                }
              >
                <span>Go to deploy / reapply</span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>

            {driftLoading && (
              <progress aria-label="Loading config comparison" className="flat-progress" />
            )}
            {driftError && (
              <p className="form-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{driftError}</span>
              </p>
            )}
            {driftDiff && (
              <div className="drift-grid">
                <div className="terminal-card">
                  <div className="terminal-head">
                    <span className="terminal-title">Desired platform config</span>
                    <CopyButton
                      text={driftDiff.desired}
                      label="Copy"
                      variant="compact"
                    />
                  </div>
                  <pre className="terminal-body">{driftDiff.desired}</pre>
                </div>
                <div className="terminal-card">
                  <div className="terminal-head">
                    <span className="terminal-title">Observed remote config</span>
                    {driftDiff.observed && (
                      <CopyButton
                        text={driftDiff.observed}
                        label="Copy"
                        variant="compact"
                      />
                    )}
                  </div>
                  <pre className="terminal-body">
                    {driftDiff.observed || "No remote observation recorded yet."}
                  </pre>
                </div>
              </div>
            )}
          </section>
        )}

        {subTab === "history" && <HistoryPanel entity={selectedNode} />}

        {subTab === "settings" && (
          <div className="detail-stack">
            <section className="surface-card">
              <h3>Node Endpoint Configuration</h3>
              <NodeFormPanel
                node={selectedNode}
                state={state}
                onSave={async (payload) => {
                  await runAction(
                    () => api(`nodes/${selectedNode.id}`, "PUT", payload),
                    "Node updated",
                  );
                }}
              />
            </section>

            <section className="surface-card danger-zone-card">
              <div className="card-head-row">
                <div>
                  <h3>Danger Zone</h3>
                  <p className="muted-copy">
                    Deleting immediately excludes this node from subscriptions
                    and queues remote systemd/binary cleanup.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="danger-outline"
                disabled={!!selectedNode.deleting}
                onClick={() =>
                  confirmModal(
                    <Confirm
                      title={`Delete ${selectedNode.name}?`}
                      action="Delete"
                      danger
                      onClose={closeModal}
                      onConfirm={async () => {
                        await runAction(
                          () => api(`nodes/${selectedNode.id}`, "DELETE"),
                          "Node deletion queued",
                        );
                        closeModal();
                      }}
                    >
                      <p className="body-copy">
                        This node is removed from all user subscriptions
                        immediately. Remote cleanup must succeed before the
                        record archives.
                      </p>
                    </Confirm>,
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>Delete node</span>
              </button>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <StackDrillDown
      hasDetail={hasDetail}
      backLabel="Nodes"
      detailTitle={
        route.mode === "new"
          ? "Plan node"
          : selectedNode?.name || "Node details"
      }
      onBack={() => goBackToRoot("nodes")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="Node selector"
    />
  );
}
