import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  Link2,
  LogOut,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Send,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client";
import {
  Badge,
  Button,
  Chip,
  Confirm,
  CopyButton,
  Empty,
  Field,
  Input,
  Modal,
  Select,
  TextArea,
} from "./components";
import type {
  PortalData,
  PortalTemplateDetail,
  PortalTemplateSummary,
  Session,
} from "./types";

type PendingDiscard =
  | { type: "switch"; targetId: string; targetName: string }
  | { type: "refresh" }
  | { type: "create"; sourceId: string };

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name?: unknown }).name === "AbortError";
}

function CreatePersonalTemplateModal({
  sources,
  defaultSourceId,
  onClose,
  onCreate,
}: {
  sources: PortalTemplateSummary[];
  defaultSourceId: string;
  onClose: () => void;
  onCreate: (sourceId: string, name: string) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(
    () =>
      sources.find((s) => s.id === defaultSourceId)?.id || sources[0]?.id || "",
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title="New personal template"
      tag="Personal Template"
      subtitle="Copy an available published template into an independent personal draft."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!sourceId) {
            setError("Choose a published source template.");
            return;
          }
          if (!trimmed) {
            setError("Enter a template name.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await onCreate(sourceId, trimmed);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Copy from published template">
            <Select
              value={sourceId}
              disabled={busy}
              placeholder="Select source template"
              options={sources.map((s) => ({
                value: s.id,
                label: s.personal ? `${s.name} (Personal)` : s.name,
              }))}
              onChange={setSourceId}
            />
          </Field>
          <Field label="Template name" htmlFor="personal-tpl-name">
            <Input
              id="personal-tpl-name"
              required
              disabled={busy}
              maxLength={100}
              placeholder="e.g. Custom rules"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !sourceId || !name.trim()}
          >
            {busy ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SubscriptionPortal({
  session,
  theme,
  onToggleTheme,
  onLogout,
}: {
  session: Session;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [portal, setPortal] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<PortalTemplateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Personal template editor state
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState({ name: "", body: "" });
  const [previewText, setPreviewText] = useState("");
  const [previewedSaved, setPreviewedSaved] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "" | "save" | "preview" | "publish"
  >("");
  const [createModalSource, setCreateModalSource] = useState<string | null>(
    null,
  );
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(
    null,
  );

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const loadedDetailIdRef = useRef("");
  const portalAbortRef = useRef<AbortController | null>(null);
  const portalReqRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailReqRef = useRef(0);
  const opAbortRef = useRef<AbortController | null>(null);

  const loadPortal = useCallback(async (keepSelection = true) => {
    portalAbortRef.current?.abort();
    const controller = new AbortController();
    portalAbortRef.current = controller;
    const reqId = ++portalReqRef.current;

    setRefreshing(true);
    try {
      const data = (await api(
        "portal",
        "GET",
        undefined,
        controller.signal,
      )) as PortalData;
      if (controller.signal.aborted || reqId !== portalReqRef.current) {
        return null;
      }
      setPortal(data);
      setError("");

      const ids = new Set(data.templates.map((t) => t.id));
      const nextSelectedId =
        keepSelection && selectedIdRef.current && ids.has(selectedIdRef.current)
          ? selectedIdRef.current
          : data.defaultTemplate && ids.has(data.defaultTemplate)
            ? data.defaultTemplate
            : data.templates[0]?.id || "";
      if (nextSelectedId !== selectedIdRef.current) {
        setSelectedId(nextSelectedId);
      }
      return { data, nextSelectedId };
    } catch (err) {
      if (
        isAbortError(err) ||
        controller.signal.aborted ||
        reqId !== portalReqRef.current
      ) {
        return null;
      }
      setError((err as Error).message);
      return null;
    } finally {
      if (reqId === portalReqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    detailAbortRef.current?.abort();
    const reqId = ++detailReqRef.current;

    if (!id) {
      detailAbortRef.current = null;
      loadedDetailIdRef.current = "";
      setDetailLoading(false);
      setDetail(null);
      setDraftName("");
      setDraftBody("");
      setSavedSnapshot({ name: "", body: "" });
      setPreviewText("");
      setPreviewedSaved(false);
      return null;
    }

    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailLoading(true);
    setPreviewText("");
    setPreviewedSaved(false);
    if (loadedDetailIdRef.current !== id) {
      loadedDetailIdRef.current = "";
      setDetail(null);
      setDraftName("");
      setDraftBody("");
      setSavedSnapshot({ name: "", body: "" });
    }

    try {
      const d = (await api(
        `portal/templates/${id}`,
        "GET",
        undefined,
        controller.signal,
      )) as PortalTemplateDetail;
      if (
        controller.signal.aborted ||
        reqId !== detailReqRef.current ||
        selectedIdRef.current !== d.id
      ) {
        return null;
      }
      loadedDetailIdRef.current = d.id;
      setDetail(d);
      if (d.personal) {
        const initialBody = d.body ?? "";
        setDraftName(d.name);
        setDraftBody(initialBody);
        setSavedSnapshot({ name: d.name, body: initialBody });
      } else {
        setDraftName("");
        setDraftBody("");
        setSavedSnapshot({ name: "", body: "" });
      }
      setPreviewText("");
      setPreviewedSaved(false);
      return d;
    } catch (err) {
      if (
        isAbortError(err) ||
        controller.signal.aborted ||
        reqId !== detailReqRef.current
      ) {
        return null;
      }
      setError((err as Error).message);
      return null;
    } finally {
      if (reqId === detailReqRef.current) {
        setDetailLoading(false);
      }
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const prevId = selectedIdRef.current;
    const result = await loadPortal(true);
    if (!result) return;
    if (result.nextSelectedId && result.nextSelectedId === prevId) {
      await loadDetail(result.nextSelectedId);
    }
  }, [loadPortal, loadDetail]);

  useEffect(() => {
    void loadPortal(false);
  }, [loadPortal]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      detailAbortRef.current?.abort();
      detailReqRef.current += 1;
      loadedDetailIdRef.current = "";
      setDetailLoading(false);
      setDetail(null);
      setDraftName("");
      setDraftBody("");
      setSavedSnapshot({ name: "", body: "" });
      setPreviewText("");
      setPreviewedSaved(false);
    }
    return () => {
      detailAbortRef.current?.abort();
    };
  }, [selectedId, loadDetail]);

  useEffect(() => {
    return () => {
      portalAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      opAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const templates = portal?.templates || [];
  const assignedTemplates = useMemo(
    () => templates.filter((t) => !t.personal),
    [templates],
  );
  const personalTemplates = useMemo(
    () => templates.filter((t) => t.personal),
    [templates],
  );
  const publishedSources = useMemo(
    () => templates.filter((t) => t.published),
    [templates],
  );
  const defaultTemplateSummary = useMemo(
    () => templates.find((t) => t.id === portal?.defaultTemplate) ?? null,
    [templates, portal?.defaultTemplate],
  );
  const selectedSummary = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const activeDetail = detail && detail.id === selectedId ? detail : null;
  const controlsDisabled = !!busyAction || detailLoading || refreshing;
  const switchDisabled = !!busyAction || refreshing;

  const dirty =
    !!activeDetail?.personal &&
    (draftName !== savedSnapshot.name || draftBody !== savedSnapshot.body);

  const persistDraft = async (
    targetId: string,
    rawName: string,
    body: string,
  ): Promise<PortalTemplateSummary | null> => {
    const trimmed = rawName.trim();
    if (!trimmed) {
      setError("Template name is required.");
      return null;
    }
    opAbortRef.current?.abort();
    const controller = new AbortController();
    opAbortRef.current = controller;
    setBusyAction("save");
    setError("");
    try {
      const saved = (await api(
        `portal/templates/${targetId}`,
        "PUT",
        {
          name: trimmed,
          body,
        },
        controller.signal,
      )) as PortalTemplateSummary;
      if (controller.signal.aborted || selectedIdRef.current !== targetId) {
        return null;
      }
      setDraftName(saved.name);
      setSavedSnapshot({ name: saved.name, body });
      setPreviewedSaved(false);
      setPreviewText("");
      setDetail((prev) =>
        prev && prev.id === targetId
          ? {
              ...prev,
              name: saved.name,
              published: saved.published,
              draft: saved.draft,
              body,
            }
          : prev,
      );
      setPortal((prev) =>
        prev
          ? {
              ...prev,
              templates: prev.templates.map((t) =>
                t.id === saved.id ? saved : t,
              ),
            }
          : prev,
      );
      return saved;
    } catch (err) {
      if (!isAbortError(err)) {
        setError((err as Error).message);
      }
      return null;
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!activeDetail?.personal || controlsDisabled) return false;
    const targetId = activeDetail.id;
    try {
      const saved = await persistDraft(targetId, draftName, draftBody);
      if (!saved) return false;
      await loadPortal(true);
      if (selectedIdRef.current === targetId) {
        setToast("Draft saved");
      }
      return true;
    } finally {
      setBusyAction("");
    }
  };

  const runPreview = async () => {
    if (!activeDetail || controlsDisabled) return;
    const targetId = activeDetail.id;
    setError("");
    if (activeDetail.personal && dirty) {
      const saved = await persistDraft(targetId, draftName, draftBody);
      if (!saved) {
        setBusyAction("");
        return;
      }
    }

    opAbortRef.current?.abort();
    const controller = new AbortController();
    opAbortRef.current = controller;
    setBusyAction("preview");
    try {
      const res = (await api(
        `portal/templates/${targetId}/preview`,
        "POST",
        undefined,
        controller.signal,
      )) as { text: string };
      if (controller.signal.aborted || selectedIdRef.current !== targetId) {
        return;
      }
      setPreviewText(res.text || "");
      setPreviewedSaved(true);
      if (activeDetail.personal) {
        await loadPortal(true);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        setPreviewedSaved(false);
        setError((err as Error).message);
      }
    } finally {
      setBusyAction("");
    }
  };

  const canPublish =
    !!activeDetail?.personal &&
    !controlsDisabled &&
    !dirty &&
    previewedSaved &&
    activeDetail.draft;

  const runPublish = async () => {
    if (!canPublish || !activeDetail) return;
    const targetId = activeDetail.id;
    opAbortRef.current?.abort();
    const controller = new AbortController();
    opAbortRef.current = controller;
    setBusyAction("publish");
    setError("");
    try {
      await api(
        `portal/templates/${targetId}/publish`,
        "POST",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || selectedIdRef.current !== targetId) {
        return;
      }
      const res = await loadPortal(true);
      if (
        res &&
        res.nextSelectedId === targetId &&
        selectedIdRef.current === targetId
      ) {
        await loadDetail(targetId);
      }
      setToast("Personal template published");
    } catch (err) {
      if (!isAbortError(err)) {
        setError((err as Error).message);
      }
    } finally {
      setBusyAction("");
    }
  };

  const requestSelectTemplate = (t: PortalTemplateSummary) => {
    if (switchDisabled || t.id === selectedId) return;
    if (dirty) {
      setPendingDiscard({
        type: "switch",
        targetId: t.id,
        targetName: t.name,
      });
      return;
    }
    setSelectedId(t.id);
  };

  const requestRefresh = () => {
    if (controlsDisabled) return;
    if (dirty) {
      setPendingDiscard({ type: "refresh" });
      return;
    }
    void refreshAll();
  };

  const requestCreateModal = (sourceId: string) => {
    if (controlsDisabled) return;
    if (dirty) {
      setPendingDiscard({ type: "create", sourceId });
      return;
    }
    setCreateModalSource(sourceId);
  };

  return (
    <div className="shell">
      <header className="command-bar">
        <div className="command-bar-inner">
          <div className="command-left">
            <a
              className="brand"
              href="/portal"
              onClick={(e) => e.preventDefault()}
            >
              <span className="brand-symbol">
                <Network size={19} />
              </span>
              jetyet<span className="brand-period">.</span>
            </a>
            <Chip>Portal</Chip>
          </div>
          <div className="command-right">
            <Button
              variant="icon"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              onClick={onToggleTheme}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button
              variant="icon"
              aria-label="Refresh portal"
              className={refreshing ? "spinning" : ""}
              disabled={controlsDisabled}
              onClick={requestRefresh}
              title="Refresh"
            >
              <RefreshCw size={15} />
            </Button>
            <button
              type="button"
              className="account-chip"
              onClick={onLogout}
              title={`Sign out (${session.username})`}
            >
              <span className="avatar">
                {(portal?.name || session.username)[0]?.toUpperCase()}
              </span>
              <span className="account-chip-name mono">{session.username}</span>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="canvas">
        <div className="content portal-content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="panel portal-loading muted">
              Loading subscription portal…
            </div>
          ) : portal ? (
            <>
              <section className="portal-hero-bar">
                <div className="portal-identity">
                  <h1>{portal.name}</h1>
                  <div className="chip-group">
                    <Chip mono>{session.username}</Chip>
                    <Badge tone={portal.expired ? "warning" : "good"}>
                      {portal.expired ? "Expired" : "Active"}
                    </Badge>
                  </div>
                </div>
                {publishedSources.length > 0 && (
                  <Button
                    variant="primary"
                    disabled={controlsDisabled}
                    onClick={() =>
                      requestCreateModal(
                        portal.defaultTemplate || publishedSources[0].id,
                      )
                    }
                  >
                    <Plus size={15} />
                    New personal template
                  </Button>
                )}
              </section>

              {portal.expired ? (
                <section className="portal-expired-banner" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>Subscription expired</strong>
                    <p>
                      Subscription links are unavailable while expired. You can
                      still create, edit, and preview personal templates.
                    </p>
                  </div>
                </section>
              ) : (
                <section className="panel portal-links-panel">
                  <div className="panel-heading compact">
                    <div className="chip-group">
                      <Link2 size={15} className="muted" />
                      <h2>Subscription links</h2>
                    </div>
                  </div>
                  {portal.defaultLink || selectedSummary ? (
                    <div className="portal-links-list">
                      {portal.defaultLink && (
                        <div className="portal-link-row is-default">
                          <div className="portal-link-meta">
                            <strong>Default subscription</strong>
                            <div className="chip-group">
                              <Badge tone="good">Default</Badge>
                              {defaultTemplateSummary && (
                                <Chip>
                                  Choice: {defaultTemplateSummary.name}
                                </Chip>
                              )}
                            </div>
                          </div>
                          <div
                            className="portal-link-url mono"
                            title={portal.defaultLink}
                          >
                            {portal.defaultLink}
                          </div>
                          <div className="link-card-actions">
                            <CopyButton
                              text={portal.defaultLink}
                              label="Copy"
                              copiedLabel="Copied"
                              ariaLabel="Copy default subscription link"
                              variant="primary"
                              className="link-action-btn"
                            />
                            <a
                              href={portal.defaultLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="icon-button link-open-btn"
                              title="Open default subscription"
                              aria-label="Open default subscription"
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </div>
                      )}
                      {selectedSummary &&
                        (detailLoading && !activeDetail ? (
                          <div className="portal-link-status muted">
                            Loading pinned link for {selectedSummary.name}…
                          </div>
                        ) : activeDetail?.link ? (
                          <div className="portal-link-row">
                            <div className="portal-link-meta">
                              <strong>{activeDetail.name}</strong>
                              <div className="chip-group">
                                <Chip>Pinned</Chip>
                                <Chip>
                                  {activeDetail.personal
                                    ? "Personal"
                                    : "Assigned"}
                                </Chip>
                                {activeDetail.id === portal.defaultTemplate && (
                                  <Badge tone="good">Default choice</Badge>
                                )}
                              </div>
                            </div>
                            <div
                              className="portal-link-url mono"
                              title={activeDetail.link}
                            >
                              {activeDetail.link}
                            </div>
                            <div className="link-card-actions">
                              <CopyButton
                                text={activeDetail.link}
                                label="Copy"
                                copiedLabel="Copied"
                                ariaLabel={`Copy pinned link for ${activeDetail.name}`}
                                variant={
                                  portal.defaultLink ? "subtle" : "primary"
                                }
                                className="link-action-btn"
                              />
                              <a
                                href={activeDetail.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="icon-button link-open-btn"
                                title={`Open ${activeDetail.name}`}
                                aria-label={`Open ${activeDetail.name}`}
                              >
                                <ExternalLink size={14} />
                              </a>
                            </div>
                          </div>
                        ) : activeDetail ? (
                          <div className="portal-link-status muted">
                            Publish “{activeDetail.name}” to get its pinned
                            template link.
                          </div>
                        ) : null)}
                    </div>
                  ) : (
                    <div className="portal-links-empty muted">
                      No published subscription links are available yet.
                    </div>
                  )}
                </section>
              )}

              {templates.length === 0 ? (
                <section className="panel">
                  <Empty title="No templates available">
                    Ask your administrator to assign a subscription template.
                  </Empty>
                </section>
              ) : (
                <section className="portal-workbench">
                  <aside className="panel portal-sidebar" aria-label="Templates">
                    <div className="portal-side-section">
                      <div className="portal-side-head">
                        <span className="kpi-label">ASSIGNED TEMPLATES</span>
                        <span className="count">{assignedTemplates.length}</span>
                      </div>
                      {assignedTemplates.length ? (
                        <div className="portal-tpl-list">
                          {assignedTemplates.map((t) => {
                            const active = selectedId === t.id;
                            const isDefault = t.id === portal.defaultTemplate;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                disabled={switchDisabled}
                                className={
                                  "portal-tpl-item" + (active ? " active" : "")
                                }
                                onClick={() => requestSelectTemplate(t)}
                              >
                                <span className="portal-tpl-name">{t.name}</span>
                                <span className="chip-group">
                                  {isDefault && (
                                    <Badge tone="good">Default</Badge>
                                  )}
                                  {!t.published && (
                                    <Badge tone="neutral">Draft</Badge>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="portal-side-empty muted">
                          None assigned.
                        </p>
                      )}
                    </div>

                    <div className="portal-side-section">
                      <div className="portal-side-head">
                        <span className="kpi-label">PERSONAL TEMPLATES</span>
                        <span className="count">{personalTemplates.length}</span>
                      </div>
                      {personalTemplates.length ? (
                        <div className="portal-tpl-list">
                          {personalTemplates.map((t) => {
                            const active = selectedId === t.id;
                            const isDefault = t.id === portal.defaultTemplate;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                disabled={switchDisabled}
                                className={
                                  "portal-tpl-item" + (active ? " active" : "")
                                }
                                onClick={() => requestSelectTemplate(t)}
                              >
                                <span className="portal-tpl-name">{t.name}</span>
                                <span className="chip-group">
                                  {isDefault && (
                                    <Badge tone="good">Default</Badge>
                                  )}
                                  {t.published && t.draft && (
                                    <Badge tone="warning">Draft edits</Badge>
                                  )}
                                  <Badge tone={t.published ? "good" : "neutral"}>
                                    {t.published ? "Published" : "Draft"}
                                  </Badge>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="portal-side-empty muted">
                          Copy any published template to customize rules and
                          groups.
                        </p>
                      )}
                    </div>
                  </aside>

                  <div className="portal-main">
                    {detailLoading && !activeDetail ? (
                      <div className="panel portal-loading muted">
                        Loading template…
                      </div>
                    ) : !activeDetail ? (
                      <div className="panel">
                        <Empty title="Select a template">
                          Choose an assigned or personal template to inspect or
                          edit.
                        </Empty>
                      </div>
                    ) : !activeDetail.personal ? (
                      <div className="studio-card portal-assigned-view">
                        <div className="portal-detail-head">
                          <div className="portal-detail-title">
                            <FileCode2 size={17} className="muted" />
                            <h2>{activeDetail.name}</h2>
                            <Chip>Assigned</Chip>
                            {activeDetail.id === portal.defaultTemplate && (
                              <Badge tone="good">Default choice</Badge>
                            )}
                            <Badge
                              tone={activeDetail.published ? "good" : "neutral"}
                            >
                              {activeDetail.published ? "Published" : "Draft"}
                            </Badge>
                          </div>
                          <div className="portal-detail-actions">
                            {!portal.expired && activeDetail.link && (
                              <CopyButton
                                text={activeDetail.link}
                                label="Copy link"
                                copiedLabel="Copied"
                              />
                            )}
                            {activeDetail.published && (
                              <Button
                                disabled={controlsDisabled}
                                onClick={() =>
                                  requestCreateModal(activeDetail.id)
                                }
                              >
                                <Copy size={14} />
                                Copy as personal
                              </Button>
                            )}
                            <Button
                              variant="primary"
                              disabled={controlsDisabled}
                              onClick={() => void runPreview()}
                            >
                              <Eye size={14} />
                              {busyAction === "preview"
                                ? "Rendering…"
                                : "Preview"}
                            </Button>
                          </div>
                        </div>

                        {!portal.expired && activeDetail.link && (
                          <div className="portal-inline-link">
                            <span className="kpi-label">
                              PINNED TEMPLATE LINK
                            </span>
                            <div className="link-url mono">
                              {activeDetail.link}
                            </div>
                          </div>
                        )}

                        {previewText ? (
                          <div className="portal-preview-wrap">
                            <div className="portal-preview-head">
                              <span className="kpi-label">
                                REDACTED PREVIEW
                              </span>
                              <CopyButton
                                text={previewText}
                                label="Copy preview"
                                copiedLabel="Copied"
                              />
                            </div>
                            <pre className="code-output ide-output">
                              {previewText}
                            </pre>
                          </div>
                        ) : (
                          <div className="ide-empty">
                            <p className="muted">
                              Click <strong>Preview</strong> to render a
                              redacted client configuration with placeholder
                              node details.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="portal-personal-view">
                        <div className="studio-card portal-editor-bar">
                          <div className="portal-editor-meta">
                            <div className="portal-editor-name-row">
                              <Input
                                className="ide-name-input"
                                aria-label="Personal template name"
                                placeholder="Template name…"
                                maxLength={100}
                                disabled={controlsDisabled}
                                value={draftName}
                                onChange={(e) => {
                                  setDraftName(e.target.value);
                                  setPreviewedSaved(false);
                                  setPreviewText("");
                                }}
                              />
                              <div className="chip-group">
                                <Chip>Personal</Chip>
                                {activeDetail.id === portal.defaultTemplate && (
                                  <Badge tone="good">Default choice</Badge>
                                )}
                                {activeDetail.published &&
                                  activeDetail.draft && (
                                    <Badge tone="warning">Draft edits</Badge>
                                  )}
                                <Badge
                                  tone={
                                    activeDetail.published ? "good" : "neutral"
                                  }
                                >
                                  {activeDetail.published
                                    ? "Published"
                                    : "Draft"}
                                </Badge>
                                {dirty && (
                                  <Badge tone="warning">Unsaved</Badge>
                                )}
                              </div>
                            </div>
                            <div className="portal-detail-actions">
                              <Button
                                disabled={
                                  controlsDisabled ||
                                  !dirty ||
                                  !draftName.trim()
                                }
                                onClick={() => void saveDraft()}
                              >
                                {busyAction === "save"
                                  ? "Saving…"
                                  : "Save draft"}
                              </Button>
                              <Button
                                disabled={controlsDisabled || !draftName.trim()}
                                onClick={() => void runPreview()}
                              >
                                <Eye size={14} />
                                {busyAction === "preview"
                                  ? "Previewing…"
                                  : dirty
                                    ? "Save & preview"
                                    : "Preview"}
                              </Button>
                              <Button
                                variant="primary"
                                disabled={!canPublish}
                                onClick={() => void runPublish()}
                              >
                                <Send size={14} />
                                {busyAction === "publish"
                                  ? "Publishing…"
                                  : "Publish"}
                              </Button>
                            </div>
                          </div>
                          {!portal.expired && activeDetail.link && (
                            <div className="portal-inline-link">
                              <span className="kpi-label">
                                PINNED PERSONAL LINK
                              </span>
                              <div className="portal-inline-link-row">
                                <div className="link-url mono">
                                  {activeDetail.link}
                                </div>
                                <CopyButton
                                  text={activeDetail.link}
                                  label="Copy"
                                  copiedLabel="Copied"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="ide-grid">
                          <div className="studio-card ide-pane">
                            <div className="studio-card-head">
                              <span className="kpi-label">
                                TEMPLATE SOURCE
                              </span>
                              <Chip mono>Liquid · YAML</Chip>
                            </div>
                            <TextArea
                              className="template-source ide-editor"
                              aria-label="Personal template body"
                              spellCheck={false}
                              rows={22}
                              disabled={controlsDisabled}
                              value={draftBody}
                              onChange={(e) => {
                                setDraftBody(e.target.value);
                                setPreviewedSaved(false);
                                setPreviewText("");
                              }}
                            />
                          </div>

                          <div className="studio-card ide-pane">
                            <div className="studio-card-head">
                              <span className="kpi-label">
                                REDACTED PREVIEW
                              </span>
                              <div className="chip-group">
                                {previewedSaved && !dirty && (
                                  <Badge tone="good">Validated</Badge>
                                )}
                                {previewText && (
                                  <CopyButton
                                    text={previewText}
                                    label="Copy"
                                    copiedLabel="Copied"
                                  />
                                )}
                              </div>
                            </div>
                            {previewText ? (
                              <pre className="code-output ide-output">
                                {previewText}
                              </pre>
                            ) : (
                              <div className="ide-empty">
                                <p className="muted">
                                  {dirty
                                    ? "Save and preview your edits before publishing."
                                    : "Click Preview to validate your saved draft and inspect redacted output."}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>
      </main>

      {createModalSource !== null && (
        <CreatePersonalTemplateModal
          sources={publishedSources}
          defaultSourceId={createModalSource}
          onClose={() => setCreateModalSource(null)}
          onCreate={async (sourceId, name) => {
            const created = (await api("portal/templates", "POST", {
              sourceId,
              name,
            })) as { id: string };
            setCreateModalSource(null);
            selectedIdRef.current = created.id;
            setSelectedId(created.id);
            await loadPortal(true);
            setToast("Personal draft created");
          }}
        />
      )}

      {pendingDiscard && (
        <Confirm
          title="Discard unsaved changes?"
          action="Discard changes"
          danger
          onClose={() => setPendingDiscard(null)}
          onConfirm={async () => {
            const action = pendingDiscard;
            setPendingDiscard(null);
            if (action.type === "switch") {
              setSelectedId(action.targetId);
            } else if (action.type === "refresh") {
              void refreshAll();
            } else {
              setCreateModalSource(action.sourceId);
            }
          }}
        >
          <p className="muted">
            {pendingDiscard.type === "switch"
              ? `You have unsaved edits to “${activeDetail?.name || "this template"}”. Switching to “${pendingDiscard.targetName}” will discard them.`
              : pendingDiscard.type === "refresh"
                ? `You have unsaved edits to “${activeDetail?.name || "this template"}”. Refreshing will discard them.`
                : `You have unsaved edits to “${activeDetail?.name || "this template"}”. Creating a new personal template will discard them.`}
          </p>
        </Confirm>
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
