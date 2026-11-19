import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Cpu,
  HardDrive,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmt, formatUptime, when } from "../client";
import {
  Badge,
  Confirm,
  Empty,
  QuotaBar,
  SectionTabs,
  StackDrillDown,
} from "../components";
import {
  ForceRemoveDialog,
  HostFormPanel,
  UsageCorrectionPanel,
} from "../forms";
import { HistoryPanel } from "../history";
import type { Row } from "../types";
import { SshTrustPanel } from "./SshTrustPanel";
import type { ViewContext } from "./viewTypes";

export function VpsWorkspace({ ctx }: { ctx: ViewContext }) {
  const {
    state,
    route,
    navigate,
    goBackToRoot,
    linkProps,
    runAction,
    confirmModal,
    closeModal,
  } = ctx;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [archived, setArchived] = useState<Row[] | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const isArchive = route.mode === "archive";
  const subTab = route.sub || "overview";

  useEffect(() => {
    if (!isArchive) return;
    let cancelled = false;
    setArchiveError("");
    void api("archive/hosts")
      .then((rows) => {
        if (!cancelled) setArchived(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setArchived([]);
          setArchiveError(
            err instanceof Error ? err.message : "Failed to load archive",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isArchive]);

  const activeHosts = state.hosts;
  const sourceList = isArchive ? archived || [] : activeHosts;
  const filtered = sourceList.filter((h) => {
    if (!isArchive && filter === "attention") {
      const needsTrust = !h.fingerprint;
      const unreachable = h.enabled && !h.reachable;
      const missingNode =
        h.fingerprint && !state.nodes.some((n) => n.hostId === h.id);
      if (!needsTrust && !unreachable && !missingNode && !h.exhausted && !h.deleting) {
        return false;
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [h.name, h.address, h.username]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const hasDetail = Boolean(route.id || route.mode === "new");
  const selectedHost =
    route.mode === "new"
      ? undefined
      : isArchive
        ? (archived || []).find((h) => h.id === route.id) || filtered[0]
        : activeHosts.find((h) => h.id === route.id) || filtered[0];

  const hostedNode =
    selectedHost && !isArchive
      ? state.nodes.find((n) => n.hostId === selectedHost.id)
      : undefined;

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">INFRASTRUCTURE</p>
            <h1 id="main-heading" tabIndex={-1}>
              VPS Hosts
            </h1>
          </div>
          <a
            {...linkProps({ section: "onboard" })}
            className="btn primary compact-button"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Onboard</span>
          </a>
        </div>

        <search className="pane-search">
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search VPS"
              placeholder="Search VPS name or IP…"
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
              onClick={() => navigate({ section: "vps" })}
            >
              Active ({activeHosts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isArchive}
              className={isArchive ? "seg-tab active" : "seg-tab"}
              onClick={() => navigate({ section: "vps", mode: "archive" })}
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
                Needs attention
              </button>
            </div>
          )}
        </div>
      </div>

      {isArchive && archiveError && (
        <p className="form-error" role="alert">
          {archiveError}
        </p>
      )}

      {isArchive && archived === null ? (
        <progress aria-label="Loading archived VPS hosts" className="flat-progress" />
      ) : !filtered.length ? (
        <Empty
          title={
            search
              ? "No matching VPS hosts"
              : isArchive
                ? "No archived VPS hosts"
                : "No VPS hosts connected"
          }
          icon={isArchive ? <Archive size={26} /> : <Server size={26} />}
          action={
            search ? (
              <button type="button" onClick={() => setSearch("")}>
                Clear search
              </button>
            ) : !isArchive ? (
              <a {...linkProps({ section: "onboard" })} className="btn primary">
                <Plus size={17} aria-hidden="true" />
                <span>Onboard VPS</span>
              </a>
            ) : undefined
          }
        >
          {isArchive
            ? "Deleted VPS hosts keep historical usage and event records here."
            : search
              ? "Try another name, username, or IP address."
              : "Connect a VPS over SSH, verify its host key, and deploy Hysteria 2."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="VPS list">
          {filtered.map((h) => {
            const active = selectedHost?.id === h.id && route.mode !== "new";
            const targetRoute = isArchive
              ? { section: "vps" as const, mode: "archive" as const, id: h.id }
              : { section: "vps" as const, id: h.id };
            return (
              <li key={h.id}>
                <a
                  {...linkProps(targetRoute)}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span className="flow-medallion orchid" aria-hidden="true">
                      <Server size={16} />
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{h.name}</strong>
                      <small className="mono">
                        {h.address}:{h.port}
                      </small>
                    </div>
                    {!isArchive ? (
                      h.deleting ? (
                        <Badge tone="warning">Deleting</Badge>
                      ) : !h.fingerprint ? (
                        <Badge tone="warning" icon={<ShieldAlert size={12} />}>
                          Verify SSH
                        </Badge>
                      ) : (
                        <Badge
                          tone={
                            !h.enabled
                              ? "neutral"
                              : h.reachable
                                ? "good"
                                : "warning"
                          }
                        >
                          {!h.enabled
                            ? "Disabled"
                            : h.reachable
                              ? "Reachable"
                              : "Unreachable"}
                        </Badge>
                      )
                    ) : (
                      <Badge tone="neutral">Archived</Badge>
                    )}
                  </div>
                  {!isArchive && <QuotaBar row={h} compact />}
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
        title="Select a VPS host"
        icon={<Server size={28} />}
        action={
          <a {...linkProps({ section: "onboard" })} className="btn primary">
            <Plus size={17} aria-hidden="true" />
            <span>Onboard new VPS</span>
          </a>
        }
      >
        Pick a VPS from the list to inspect SSH identity, resource utilization,
        traffic allowance, and history.
      </Empty>
    </div>
  );

  if (route.mode === "new") {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="card-head-row">
            <div>
              <p className="eyebrow">NEW HOST</p>
              <h2>Add VPS</h2>
              <p className="muted-copy">
                Prefer guided setup with SSH verification and node deploy?{" "}
                <a {...linkProps({ section: "onboard" })} className="inline-link">
                  Open onboarding flow →
                </a>
              </p>
            </div>
          </div>
          <HostFormPanel
            onCancel={() => goBackToRoot("vps")}
            onSave={async (payload) => {
              const created = await runAction(
                () => api("hosts", "POST", payload),
                "VPS created · Verify SSH fingerprint next",
              );
              navigate({ section: "vps", id: created.id });
            }}
          />
        </div>
      </div>
    );
  } else if (selectedHost && isArchive) {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{selectedHost.name}</h2>
                <Badge tone="neutral">Archived</Badge>
              </div>
              <p className="muted-copy mono">
                {selectedHost.username}@{selectedHost.address}:
                {selectedHost.port} · Created {when(selectedHost.created)}
              </p>
            </div>
          </div>
        </div>
        <HistoryPanel entity={selectedHost} />
      </div>
    );
  } else if (selectedHost) {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{selectedHost.name}</h2>
                {selectedHost.deleting ? (
                  <Badge tone="warning">Pending deletion</Badge>
                ) : !selectedHost.enabled ? (
                  <Badge tone="neutral">Disabled</Badge>
                ) : selectedHost.reachable ? (
                  <Badge tone="good">Reachable</Badge>
                ) : (
                  <Badge tone="warning">Unreachable</Badge>
                )}
                {selectedHost.fingerprint ? (
                  <Badge tone="good" icon={<ShieldCheck size={13} />}>
                    SSH trusted
                  </Badge>
                ) : (
                  <Badge tone="warning" icon={<ShieldAlert size={13} />}>
                    SSH unverified
                  </Badge>
                )}
              </div>
              <p className="muted-copy mono">
                {selectedHost.username}@{selectedHost.address}:
                {selectedHost.port} · Last seen {when(selectedHost.lastSeen)}
              </p>
            </div>

            <div className="detail-actions-row">
              {(!selectedHost.fingerprint || !hostedNode) &&
                !selectedHost.deleting && (
                  <a
                    {...linkProps({ section: "onboard", id: selectedHost.id })}
                    className="btn primary compact-button"
                  >
                    <span>
                      {selectedHost.fingerprint
                        ? "Continue onboarding"
                        : "Verify SSH"}
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </a>
                )}
              {hostedNode && (
                <a
                  {...linkProps({ section: "nodes", id: hostedNode.id })}
                  className="btn compact-button"
                >
                  <Radio size={15} aria-hidden="true" />
                  <span>{hostedNode.name}</span>
                </a>
              )}
              <button
                type="button"
                className="compact-button"
                onClick={() =>
                  confirmModal(
                    <Confirm
                      title={`Reset ${selectedHost.name}'s traffic?`}
                      action="Reset usage"
                      onClose={closeModal}
                      onConfirm={async () => {
                        await runAction(
                          () => api(`usage/${selectedHost.id}/reset`, "POST"),
                          "Usage reset",
                        );
                        closeModal();
                      }}
                    >
                      <p className="body-copy">
                        Zeros current-period counters and removes host quota
                        suspension. History and scheduled reset dates remain
                        unchanged.
                      </p>
                    </Confirm>,
                  )
                }
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Reset usage</span>
              </button>
            </div>
          </div>

          <SectionTabs
            active={subTab}
            onChange={(next) =>
              navigate({ section: "vps", id: selectedHost.id, sub: next }, true)
            }
            tabs={[
              { id: "overview", label: "Overview & SSH" },
              { id: "history", label: "History" },
              { id: "settings", label: "Settings & Danger" },
            ]}
          />
        </div>

        {subTab === "overview" && (
          <div className="detail-stack">
            <SshTrustPanel
              host={selectedHost}
              runAction={runAction}
              onEditConnection={() =>
                navigate(
                  { section: "vps", id: selectedHost.id, sub: "settings" },
                  true,
                )
              }
              onContinue={
                !hostedNode
                  ? () =>
                      navigate({ section: "onboard", id: selectedHost.id })
                  : undefined
              }
              continueLabel="Plan & deploy node"
            />

            <div className="two-col-cards">
              <section className="surface-card">
                <div className="card-head-row">
                  <h3>Host Resources</h3>
                  <span className="mono muted-copy">
                    Uptime {formatUptime(selectedHost.uptime)}
                  </span>
                </div>
                <div className="metric-bars">
                  {[
                    ["CPU", selectedHost.cpu, Cpu],
                    ["Memory", selectedHost.memory, Sliders],
                    ["Disk", selectedHost.disk, HardDrive],
                  ].map(([label, val, Icon]) => {
                    const pct =
                      typeof val === "number" ? Math.min(100, Math.max(0, val)) : null;
                    const IconComp = Icon as typeof Cpu;
                    return (
                      <div className="metric-bar-row" key={label as string}>
                        <div className="metric-bar-head">
                          <span className="metric-bar-label">
                            <IconComp size={15} aria-hidden="true" />
                            <span>{label as string}</span>
                          </span>
                          <strong className="mono">
                            {pct === null ? "—" : `${pct.toFixed(1)}%`}
                          </strong>
                        </div>
                        <div className="quota-track">
                          <span
                            className="quota-fill"
                            style={{
                              "--ratio": String((pct ?? 0) / 100),
                            } as React.CSSProperties}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="surface-card">
                <div className="card-head-row">
                  <h3>Hosted Node</h3>
                  <Badge tone={hostedNode ? "good" : "neutral"}>
                    {hostedNode ? hostedNode.status : "Unplanned"}
                  </Badge>
                </div>
                {hostedNode ? (
                  <div className="hosted-node-box">
                    <p className="body-copy">
                      <strong>{hostedNode.name}</strong> ·{" "}
                      <span className="mono">
                        {hostedNode.address}:{hostedNode.port}
                      </span>
                    </p>
                    <p className="muted-copy">
                      Version {hostedNode.version || "Not deployed"} · Probe{" "}
                      {hostedNode.probe || "Pending"}
                    </p>
                    <a
                      {...linkProps({ section: "nodes", id: hostedNode.id })}
                      className="btn compact-button"
                    >
                      <span>Open node workspace</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </a>
                  </div>
                ) : (
                  <div className="hosted-node-box">
                    <p className="muted-copy">
                      {selectedHost.fingerprint
                        ? "This VPS is trusted and ready for a Hysteria 2 node."
                        : "Verify SSH identity first before planning a node."}
                    </p>
                    <a
                      {...linkProps({ section: "onboard", id: selectedHost.id })}
                      className="btn primary compact-button"
                    >
                      <span>
                        {selectedHost.fingerprint
                          ? "Plan & deploy node"
                          : "Continue onboarding"}
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </a>
                  </div>
                )}
              </section>
            </div>

            <section className="surface-card">
              <div className="card-head-row">
                <div>
                  <h3>Current Accounting Period</h3>
                  <p className="muted-copy">
                    Next scheduled reset: {when(selectedHost.usage?.next)}
                  </p>
                </div>
                {selectedHost.exhausted && (
                  <Badge tone="danger">Quota exhausted</Badge>
                )}
              </div>

              <QuotaBar row={selectedHost} />

              <div className="direction-totals">
                <div>
                  <small>Inbound</small>
                  <strong className="mono">
                    {fmt(selectedHost.usage?.inbound || 0)}
                  </strong>
                </div>
                <div>
                  <small>Outbound</small>
                  <strong className="mono">
                    {fmt(selectedHost.usage?.outbound || 0)}
                  </strong>
                </div>
                <div>
                  <small>Period started</small>
                  <strong className="mono">
                    {when(selectedHost.usage?.start)}
                  </strong>
                </div>
              </div>

              <details className="disclosure-block">
                <summary>Correct current-period byte totals</summary>
                <div className="disclosure-body">
                  <UsageCorrectionPanel
                    host={selectedHost}
                    onSave={async (v) => {
                      await runAction(
                        () => api(`hosts/${selectedHost.id}/correct`, "POST", v),
                        "Usage corrected",
                      );
                    }}
                  />
                </div>
              </details>
            </section>
          </div>
        )}

        {subTab === "history" && <HistoryPanel entity={selectedHost} />}

        {subTab === "settings" && (
          <div className="detail-stack">
            <section className="surface-card">
              <h3>VPS Connection & Allowance Settings</h3>
              <HostFormPanel
                host={selectedHost}
                onSave={async (payload) => {
                  await runAction(
                    () => api(`hosts/${selectedHost.id}`, "PUT", payload),
                    "VPS updated",
                  );
                }}
              />
            </section>

            <section className="surface-card danger-zone-card">
              <div className="card-head-row">
                <div>
                  <h3>Danger Zone</h3>
                  <p className="muted-copy">
                    Removing a VPS excludes its nodes from subscriptions and
                    requests remote Hysteria 2 cleanup. Cloud provider billing is
                    unaffected.
                  </p>
                </div>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className="danger-outline"
                  disabled={!!selectedHost.deleting}
                  onClick={() =>
                    confirmModal(
                      <Confirm
                        title={`Delete ${selectedHost.name}?`}
                        action="Delete"
                        danger
                        onClose={closeModal}
                        onConfirm={async () => {
                          await runAction(
                            () => api(`hosts/${selectedHost.id}`, "DELETE"),
                            "Deletion queued",
                          );
                          closeModal();
                        }}
                      >
                        <p className="body-copy">
                          Hosted nodes are excluded from subscriptions
                          immediately. Remote cleanup must succeed before the
                          record moves to the archive.
                        </p>
                      </Confirm>,
                    )
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                  <span>Delete VPS</span>
                </button>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    confirmModal(
                      <ForceRemoveDialog
                        host={selectedHost}
                        onClose={closeModal}
                        onSave={async () => {
                          await runAction(
                            () =>
                              api(
                                `hosts/${selectedHost.id}/force-remove`,
                                "POST",
                                {
                                  confirmation:
                                    "REMOTE HOST DESTROYED OR HANDLED INDEPENDENTLY",
                                },
                              ),
                            "VPS force removed",
                          );
                          closeModal();
                          navigate({ section: "vps" });
                        }}
                      />,
                    )
                  }
                >
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Force remove</span>
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <StackDrillDown
      hasDetail={hasDetail}
      backLabel="VPS"
      detailTitle={
        route.mode === "new"
          ? "Add VPS"
          : selectedHost?.name || "VPS details"
      }
      onBack={() => goBackToRoot("vps")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="VPS host selector"
    />
  );
}
