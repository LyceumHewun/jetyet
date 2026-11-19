import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  KeyRound,
  Link2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { api, fmt, nodeStatusLabel, when } from "../client";
import {
  Badge,
  Confirm,
  CopyButton,
  Empty,
  QuotaBar,
  SectionTabs,
  StackDrillDown,
} from "../components";
import { UserFormPanel } from "../forms";
import { HistoryPanel } from "../history";
import type { Row } from "../types";
import type { ViewContext } from "./viewTypes";

export function UsersWorkspace({ ctx }: { ctx: ViewContext }) {
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

  const uid = useId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "restricted">("all");
  const [archived, setArchived] = useState<Row[] | null>(null);
  const [linksData, setLinksData] = useState<{
    default: string;
    templates: Array<{ id: string; url: string }>;
  } | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState("");

  const [draftNodeIds, setDraftNodeIds] = useState<string[]>([]);
  const [draftTemplateIds, setDraftTemplateIds] = useState<string[]>([]);
  const [draftDefaultTemplate, setDraftDefaultTemplate] = useState<string>("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");

  const isArchive = route.mode === "archive";
  const subTab = route.sub || "access";

  useEffect(() => {
    if (!isArchive) return;
    let cancelled = false;
    void api("archive/users")
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

  const sourceList = isArchive ? archived || [] : state.users;
  const filtered = sourceList.filter((u) => {
    if (!isArchive && filter === "restricted") {
      const expired = u.expires && Date.parse(u.expires) <= Date.now();
      if (u.enabled && !u.exhausted && !expired) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.name, u.note]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const hasDetail = Boolean(route.id || route.mode === "new");
  const selectedUser =
    route.mode === "new"
      ? undefined
      : isArchive
        ? (archived || []).find((u) => u.id === route.id) || filtered[0]
        : state.users.find((u) => u.id === route.id) || filtered[0];

  const loadLinks = useCallback(async (userId: string) => {
    setLinksLoading(true);
    setLinksError("");
    try {
      const data = await api(`users/${userId}/links`);
      setLinksData(data);
    } catch (err) {
      setLinksData(null);
      setLinksError(
        err instanceof Error
          ? err.message
          : "Failed to load subscription links",
      );
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedUser || isArchive) {
      setLinksData(null);
      setLinksError("");
      return;
    }
    void loadLinks(selectedUser.id);
  }, [selectedUser?.id, selectedUser?.templateIds?.join(","), isArchive, loadLinks]);

  useEffect(() => {
    if (!selectedUser || isArchive) return;
    setDraftNodeIds(selectedUser.nodeIds ?? []);
    setDraftTemplateIds(selectedUser.templateIds ?? []);
    setDraftDefaultTemplate(selectedUser.defaultTemplate ?? "");
    setAccessError("");
  }, [
    selectedUser?.id,
    selectedUser?.nodeIds?.join(","),
    selectedUser?.templateIds?.join(","),
    selectedUser?.defaultTemplate,
    isArchive,
  ]);

  const accessDirty =
    Boolean(selectedUser && !isArchive) &&
    (JSON.stringify([...draftNodeIds].sort()) !==
      JSON.stringify([...(selectedUser?.nodeIds ?? [])].sort()) ||
      JSON.stringify([...draftTemplateIds].sort()) !==
        JSON.stringify([...(selectedUser?.templateIds ?? [])].sort()) ||
      draftDefaultTemplate !== (selectedUser?.defaultTemplate ?? ""));

  const availableNodes = state.nodes.filter((n) => !n.deleting);
  const publishedTemplates = state.templates.filter((t) => t.published);

  const saveAccessChanges = async () => {
    if (!selectedUser) return;
    if (!draftTemplateIds.length || !draftDefaultTemplate) {
      setAccessError("Select at least one published template and a default.");
      return;
    }
    setAccessBusy(true);
    setAccessError("");
    try {
      await runAction(
        () =>
          api(`users/${selectedUser.id}`, "PUT", {
            name: selectedUser.name,
            note: selectedUser.note ?? "",
            enabled: Boolean(selectedUser.enabled),
            expires: selectedUser.expires ?? null,
            quota: selectedUser.quota,
            nodeIds: draftNodeIds,
            templateIds: draftTemplateIds,
            defaultTemplate: draftDefaultTemplate,
          }),
        "Node & template access saved",
      );
      await loadLinks(selectedUser.id);
    } catch (err) {
      setAccessError(
        err instanceof Error ? err.message : "Failed to save access changes",
      );
    } finally {
      setAccessBusy(false);
    }
  };

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">SUBSCRIBERS</p>
            <h1 id="main-heading" tabIndex={-1}>
              Subscription Users
            </h1>
          </div>
          <a
            {...linkProps({ section: "users", mode: "new" })}
            className="btn primary compact-button"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add user</span>
          </a>
        </div>

        <search className="pane-search">
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Users"
              placeholder="Search user name or note…"
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
              onClick={() => navigate({ section: "users" })}
            >
              Active ({state.users.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isArchive}
              className={isArchive ? "seg-tab active" : "seg-tab"}
              onClick={() => navigate({ section: "users", mode: "archive" })}
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
                  filter === "restricted" ? "filter-pill active" : "filter-pill"
                }
                onClick={() => setFilter("restricted")}
              >
                Restricted
              </button>
            </div>
          )}
        </div>
      </div>

      {isArchive && archived === null ? (
        <progress aria-label="Loading archived users" className="flat-progress" />
      ) : !filtered.length ? (
        <Empty
          title={
            search
              ? "No matching users"
              : isArchive
                ? "No archived users"
                : "No subscription users yet"
          }
          icon={isArchive ? <Archive size={26} /> : <Users size={26} />}
          action={
            search ? (
              <button type="button" onClick={() => setSearch("")}>
                Clear search
              </button>
            ) : !isArchive ? (
              <a
                {...linkProps({ section: "users", mode: "new" })}
                className="btn primary"
              >
                <Plus size={17} aria-hidden="true" />
                <span>Add user</span>
              </a>
            ) : undefined
          }
        >
          {isArchive
            ? "Deleted users retain historical traffic and event records here."
            : search
              ? "Try another display name or note."
              : "Create personal subscription links with custom node access and allowances."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="User list">
          {filtered.map((u) => {
            const active = selectedUser?.id === u.id && route.mode !== "new";
            const expired = u.expires && Date.parse(u.expires) <= Date.now();
            const statusText = isArchive
              ? "Archived"
              : !u.enabled
                ? "Disabled"
                : expired
                  ? "Expired"
                  : u.exhausted
                    ? "Exhausted"
                    : "Enabled";
            const online = state.nodes.reduce(
              (sum, n) => sum + Number(n.online?.[u.id] || 0),
              0,
            );
            return (
              <li key={u.id}>
                <a
                  {...linkProps(
                    isArchive
                      ? { section: "users", mode: "archive", id: u.id }
                      : { section: "users", id: u.id },
                  )}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span className="flow-medallion orchid" aria-hidden="true">
                      <Users size={16} />
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{u.name}</strong>
                      <small>{u.note || "No note"}</small>
                    </div>
                    <Badge
                      tone={
                        statusText === "Enabled"
                          ? "good"
                          : statusText === "Archived"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {statusText}
                    </Badge>
                  </div>
                  {!isArchive && (
                    <>
                      <QuotaBar row={u} compact />
                      <div className="selector-card-meta">
                        <span>
                          {(u.nodeIds || []).length}{" "}
                          {(u.nodeIds || []).length === 1 ? "node" : "nodes"}
                        </span>
                        <span>
                          {online} online{" "}
                          {online === 1 ? "instance" : "instances"}
                        </span>
                      </div>
                    </>
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
        title="Select a subscription user"
        icon={<Users size={28} />}
        action={
          <a
            {...linkProps({ section: "users", mode: "new" })}
            className="btn primary"
          >
            <Plus size={17} aria-hidden="true" />
            <span>Add user</span>
          </a>
        }
      >
        Manage subscription links, authorized nodes, templates, and traffic
        quotas in one workspace.
      </Empty>
    </div>
  );

  if (route.mode === "new") {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <p className="eyebrow">NEW RECIPIENT</p>
          <h2>Add subscription user</h2>
          <UserFormPanel
            state={state}
            includeAccess
            onCancel={() => goBackToRoot("users")}
            onSave={async (payload) => {
              const created = await runAction(
                () => api("users", "POST", payload),
                "User created · Ready to copy subscription link",
              );
              navigate({ section: "users", id: created.id });
            }}
          />
        </div>
      </div>
    );
  } else if (selectedUser && isArchive) {
    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-title-badges">
            <h2>{selectedUser.name}</h2>
            <Badge tone="neutral">Archived</Badge>
          </div>
          <p className="muted-copy">
            {selectedUser.note || "No note"} · Created{" "}
            {when(selectedUser.created)}
          </p>
        </div>
        <HistoryPanel entity={selectedUser} />
      </div>
    );
  } else if (selectedUser) {
    const expired =
      selectedUser.expires && Date.parse(selectedUser.expires) <= Date.now();
    const statusLabel = !selectedUser.enabled
      ? "Disabled"
      : expired
        ? "Expired"
        : selectedUser.exhausted
          ? "Exhausted"
          : "Enabled";

    const allLinksText = linksData
      ? [
          `Default\n${linksData.default}`,
          ...linksData.templates.map(
            (t) =>
              `${state.templates.find((x) => x.id === t.id)?.name || t.id}\n${t.url}`,
          ),
        ].join("\n\n")
      : "";

    detailPane = (
      <div className="detail-stack">
        <div className="surface-card detail-hero-card">
          <div className="detail-head-row">
            <div>
              <div className="detail-title-badges">
                <h2>{selectedUser.name}</h2>
                <Badge tone={statusLabel === "Enabled" ? "good" : "warning"}>
                  {statusLabel}
                </Badge>
              </div>
              <p className="muted-copy">
                {selectedUser.note || "No note"}
                {selectedUser.expires
                  ? ` · Expires ${when(selectedUser.expires)}`
                  : " · Never expires"}
              </p>
            </div>

            <div className="detail-actions-row">
              {linksData && (
                <CopyButton
                  text={linksData.default}
                  label="Copy subscription link"
                  copiedLabel="Copied link"
                  variant="primary"
                />
              )}
              <button
                type="button"
                className="compact-button"
                onClick={() =>
                  confirmModal(
                    <Confirm
                      title={`Reset ${selectedUser.name}'s traffic?`}
                      action="Reset usage"
                      onClose={closeModal}
                      onConfirm={async () => {
                        await runAction(
                          () => api(`usage/${selectedUser.id}/reset`, "POST"),
                          "Usage reset",
                        );
                        closeModal();
                      }}
                    >
                      <p className="body-copy">
                        Zeros current-period counters and lifts user quota
                        suspension. Scheduled reset dates and history remain
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
              navigate({ section: "users", id: selectedUser.id, sub: next }, true)
            }
            tabs={[
              { id: "access", label: "Subscriptions & Access" },
              { id: "history", label: "History" },
              { id: "settings", label: "Settings & Security" },
            ]}
          />
        </div>

        {subTab === "access" && (
          <div className="detail-stack">
            <section className="surface-card">
              <div className="card-head-row">
                <div>
                  <h3>Subscription Links</h3>
                  <p className="muted-copy">
                    Personal mihomo URLs sharing one traffic allowance and
                    allowed node set.
                  </p>
                </div>
                {allLinksText && (
                  <CopyButton
                    text={allLinksText}
                    label="Copy all"
                    copiedLabel="Copied all"
                    variant="compact"
                  />
                )}
              </div>

              {(!selectedUser.enabled || expired) && (
                <p className="notice-banner warning">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <span>
                    Retrieval is blocked while this user is{" "}
                    {!selectedUser.enabled ? "disabled" : "expired"}.
                  </span>
                </p>
              )}

              {selectedUser.enabled && !expired && selectedUser.exhausted && (
                <p className="notice-banner warning">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <span>
                    Quota exhausted: subscription output keeps eligible nodes
                    with usage metadata while VPN authentication stays
                    suspended.
                  </span>
                </p>
              )}

              {linksLoading && (
                <progress aria-label="Loading subscription links" className="flat-progress" />
              )}

              {linksError && (
                <p className="form-error" role="alert">
                  {linksError}
                </p>
              )}

              {linksData && (
                <div className="sub-links-list">
                  <div className="sub-link-row featured">
                    <div className="sub-link-meta">
                      <span className="sub-link-title">
                        <Link2 size={15} aria-hidden="true" />
                        <strong>Default template URL</strong>
                        <Badge tone="accent">Default</Badge>
                      </span>
                      <code className="sub-link-url">{linksData.default}</code>
                    </div>
                    <CopyButton
                      text={linksData.default}
                      label="Copy"
                      copiedLabel="Copied"
                      variant="primary"
                    />
                  </div>

                  {linksData.templates.map((item) => {
                    const tplName =
                      state.templates.find((t) => t.id === item.id)?.name ||
                      item.id;
                    return (
                      <div className="sub-link-row" key={item.id}>
                        <div className="sub-link-meta">
                          <span className="sub-link-title">
                            <strong>{tplName}</strong>
                            {item.id === selectedUser.defaultTemplate && (
                              <Badge tone="good" icon={<CheckCircle2 size={12} />}>
                                Active default
                              </Badge>
                            )}
                          </span>
                          <code className="sub-link-url">{item.url}</code>
                        </div>
                        <CopyButton
                          text={item.url}
                          label="Copy"
                          copiedLabel="Copied"
                          variant="compact"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="surface-card">
              <div className="card-head-row">
                <div>
                  <h3>Allowed Nodes & Templates</h3>
                  <p className="muted-copy">
                    Authorize Hysteria 2 endpoints and templates directly.
                    Unchecking a node queues session disconnection.
                  </p>
                </div>
                <div className="inline-actions">
                  {availableNodes.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="compact-button"
                        onClick={() =>
                          setDraftNodeIds(availableNodes.map((n) => n.id))
                        }
                      >
                        Select current nodes
                      </button>
                      <button
                        type="button"
                        className="compact-button"
                        onClick={() => setDraftNodeIds([])}
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>

              {availableNodes.length ? (
                <div className="check-grid">
                  {availableNodes.map((n) => {
                    const checked = draftNodeIds.includes(n.id);
                    const status = nodeStatusLabel(n, state.hosts);
                    const userOnline = Number(n.online?.[selectedUser.id] || 0);
                    return (
                      <label
                        key={n.id}
                        className={`check-card ${checked ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDraftNodeIds((prev) =>
                              e.target.checked
                                ? [...prev, n.id]
                                : prev.filter((id) => id !== n.id),
                            )
                          }
                        />
                        <span className="check-card-body">
                          <span className="check-card-head">
                            <strong>{n.name}</strong>
                            <Badge
                              tone={status === "Running" ? "good" : "warning"}
                            >
                              {status}
                            </Badge>
                          </span>
                          <small className="mono">
                            {n.address}:{n.port}
                            {userOnline > 0
                              ? ` · ${userOnline} online`
                              : ""}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-copy">
                  No active nodes yet. Plan and deploy a node first.
                </p>
              )}

              <div className="access-templates-box">
                <div className="field-label-inline">
                  <strong>Published templates</strong>
                  <span className="muted-copy">
                    {draftTemplateIds.length} assigned
                  </span>
                </div>
                <div className="check-grid">
                  {publishedTemplates.map((t) => {
                    const checked = draftTemplateIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className={`check-card ${checked ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nextChecked = e.target.checked;
                            const nextIds = nextChecked
                              ? draftTemplateIds.includes(t.id)
                                ? draftTemplateIds
                                : [...draftTemplateIds, t.id]
                              : draftTemplateIds.filter((id) => id !== t.id);
                            setDraftTemplateIds(nextIds);
                            if (!nextChecked && draftDefaultTemplate === t.id) {
                              setDraftDefaultTemplate(nextIds[0] || "");
                            } else if (nextChecked && !draftDefaultTemplate) {
                              setDraftDefaultTemplate(t.id);
                            }
                          }}
                        />
                        <span>
                          <strong>{t.name}</strong>
                          <small>mihomo configuration</small>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="field">
                  <label htmlFor={`${uid}-user-default-tpl`}>
                    Default template
                  </label>
                  <select
                    id={`${uid}-user-default-tpl`}
                    value={draftDefaultTemplate}
                    onChange={(e) => setDraftDefaultTemplate(e.target.value)}
                  >
                    <option value="">Choose default template</option>
                    {state.templates
                      .filter((t) => draftTemplateIds.includes(t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {accessError && (
                <p className="form-error" role="alert">
                  {accessError}
                </p>
              )}

              {accessDirty && (
                <div className="save-bar" role="status">
                  <span>Unsaved access changes</span>
                  <div className="inline-actions">
                    <button
                      type="button"
                      disabled={accessBusy}
                      onClick={() => {
                        setDraftNodeIds(selectedUser.nodeIds ?? []);
                        setDraftTemplateIds(selectedUser.templateIds ?? []);
                        setDraftDefaultTemplate(
                          selectedUser.defaultTemplate ?? "",
                        );
                        setAccessError("");
                      }}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={accessBusy}
                      onClick={() => void saveAccessChanges()}
                    >
                      {accessBusy ? "Saving…" : "Save access changes"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="surface-card">
              <div className="card-head-row">
                <div>
                  <h3>Traffic Allowance</h3>
                  <p className="muted-copy">
                    Shared across all authorized nodes · Resets{" "}
                    {when(selectedUser.usage?.next)}
                  </p>
                </div>
              </div>
              <QuotaBar row={selectedUser} />
              <div className="direction-totals">
                <div>
                  <small>Inbound</small>
                  <strong className="mono">
                    {fmt(selectedUser.usage?.inbound || 0)}
                  </strong>
                </div>
                <div>
                  <small>Outbound</small>
                  <strong className="mono">
                    {fmt(selectedUser.usage?.outbound || 0)}
                  </strong>
                </div>
                <div>
                  <small>Next reset</small>
                  <strong className="mono">
                    {when(selectedUser.usage?.next)}
                  </strong>
                </div>
              </div>
            </section>
          </div>
        )}

        {subTab === "history" && <HistoryPanel entity={selectedUser} />}

        {subTab === "settings" && (
          <div className="detail-stack">
            <section className="surface-card">
              <h3>Profile, Expiration & Allowance</h3>
              <UserFormPanel
                user={selectedUser}
                state={state}
                includeAccess={false}
                onSave={async (payload) => {
                  await runAction(
                    () => api(`users/${selectedUser.id}`, "PUT", payload),
                    "User settings saved",
                  );
                }}
              />
            </section>

            <section className="surface-card">
              <h3>Credential Rotation</h3>
              <p className="muted-copy">
                Subscription link tokens and VPN authentication tokens rotate
                independently.
              </p>
              <div className="rotation-grid">
                {(
                  [
                    [
                      "subscription",
                      "Rotate subscription link",
                      "Invalidates previous subscription URLs immediately without disconnecting active VPN sessions.",
                    ],
                    [
                      "vpn",
                      "Rotate VPN credential",
                      "Revokes existing VPN token across all nodes and disconnects active sessions. User must refresh subscription.",
                    ],
                    [
                      "both",
                      "Rotate both tokens",
                      "Revokes old subscription URLs and VPN credentials together. Share the new subscription URL afterward.",
                    ],
                  ] as const
                ).map(([target, title, desc]) => (
                  <div className="rotation-card" key={target}>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                    <button
                      type="button"
                      className="compact-button"
                      onClick={() =>
                        confirmModal(
                          <Confirm
                            title={`${title}?`}
                            action="Rotate"
                            onClose={closeModal}
                            onConfirm={async () => {
                              await runAction(
                                () =>
                                  api(`users/${selectedUser.id}/rotate`, "POST", {
                                    target,
                                  }),
                                "Credentials rotated",
                              );
                              await loadLinks(selectedUser.id);
                              closeModal();
                            }}
                          >
                            <p className="body-copy">{desc}</p>
                          </Confirm>,
                        )
                      }
                    >
                      <KeyRound size={15} aria-hidden="true" />
                      <span>Rotate</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card danger-zone-card">
              <div className="card-head-row">
                <div>
                  <h3>Danger Zone</h3>
                  <p className="muted-copy">
                    Deleting revokes subscription retrieval and VPN access
                    immediately, disconnects active sessions, and archives usage
                    history.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="danger-outline"
                onClick={() =>
                  confirmModal(
                    <Confirm
                      title={`Delete ${selectedUser.name}?`}
                      action="Delete"
                      danger
                      onClose={closeModal}
                      onConfirm={async () => {
                        await runAction(
                          () => api(`users/${selectedUser.id}`, "DELETE"),
                          "User deleted",
                        );
                        closeModal();
                        navigate({ section: "users" });
                      }}
                    >
                      <p className="body-copy">
                        Subscription links stop working immediately and active
                        VPN connections are queued to disconnect.
                      </p>
                    </Confirm>,
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>Delete user</span>
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
      backLabel="Users"
      detailTitle={
        route.mode === "new"
          ? "Add user"
          : selectedUser?.name || "User details"
      }
      onBack={() => goBackToRoot("users")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="User selector"
    />
  );
}
