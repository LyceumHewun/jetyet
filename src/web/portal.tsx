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
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, copyToClipboard } from "./client";
import {
  Badge,
  Button,
  Chip,
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
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
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
          onCreate(sourceId, trimmed)
            .catch((err) => setError((err as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-body">
          <Field label="Copy from published template">
            <Select
              value={sourceId}
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
          <Button onClick={onClose}>Cancel</Button>
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
  const [linkMap, setLinkMap] = useState<Record<string, string | null>>({});

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
  const [copiedAll, setCopiedAll] = useState(false);

  const loadPortal = useCallback(async (keepSelection = true) => {
    setRefreshing(true);
    try {
      const data = (await api("portal")) as PortalData;
      setPortal(data);
      setError("");

      const ids = new Set(data.templates.map((t) => t.id));
      setSelectedId((prev) => {
        if (keepSelection && prev && ids.has(prev)) return prev;
        if (data.defaultTemplate && ids.has(data.defaultTemplate)) {
          return data.defaultTemplate;
        }
        return data.templates[0]?.id || "";
      });

      if (data.expired) {
        setLinkMap({});
      } else {
        const published = data.templates.filter((t) => t.published);
        const entries = await Promise.all(
          published.map(async (t) => {
            try {
              const d = (await api(
                `portal/templates/${t.id}`,
              )) as PortalTemplateDetail;
              return [t.id, d.link] as const;
            } catch {
              return [t.id, null] as const;
            }
          }),
        );
        setLinkMap(Object.fromEntries(entries));
      }
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return null;
    }
    setDetailLoading(true);
    try {
      const d = (await api(
        `portal/templates/${id}`,
      )) as PortalTemplateDetail;
      setDetail(d);
      setLinkMap((prev) => ({ ...prev, [d.id]: d.link }));
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
      setError((err as Error).message);
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPortal(false);
  }, [loadPortal]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

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

  const publishedLinks = useMemo(() => {
    if (!portal || portal.expired) return [];
    const items = templates
      .filter((t) => t.published && linkMap[t.id])
      .map((t) => ({
        id: t.id,
        name: t.name,
        personal: t.personal,
        isDefault: t.id === portal.defaultTemplate,
        url: linkMap[t.id] as string,
      }));
    items.sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0));
    return items;
  }, [portal, templates, linkMap]);

  const dirty =
    !!detail?.personal &&
    (draftName !== savedSnapshot.name || draftBody !== savedSnapshot.body);

  const saveDraft = async (): Promise<boolean> => {
    if (!detail?.personal) return false;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError("Template name is required.");
      return false;
    }
    setBusyAction("save");
    setError("");
    try {
      await api(`portal/templates/${detail.id}`, "PUT", {
        name: trimmed,
        body: draftBody,
      });
      setDraftName(trimmed);
      setSavedSnapshot({ name: trimmed, body: draftBody });
      setPreviewedSaved(false);
      setPreviewText("");
      setDetail((prev) =>
        prev ? { ...prev, name: trimmed, draft: true } : prev,
      );
      await loadPortal(true);
      setToast("Draft saved");
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusyAction("");
    }
  };

  const runPreview = async () => {
    if (!detail) return;
    setError("");
    if (detail.personal && dirty) {
      const trimmed = draftName.trim();
      if (!trimmed) {
        setError("Template name is required.");
        return;
      }
      setBusyAction("save");
      try {
        await api(`portal/templates/${detail.id}`, "PUT", {
          name: trimmed,
          body: draftBody,
        });
        setDraftName(trimmed);
        setSavedSnapshot({ name: trimmed, body: draftBody });
        setDetail((prev) =>
          prev ? { ...prev, name: trimmed, draft: true } : prev,
        );
      } catch (err) {
        setError((err as Error).message);
        setBusyAction("");
        return;
      }
    }

    setBusyAction("preview");
    try {
      const res = (await api(
        `portal/templates/${detail.id}/preview`,
        "POST",
      )) as { text: string };
      setPreviewText(res.text || "");
      setPreviewedSaved(true);
      if (detail.personal) {
        await loadPortal(true);
      }
    } catch (err) {
      setPreviewedSaved(false);
      setError((err as Error).message);
    } finally {
      setBusyAction("");
    }
  };

  const runPublish = async () => {
    if (!detail?.personal || dirty || !previewedSaved) return;
    setBusyAction("publish");
    setError("");
    try {
      await api(`portal/templates/${detail.id}/publish`, "POST");
      await Promise.all([loadPortal(true), loadDetail(detail.id)]);
      setToast("Personal template published");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction("");
    }
  };

  const handleCopyAll = async () => {
    if (!publishedLinks.length) return;
    const text = publishedLinks
      .map((item) => `${item.name}${item.isDefault ? " (Default)" : ""}\n${item.url}`)
      .join("\n\n");
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const canPublish =
    !!detail?.personal &&
    !busyAction &&
    !dirty &&
    previewedSaved &&
    (detail.draft || !detail.published);

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
              disabled={refreshing}
              onClick={() => {
                void loadPortal(true);
                if (selectedId) void loadDetail(selectedId);
              }}
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
                    onClick={() =>
                      setCreateModalSource(
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
                      <span className="count">{publishedLinks.length}</span>
                    </div>
                    {publishedLinks.length > 1 && (
                      <Button
                        variant="subtle"
                        onClick={() => void handleCopyAll()}
                      >
                        {copiedAll ? <Check size={13} /> : <Copy size={13} />}
                        {copiedAll ? "Copied all" : "Copy all"}
                      </Button>
                    )}
                  </div>
                  {publishedLinks.length ? (
                    <div className="portal-links-list">
                      {publishedLinks.map((item) => (
                        <div
                          key={item.id}
                          className={
                            "portal-link-row" +
                            (item.isDefault ? " is-default" : "")
                          }
                        >
                          <div className="portal-link-meta">
                            <strong>{item.name}</strong>
                            <div className="chip-group">
                              {item.isDefault && (
                                <Badge tone="good">Default</Badge>
                              )}
                              <Chip>
                                {item.personal ? "Personal" : "Assigned"}
                              </Chip>
                            </div>
                          </div>
                          <div className="portal-link-url mono" title={item.url}>
                            {item.url}
                          </div>
                          <div className="link-card-actions">
                            <CopyButton
                              text={item.url}
                              label="Copy"
                              copiedLabel="Copied"
                              ariaLabel={`Copy link for ${item.name}`}
                              variant={item.isDefault ? "primary" : "subtle"}
                              className="link-action-btn"
                            />
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="icon-button link-open-btn"
                              title={`Open ${item.name}`}
                              aria-label={`Open ${item.name}`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </div>
                      ))}
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
                                className={
                                  "portal-tpl-item" + (active ? " active" : "")
                                }
                                onClick={() => setSelectedId(t.id)}
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
                            return (
                              <button
                                key={t.id}
                                type="button"
                                className={
                                  "portal-tpl-item" + (active ? " active" : "")
                                }
                                onClick={() => setSelectedId(t.id)}
                              >
                                <span className="portal-tpl-name">{t.name}</span>
                                <span className="chip-group">
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
                    {detailLoading && !detail ? (
                      <div className="panel portal-loading muted">
                        Loading template…
                      </div>
                    ) : !detail ? (
                      <div className="panel">
                        <Empty title="Select a template">
                          Choose an assigned or personal template to inspect or
                          edit.
                        </Empty>
                      </div>
                    ) : !detail.personal ? (
                      <div className="studio-card portal-assigned-view">
                        <div className="portal-detail-head">
                          <div className="portal-detail-title">
                            <FileCode2 size={17} className="muted" />
                            <h2>{detail.name}</h2>
                            <Chip>Assigned</Chip>
                            {detail.id === portal.defaultTemplate && (
                              <Badge tone="good">Default</Badge>
                            )}
                            <Badge
                              tone={detail.published ? "good" : "neutral"}
                            >
                              {detail.published ? "Published" : "Draft"}
                            </Badge>
                          </div>
                          <div className="portal-detail-actions">
                            {!portal.expired && detail.link && (
                              <CopyButton
                                text={detail.link}
                                label="Copy link"
                                copiedLabel="Copied"
                              />
                            )}
                            {detail.published && (
                              <Button
                                onClick={() => setCreateModalSource(detail.id)}
                              >
                                <Copy size={14} />
                                Copy as personal
                              </Button>
                            )}
                            <Button
                              variant="primary"
                              disabled={!!busyAction}
                              onClick={() => void runPreview()}
                            >
                              <Eye size={14} />
                              {busyAction === "preview"
                                ? "Rendering…"
                                : "Preview"}
                            </Button>
                          </div>
                        </div>

                        {!portal.expired && detail.link && (
                          <div className="portal-inline-link">
                            <span className="kpi-label">TEMPLATE LINK</span>
                            <div className="link-url mono">{detail.link}</div>
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
                                value={draftName}
                                onChange={(e) => {
                                  setDraftName(e.target.value);
                                  setPreviewedSaved(false);
                                  setPreviewText("");
                                }}
                              />
                              <div className="chip-group">
                                <Chip>Personal</Chip>
                                {detail.published && detail.draft && (
                                  <Badge tone="warning">Draft edits</Badge>
                                )}
                                <Badge
                                  tone={detail.published ? "good" : "neutral"}
                                >
                                  {detail.published ? "Published" : "Draft"}
                                </Badge>
                                {dirty && (
                                  <Badge tone="warning">Unsaved</Badge>
                                )}
                              </div>
                            </div>
                            <div className="portal-detail-actions">
                              <Button
                                disabled={
                                  !!busyAction || !dirty || !draftName.trim()
                                }
                                onClick={() => void saveDraft()}
                              >
                                {busyAction === "save"
                                  ? "Saving…"
                                  : "Save draft"}
                              </Button>
                              <Button
                                disabled={!!busyAction || !draftName.trim()}
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
                          {!portal.expired && detail.link && (
                            <div className="portal-inline-link">
                              <span className="kpi-label">PERSONAL LINK</span>
                              <div className="portal-inline-link-row">
                                <div className="link-url mono">
                                  {detail.link}
                                </div>
                                <CopyButton
                                  text={detail.link}
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
            await loadPortal(false);
            setSelectedId(created.id);
            setToast("Personal draft created");
          }}
        />
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
