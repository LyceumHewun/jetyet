import {
  asUiError,
  type UiError,
  formatNumber,
  localizeError,
  localizeMessage,
  t as translate,
} from "./i18n";
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
  Plus,
  RefreshCw,
  Send,
  Sun,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./client";
import {
  Badge,
  BrandMark,
  ScrollArea,
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
  const [error, setError] = useState<UiError>("");

  return (
    <Modal
      title={translate("New personal template")}
      tag={translate("Personal Template")}
      subtitle={translate(
        "Copy an available published template into an independent personal draft.",
      )}
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
            setError(asUiError(err));
            setBusy(false);
          }
        }}
      >
        <ScrollArea axis="y" className="modal-body">
          <Field label={translate("Copy from published template")}>
            <Select
              value={sourceId}
              disabled={busy}
              placeholder={translate("Select source template")}
              options={sources.map((s) => ({
                value: s.id,
                label: s.personal
                  ? translate("{0} (Personal)", s.name)
                  : s.name,
              }))}
              onChange={setSourceId}
            />
          </Field>
          <Field label={translate("Template name")} htmlFor="personal-tpl-name">
            <Input
              id="personal-tpl-name"
              required
              disabled={busy}
              maxLength={100}
              placeholder={translate("e.g. Custom rules")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {localizeError(error)}
            </p>
          )}
        </ScrollArea>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>
            {translate("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !sourceId || !name.trim()}
          >
            {busy ? translate("Creating…") : translate("Create draft")}
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
  languageControl,
  onLogout,
}: {
  session: Session;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  languageControl: ReactNode;
  onLogout: () => void;
}) {
  const [portal, setPortal] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<UiError>("");
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
      setError(asUiError(err));
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
      setError(asUiError(err));
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
        setError(asUiError(err));
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
        setError(asUiError(err));
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
        setError(asUiError(err));
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
                <BrandMark size={19} />
              </span>
              jetyet<span className="brand-period">.</span>
            </a>
            <Chip>{translate("Portal")}</Chip>
          </div>
          <div className="command-right">
            {languageControl}
            <Button
              variant="icon"
              aria-label={
                theme === "dark"
                  ? translate("Switch to light mode")
                  : translate("Switch to dark mode")
              }
              onClick={onToggleTheme}
              title={
                theme === "dark"
                  ? translate("Light mode")
                  : translate("Dark mode")
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button
              variant="icon"
              aria-label={translate("Refresh portal")}
              className={refreshing ? "spinning" : ""}
              disabled={controlsDisabled}
              onClick={requestRefresh}
              title={translate("Refresh")}
            >
              <RefreshCw size={15} />
            </Button>
            <button
              type="button"
              className="account-chip"
              onClick={onLogout}
              aria-label={translate("Sign out ({0})", session.username)}
              title={translate("Sign out ({0})", session.username)}
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
              <span>{localizeError(error)}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label={translate("Dismiss error")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="panel portal-loading muted">
              {translate("Loading subscription portal…")}
            </div>
          ) : portal ? (
            <>
              <section className="portal-hero-bar">
                <div className="portal-identity">
                  <h1>{portal.name}</h1>
                  <div className="chip-group">
                    <Chip mono>{session.username}</Chip>
                    <Badge tone={portal.expired ? "warning" : "good"}>
                      {portal.expired
                        ? translate("Expired")
                        : translate("Active")}
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
                    {translate("New personal template")}
                  </Button>
                )}
              </section>

              {portal.expired ? (
                <section className="portal-expired-banner" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>{translate("Subscription expired")}</strong>
                    <p>
                      {translate(
                        "Subscription links are unavailable while expired. You can still create, edit, and preview personal templates.",
                      )}
                    </p>
                  </div>
                </section>
              ) : (
                <section className="panel portal-links-panel">
                  <div className="panel-heading compact">
                    <div className="chip-group">
                      <Link2 size={15} className="muted" />
                      <h2>{translate("Subscription links")}</h2>
                    </div>
                  </div>
                  {portal.defaultLink || selectedSummary ? (
                    <div className="portal-links-list">
                      {portal.defaultLink && (
                        <div className="portal-link-row is-default">
                          <div className="portal-link-meta">
                            <strong>{translate("Default subscription")}</strong>
                            <div className="chip-group">
                              <Badge tone="good">{translate("Default")}</Badge>
                              {defaultTemplateSummary && (
                                <Chip>
                                  {translate("Choice:") + " "}
                                  {defaultTemplateSummary.name}
                                </Chip>
                              )}
                            </div>
                          </div>
                          <ScrollArea
                            axis="x"
                            className="portal-link-url mono"
                            title={portal.defaultLink}
                          >
                            {portal.defaultLink}
                          </ScrollArea>
                          <div className="link-card-actions">
                            <CopyButton
                              text={portal.defaultLink}
                              label={translate("Copy")}
                              copiedLabel={translate("Copied")}
                              ariaLabel={translate(
                                "Copy default subscription link",
                              )}
                              variant="primary"
                              className="link-action-btn"
                            />
                            <a
                              href={portal.defaultLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="icon-button link-open-btn"
                              title={translate("Open default subscription")}
                              aria-label={translate(
                                "Open default subscription",
                              )}
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </div>
                      )}
                      {selectedSummary &&
                        (detailLoading && !activeDetail ? (
                          <div className="portal-link-status muted">
                            {translate(
                              "Loading pinned link for {0}…",
                              selectedSummary.name,
                            )}
                          </div>
                        ) : activeDetail?.link ? (
                          <div className="portal-link-row">
                            <div className="portal-link-meta">
                              <strong>{activeDetail.name}</strong>
                              <div className="chip-group">
                                <Chip>{translate("Pinned")}</Chip>
                                <Chip>
                                  {activeDetail.personal
                                    ? translate("Personal")
                                    : translate("Assigned")}
                                </Chip>
                                {activeDetail.id === portal.defaultTemplate && (
                                  <Badge tone="good">
                                    {translate("Default choice")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <ScrollArea
                              axis="x"
                              className="portal-link-url mono"
                              title={activeDetail.link}
                            >
                              {activeDetail.link}
                            </ScrollArea>
                            <div className="link-card-actions">
                              <CopyButton
                                text={activeDetail.link}
                                label={translate("Copy")}
                                copiedLabel={translate("Copied")}
                                ariaLabel={translate(
                                  "Copy pinned link for {0}",
                                  activeDetail.name,
                                )}
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
                                title={translate("Open {0}", activeDetail.name)}
                                aria-label={translate(
                                  "Open {0}",
                                  activeDetail.name,
                                )}
                              >
                                <ExternalLink size={14} />
                              </a>
                            </div>
                          </div>
                        ) : activeDetail ? (
                          <div className="portal-link-status muted">
                            {translate(
                              "Publish “{0}” to get its pinned template link.",
                              activeDetail.name,
                            )}
                          </div>
                        ) : null)}
                    </div>
                  ) : (
                    <div className="portal-links-empty muted">
                      {translate(
                        "No published subscription links are available yet.",
                      )}
                    </div>
                  )}
                </section>
              )}

              {templates.length === 0 ? (
                <section className="panel">
                  <Empty title={translate("No templates available")}>
                    {translate(
                      "Ask your administrator to assign a subscription template.",
                    )}
                  </Empty>
                </section>
              ) : (
                <section className="portal-workbench">
                  <aside
                    className="panel portal-sidebar"
                    aria-label={translate("Templates")}
                  >
                    <div className="portal-side-section">
                      <div className="portal-side-head">
                        <span className="kpi-label">
                          {translate("ASSIGNED TEMPLATES")}
                        </span>
                        <span className="count">
                          {formatNumber(assignedTemplates.length)}
                        </span>
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
                                <span className="portal-tpl-name">
                                  {t.name}
                                </span>
                                <span className="chip-group">
                                  {isDefault && (
                                    <Badge tone="good">
                                      {translate("Default")}
                                    </Badge>
                                  )}
                                  {!t.published && (
                                    <Badge tone="neutral">
                                      {translate("Draft")}
                                    </Badge>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="portal-side-empty muted">
                          {translate("None assigned.")}
                        </p>
                      )}
                    </div>

                    <div className="portal-side-section">
                      <div className="portal-side-head">
                        <span className="kpi-label">
                          {translate("PERSONAL TEMPLATES")}
                        </span>
                        <span className="count">
                          {formatNumber(personalTemplates.length)}
                        </span>
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
                                <span className="portal-tpl-name">
                                  {t.name}
                                </span>
                                <span className="chip-group">
                                  {isDefault && (
                                    <Badge tone="good">
                                      {translate("Default")}
                                    </Badge>
                                  )}
                                  {t.published && t.draft && (
                                    <Badge tone="warning">
                                      {translate("Draft edits")}
                                    </Badge>
                                  )}
                                  <Badge
                                    tone={t.published ? "good" : "neutral"}
                                  >
                                    {t.published
                                      ? translate("Published")
                                      : translate("Draft")}
                                  </Badge>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="portal-side-empty muted">
                          {translate(
                            "Copy any published template to customize rules and groups.",
                          )}
                        </p>
                      )}
                    </div>
                  </aside>

                  <div className="portal-main">
                    {detailLoading && !activeDetail ? (
                      <div className="panel portal-loading muted">
                        {translate("Loading template…")}
                      </div>
                    ) : !activeDetail ? (
                      <div className="panel">
                        <Empty title={translate("Select a template")}>
                          {translate(
                            "Choose an assigned or personal template to inspect or edit.",
                          )}
                        </Empty>
                      </div>
                    ) : !activeDetail.personal ? (
                      <div className="studio-card portal-assigned-view">
                        <div className="portal-detail-head">
                          <div className="portal-detail-title">
                            <FileCode2 size={17} className="muted" />
                            <h2>{activeDetail.name}</h2>
                            <Chip>{translate("Assigned")}</Chip>
                            {activeDetail.id === portal.defaultTemplate && (
                              <Badge tone="good">
                                {translate("Default choice")}
                              </Badge>
                            )}
                            <Badge
                              tone={activeDetail.published ? "good" : "neutral"}
                            >
                              {activeDetail.published
                                ? translate("Published")
                                : translate("Draft")}
                            </Badge>
                          </div>
                          <div className="portal-detail-actions">
                            {!portal.expired && activeDetail.link && (
                              <CopyButton
                                text={activeDetail.link}
                                label={translate("Copy link")}
                                copiedLabel={translate("Copied")}
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
                                {translate("Copy as personal")}
                              </Button>
                            )}
                            <Button
                              variant="primary"
                              disabled={controlsDisabled}
                              onClick={() => void runPreview()}
                            >
                              <Eye size={14} />
                              {busyAction === "preview"
                                ? translate("Rendering…")
                                : translate("Preview")}
                            </Button>
                          </div>
                        </div>

                        {!portal.expired && activeDetail.link && (
                          <div className="portal-inline-link">
                            <span className="kpi-label">
                              {translate("PINNED TEMPLATE LINK")}
                            </span>
                            <ScrollArea axis="x" className="link-url mono">
                              {activeDetail.link}
                            </ScrollArea>
                          </div>
                        )}

                        {previewText ? (
                          <div className="portal-preview-wrap">
                            <div className="portal-preview-head">
                              <span className="kpi-label">
                                {translate("REDACTED PREVIEW")}
                              </span>
                              <CopyButton
                                text={previewText}
                                label={translate("Copy preview")}
                                copiedLabel={translate("Copied")}
                              />
                            </div>
                            <ScrollArea className="code-output ide-output">
                              <pre>{previewText}</pre>
                            </ScrollArea>
                          </div>
                        ) : (
                          <div className="ide-empty">
                            <p className="muted">
                              {translate(
                                "Select Preview to render a redacted client configuration with placeholder node details.",
                              )}
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
                                aria-label={translate("Personal template name")}
                                placeholder={translate("Template name…")}
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
                                <Chip>{translate("Personal")}</Chip>
                                {activeDetail.id === portal.defaultTemplate && (
                                  <Badge tone="good">
                                    {translate("Default choice")}
                                  </Badge>
                                )}
                                {activeDetail.published &&
                                  activeDetail.draft && (
                                    <Badge tone="warning">
                                      {translate("Draft edits")}
                                    </Badge>
                                  )}
                                <Badge
                                  tone={
                                    activeDetail.published ? "good" : "neutral"
                                  }
                                >
                                  {activeDetail.published
                                    ? translate("Published")
                                    : translate("Draft")}
                                </Badge>
                                {dirty && (
                                  <Badge tone="warning">
                                    {translate("Unsaved")}
                                  </Badge>
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
                                  ? translate("Saving…")
                                  : translate("Save draft")}
                              </Button>
                              <Button
                                disabled={controlsDisabled || !draftName.trim()}
                                onClick={() => void runPreview()}
                              >
                                <Eye size={14} />
                                {busyAction === "preview"
                                  ? translate("Previewing…")
                                  : dirty
                                    ? translate("Save & preview")
                                    : translate("Preview")}
                              </Button>
                              <Button
                                variant="primary"
                                disabled={!canPublish}
                                onClick={() => void runPublish()}
                              >
                                <Send size={14} />
                                {busyAction === "publish"
                                  ? translate("Publishing…")
                                  : translate("Publish")}
                              </Button>
                            </div>
                          </div>
                          {!portal.expired && activeDetail.link && (
                            <div className="portal-inline-link">
                              <span className="kpi-label">
                                {translate("PINNED PERSONAL LINK")}
                              </span>
                              <div className="portal-inline-link-row">
                                <ScrollArea axis="x" className="link-url mono">
                                  {activeDetail.link}
                                </ScrollArea>
                                <CopyButton
                                  text={activeDetail.link}
                                  label={translate("Copy")}
                                  copiedLabel={translate("Copied")}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="ide-grid">
                          <div className="studio-card ide-pane">
                            <div className="studio-card-head">
                              <span className="kpi-label">
                                {translate("TEMPLATE SOURCE")}
                              </span>
                              <Chip mono>Liquid · YAML</Chip>
                            </div>
                            <TextArea
                              className="template-source ide-editor"
                              aria-label={translate("Personal template body")}
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
                                {translate("REDACTED PREVIEW")}
                              </span>
                              <div className="chip-group">
                                {previewedSaved && !dirty && (
                                  <Badge tone="good">
                                    {translate("Validated")}
                                  </Badge>
                                )}
                                {previewText && (
                                  <CopyButton
                                    text={previewText}
                                    label={translate("Copy")}
                                    copiedLabel={translate("Copied")}
                                  />
                                )}
                              </div>
                            </div>
                            {previewText ? (
                              <ScrollArea className="code-output ide-output">
                                <pre>{previewText}</pre>
                              </ScrollArea>
                            ) : (
                              <div className="ide-empty">
                                <p className="muted">
                                  {dirty
                                    ? translate(
                                        "Save and preview your edits before publishing.",
                                      )
                                    : translate(
                                        "Click Preview to validate your saved draft and inspect redacted output.",
                                      )}
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
          title={translate("Discard unsaved changes?")}
          action={translate("Discard changes")}
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
              ? translate(
                  "You have unsaved edits to “{0}”. Switching to “{1}” will discard them.",
                  activeDetail?.name || translate("this template"),
                  pendingDiscard.targetName,
                )
              : pendingDiscard.type === "refresh"
                ? translate(
                    "You have unsaved edits to “{0}”. Refreshing will discard them.",
                    activeDetail?.name || translate("this template"),
                  )
                : translate(
                    "You have unsaved edits to “{0}”. Creating a new personal template will discard them.",
                    activeDetail?.name || translate("this template"),
                  )}
          </p>
        </Confirm>
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {localizeMessage(toast)}
        </div>
      )}
    </div>
  );
}
