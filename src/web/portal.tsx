import {
  asUiError,
  type UiError,
  localizeError,
  localizeMessage,
  t as translate,
} from "./i18n";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  LogOut,
  Moon,
  Plus,
  QrCode,
  Send,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./client";
import {
  Badge,
  BrandMark,
  BrandWordmark,
  ScrollArea,
  Button,
  Chip,
  Confirm,
  CopyButton,
  Empty,
  Field,
  Input,
  Modal,
  ModalBody,
  QrCodeModal,
  Select,
  TemplateAuthoringHelp,
  TextArea,
} from "./components";
import { PortalTrafficSection } from "./components/PortalTraffic";
import {
  formatLabel,
  SUBSCRIPTION_FORMATS,
  templateSyntaxLabel,
} from "./labels";
import type {
  PortalData,
  PortalTemplateDetail,
  PortalTemplateSummary,
  Session,
} from "./types";

type PendingDiscard =
  | { type: "switch"; targetId: string; targetName: string }
  | { type: "create"; sourceId: string }
  | { type: "close" };

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name?: unknown }).name === "AbortError";
}

function initialTemplateId(portal: PortalData | null) {
  if (!portal) return "";
  return (
    portal.templates.find(
      (item) => item.id === portal.defaultTemplates?.[item.format],
    )?.id ??
    portal.templates[0]?.id ??
    ""
  );
}

function PortalLink({
  url,
  label,
  description,
  primary = false,
  allowOpen = true,
  onShowQr,
}: {
  url: string;
  label: string;
  description?: string;
  primary?: boolean;
  allowOpen?: boolean;
  onShowQr: () => void;
}) {
  return (
    <div className="portal-link">
      <div className="portal-link-value">
        {description && <span>{description}</span>}
        <code title={url}>{url}</code>
      </div>
      <div className="link-card-actions">
        <CopyButton
          text={url}
          ariaLabel={translate("Copy link for {0}", label)}
          variant={primary ? "primary" : "subtle"}
        />
        <Button
          variant="icon"
          className="link-open-btn"
          aria-label={translate("Show QR code for {0}", label)}
          title={translate("Subscription QR Code")}
          onClick={onShowQr}
        >
          <QrCode size={14} aria-hidden="true" />
        </Button>
        {allowOpen && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-button link-open-btn"
            aria-label={translate("Open {0}", label)}
            title={translate("Open URL")}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
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
  const selectedSource = sources.find((s) => s.id === sourceId);

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
        <ModalBody>
          <Field
            label={translate("Copy from published template")}
            hint={
              selectedSource
                ? translate(
                    "Inherits format: {0}",
                    formatLabel(selectedSource.format),
                  )
                : undefined
            }
          >
            <Select
              value={sourceId}
              disabled={busy}
              placeholder={translate("Select source template")}
              options={sources.map((s) => ({
                value: s.id,
                label: `${s.name} · ${formatLabel(s.format)}${
                  s.personal ? ` (${translate("Personal")})` : ""
                }`,
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
        </ModalBody>
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
  initialPortal,
  theme,
  onToggleTheme,
  languageControl,
  onLogout,
}: {
  session: Session;
  initialPortal: PortalData | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  languageControl: ReactNode;
  onLogout: () => void;
}) {
  const [portal, setPortal] = useState(initialPortal);
  const [loading, setLoading] = useState(!initialPortal);
  const [error, setError] = useState<UiError>("");
  const [toast, setToast] = useState("");

  const [selectedId, setSelectedId] = useState(() =>
    initialTemplateId(initialPortal),
  );
  const [editing, setEditing] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);

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
  const [qrModal, setQrModal] = useState<{
    label: string;
    tag?: string;
    url: string;
  } | null>(null);
  const [templateLinks, setTemplateLinks] = useState<
    Record<string, string | null>
  >({});

  const selectedIdRef = useRef(selectedId);
  const savedBodies = useRef(new Map<string, string>());
  const opAbortRef = useRef<AbortController | null>(null);

  const resetPreview = () => {
    setPreviewText("");
    setPreviewedSaved(false);
  };

  const selectTemplate = (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setEditing(false);
    setError("");
    resetPreview();
  };

  const showEditor = (name: string, body: string) => {
    setDraftName(name);
    setDraftBody(body);
    setSavedSnapshot({ name, body });
    setEditing(true);
    resetPreview();
  };

  const openEditor = async (item: PortalTemplateSummary) => {
    const cached = savedBodies.current.get(item.id);
    if (cached !== undefined) {
      showEditor(item.name, cached);
      return;
    }

    const controller = new AbortController();
    opAbortRef.current = controller;
    setEditorLoading(true);
    setError("");
    try {
      const detail = (await api(
        `portal/templates/${item.id}`,
        "GET",
        undefined,
        controller.signal,
      )) as PortalTemplateDetail;
      if (controller.signal.aborted) return;
      const body = detail.body ?? "";
      updateTemplate(detail);
      setTemplateLinks((prev) => ({ ...prev, [detail.id]: detail.link }));
      savedBodies.current.set(item.id, body);
      showEditor(detail.name, body);
    } catch (err) {
      if (!isAbortError(err)) setError(asUiError(err));
    } finally {
      if (!controller.signal.aborted) setEditorLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (!initialPortal)
      void api("portal", "GET", undefined, controller.signal)
        .then((data: PortalData) => {
          if (controller.signal.aborted) return;
          setPortal(data);
          selectedIdRef.current = initialTemplateId(data);
          setSelectedId(selectedIdRef.current);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(asUiError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => {
      controller.abort();
      opAbortRef.current?.abort();
    };
  }, [initialPortal]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const templates = portal?.templates ?? [];
  const traffic = portal?.traffic;
  const assignedTemplates = templates.filter((item) => !item.personal);
  const personalTemplates = templates.filter((item) => item.personal);
  const publishedSources = templates.filter((item) => item.published);
  const selected = templates.find((item) => item.id === selectedId);
  const defaultMihomo = templates.find(
    (item) => item.id === portal?.defaultTemplates?.mihomo,
  );
  const defaultSingBox = templates.find(
    (item) => item.id === portal?.defaultTemplates?.["sing-box"],
  );
  const fallbackPinnedLink =
    portal?.defaultLink && selected?.published
      ? `${portal.defaultLink}?template=${encodeURIComponent(selected.id)}`
      : null;
  const pinnedLink = selected?.published
    ? selected.id in templateLinks
      ? templateLinks[selected.id]
      : fallbackPinnedLink
    : null;

  useEffect(() => {
    if (
      !portal ||
      portal.expired ||
      !selected?.published ||
      selected.id in templateLinks
    ) {
      return;
    }
    const controller = new AbortController();
    void api(
      `portal/templates/${selected.id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((detail: PortalTemplateDetail) => {
        if (controller.signal.aborted) return;
        setTemplateLinks((prev) => ({ ...prev, [detail.id]: detail.link }));
        if (detail.personal && typeof detail.body === "string") {
          savedBodies.current.set(detail.id, detail.body);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [portal, selected?.id, selected?.published, templateLinks]);

  const controlsDisabled = !!busyAction || editorLoading;
  const dirty =
    editing &&
    (draftName !== savedSnapshot.name || draftBody !== savedSnapshot.body);

  function updateTemplate(item: PortalTemplateSummary) {
    const { id, name, format, personal, published, draft } = item;
    const summary = { id, name, format, personal, published, draft };
    setPortal((current) => {
      if (!current) return current;
      const templates = current.templates.some((entry) => entry.id === id)
        ? current.templates.map((entry) => (entry.id === id ? summary : entry))
        : [...current.templates, summary];
      return { ...current, templates };
    });
  }

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
      savedBodies.current.set(saved.id, body);
      updateTemplate(saved);
      return saved;
    } catch (err) {
      if (!isAbortError(err)) {
        setError(asUiError(err));
      }
      return null;
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!selected?.personal || !editing || controlsDisabled) return false;
    const targetId = selected.id;
    try {
      const saved = await persistDraft(targetId, draftName, draftBody);
      if (!saved) return false;
      if (selectedIdRef.current === targetId) {
        setToast("Draft saved");
      }
      return true;
    } finally {
      setBusyAction("");
    }
  };

  const runPreview = async () => {
    if (!selected || controlsDisabled) return;
    const targetId = selected.id;
    setError("");
    if (selected.personal && dirty) {
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
    !!selected?.personal &&
    editing &&
    !controlsDisabled &&
    !dirty &&
    previewedSaved &&
    selected.draft;

  const runPublish = async () => {
    if (!canPublish || !selected) return;
    const targetId = selected.id;
    opAbortRef.current?.abort();
    const controller = new AbortController();
    opAbortRef.current = controller;
    setBusyAction("publish");
    setError("");
    try {
      const published = (await api(
        `portal/templates/${targetId}/publish`,
        "POST",
        undefined,
        controller.signal,
      )) as PortalTemplateSummary;
      if (controller.signal.aborted || selectedIdRef.current !== targetId) {
        return;
      }
      updateTemplate(published);
      setTemplateLinks((prev) => {
        const next = { ...prev };
        delete next[published.id];
        return next;
      });
      setPreviewedSaved(false);
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
    if (controlsDisabled || t.id === selectedId) return;
    if (dirty) {
      setPendingDiscard({
        type: "switch",
        targetId: t.id,
        targetName: t.name,
      });
      return;
    }
    selectTemplate(t.id);
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
              <BrandMark size={19} />
              <BrandWordmark />
            </a>
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
              ) : portal.defaultLink || portal.formats ? (
                <section className="studio-card portal-subscription">
                  <div>
                    <h2>{translate("Default subscription")}</h2>
                    <p className="muted">
                      {defaultMihomo && defaultSingBox
                        ? translate(
                            "Automatic link selects mihomo ({0}) or sing-box ({1}) by client, or use a fixed format link below.",
                            defaultMihomo.name,
                            defaultSingBox.name,
                          )
                        : translate(
                            "Copy or scan the automatic link, or pick a fixed output format below.",
                          )}
                    </p>
                  </div>
                  {portal.defaultLink && (
                    <PortalLink
                      url={portal.defaultLink}
                      label={translate("Default subscription")}
                      description={translate("Automatic · Detects client")}
                      primary
                      allowOpen={false}
                      onShowQr={() =>
                        setQrModal({
                          label: translate("Default subscription"),
                          tag: translate("Automatic"),
                          url: portal.defaultLink!,
                        })
                      }
                    />
                  )}
                  {portal.formats && (
                    <div className="portal-format-links">
                      {SUBSCRIPTION_FORMATS.map((fmt) => {
                        const url = portal.formats?.[fmt];
                        if (!url) return null;
                        const defaultTpl =
                          fmt !== "shadowrocket"
                            ? templates.find(
                                (item) =>
                                  item.id === portal.defaultTemplates?.[fmt],
                              )
                            : undefined;
                        const description =
                          fmt === "shadowrocket"
                            ? translate("Shadowrocket · Hysteria 2 node list")
                            : defaultTpl
                              ? translate(
                                  "{0} · Default: {1}",
                                  formatLabel(fmt),
                                  defaultTpl.name,
                                )
                              : formatLabel(fmt);
                        return (
                          <PortalLink
                            key={fmt}
                            url={url}
                            label={formatLabel(fmt)}
                            description={description}
                            onShowQr={() =>
                              setQrModal({
                                label: formatLabel(fmt),
                                tag: formatLabel(fmt),
                                url,
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : (
                <section className="portal-expired-banner" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>{translate("No subscription links yet")}</strong>
                    <p>
                      {translate(
                        "Subscription links appear once at least one active node is assigned to your account.",
                      )}
                    </p>
                  </div>
                </section>
              )}

              {traffic && <PortalTrafficSection traffic={traffic} />}

              {selected ? (
                <section className="portal-workbench">
                  <div className="studio-card portal-template-controls">
                    <div className="portal-picker-row">
                      <div className="portal-picker">
                        <label htmlFor="portal-template">
                          {translate("Template")}
                        </label>
                        <Select
                          id="portal-template"
                          value={selectedId}
                          disabled={controlsDisabled}
                          onChange={(value) => {
                            const item = templates.find(
                              (entry) => entry.id === value,
                            );
                            if (item) requestSelectTemplate(item);
                          }}
                          options={[
                            {
                              label: translate("ASSIGNED TEMPLATES"),
                              items: assignedTemplates,
                            },
                            {
                              label: translate("PERSONAL TEMPLATES"),
                              items: personalTemplates,
                            },
                          ]
                            .filter((group) => group.items.length > 0)
                            .map((group) => ({
                              label: group.label,
                              options: group.items.map((item) => ({
                                value: item.id,
                                label:
                                  `${item.name} · ${formatLabel(item.format)}` +
                                  (item.id ===
                                  portal.defaultTemplates?.[item.format]
                                    ? ` · ${translate("Default")}`
                                    : !item.published
                                      ? ` · ${translate("Draft")}`
                                      : ""),
                              })),
                            }))}
                        />
                      </div>
                      <div className="chip-group portal-template-badges">
                        <Chip mono>{formatLabel(selected.format)}</Chip>
                        <Chip>
                          {selected.personal
                            ? translate("Personal")
                            : translate("Assigned")}
                        </Chip>
                        {selected.id ===
                          portal.defaultTemplates?.[selected.format] && (
                          <Badge tone="good">{translate("Default")}</Badge>
                        )}
                        {selected.personal && (
                          <Badge
                            tone={
                              selected.published && !selected.draft
                                ? "good"
                                : "neutral"
                            }
                          >
                            {selected.draft
                              ? translate("Draft")
                              : translate("Published")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="portal-template-summary">
                      {pinnedLink ? (
                        <PortalLink
                          key={selected.id}
                          url={pinnedLink}
                          label={selected.name}
                          description={translate(
                            "Pinned link · {0}",
                            formatLabel(selected.format),
                          )}
                          onShowQr={() =>
                            setQrModal({
                              label: selected.name,
                              tag: formatLabel(selected.format),
                              url: pinnedLink,
                            })
                          }
                        />
                      ) : (
                        !portal.expired &&
                        !selected.published && (
                          <p className="muted">
                            {translate(
                              "Publish “{0}” to get its pinned template link.",
                              selected.name,
                            )}
                          </p>
                        )
                      )}
                    </div>
                    <div className="portal-detail-actions">
                      {!editing && (
                        <Button
                          disabled={controlsDisabled}
                          onClick={() => void runPreview()}
                        >
                          <Eye size={14} aria-hidden="true" />
                          {busyAction === "preview"
                            ? translate("Previewing…")
                            : translate("Preview")}
                        </Button>
                      )}
                      {selected.personal && !editing && (
                        <Button
                          disabled={controlsDisabled}
                          onClick={() => void openEditor(selected)}
                        >
                          {editorLoading
                            ? translate("Loading template…")
                            : translate("Edit template")}
                        </Button>
                      )}
                      {editing && (
                        <Button
                          variant="text"
                          disabled={controlsDisabled}
                          onClick={() => {
                            if (dirty) setPendingDiscard({ type: "close" });
                            else selectTemplate(selected.id);
                          }}
                        >
                          {translate("Close editor")}
                        </Button>
                      )}
                      {publishedSources.length > 0 && (
                        <Button
                          variant="text"
                          disabled={controlsDisabled}
                          onClick={() =>
                            requestCreateModal(
                              selected.published
                                ? selected.id
                                : publishedSources[0].id,
                            )
                          }
                        >
                          <Plus size={14} aria-hidden="true" />
                          {translate("New personal template")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {editing && selected.personal ? (
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
                              <Chip mono>{formatLabel(selected.format)}</Chip>
                              <Chip>{translate("Personal")}</Chip>
                              <Badge
                                tone={
                                  selected.published && !selected.draft
                                    ? "good"
                                    : "neutral"
                                }
                              >
                                {selected.draft
                                  ? translate("Draft")
                                  : translate("Published")}
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
                                controlsDisabled || !dirty || !draftName.trim()
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
                      </div>

                      <TemplateAuthoringHelp
                        format={selected.format}
                        canInsertStarter={!draftBody.trim()}
                        disabled={controlsDisabled}
                        onInsertStarter={(starter) => {
                          setDraftBody(starter);
                          setPreviewedSaved(false);
                          setPreviewText("");
                        }}
                      />

                      <div className="ide-grid">
                        <div className="studio-card ide-pane">
                          <div className="studio-card-head">
                            <span className="kpi-label">
                              {translate("TEMPLATE SOURCE")}
                            </span>
                            <Chip mono>
                              {templateSyntaxLabel(selected.format)}
                            </Chip>
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
                  ) : (
                    previewText && (
                      <div className="studio-card portal-preview-wrap">
                        <div className="portal-preview-head">
                          <h2>{translate("Redacted preview")}</h2>
                          <CopyButton
                            text={previewText}
                            label={translate("Copy preview")}
                          />
                        </div>
                        <ScrollArea className="code-output">
                          <pre>{previewText}</pre>
                        </ScrollArea>
                      </div>
                    )
                  )}
                </section>
              ) : (
                <section className="panel">
                  <Empty title={translate("No templates available")}>
                    {translate(
                      "Ask your administrator to assign a subscription template.",
                    )}
                  </Empty>
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
            })) as PortalTemplateDetail;
            setCreateModalSource(null);
            const body = created.body ?? "";
            updateTemplate(created);
            savedBodies.current.set(created.id, body);
            selectTemplate(created.id);
            showEditor(created.name, body);
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
              selectTemplate(action.targetId);
            } else if (action.type === "create") {
              setCreateModalSource(action.sourceId);
            } else {
              selectTemplate(selectedId);
            }
          }}
        >
          <p className="muted">
            {pendingDiscard.type === "switch"
              ? translate(
                  "You have unsaved edits to “{0}”. Switching to “{1}” will discard them.",
                  selected?.name || translate("this template"),
                  pendingDiscard.targetName,
                )
              : pendingDiscard.type === "create"
                ? translate(
                    "You have unsaved edits to “{0}”. Creating a new personal template will discard them.",
                    selected?.name || translate("this template"),
                  )
                : translate(
                    "Closing the editor will discard your unsaved changes.",
                  )}
          </p>
        </Confirm>
      )}

      {qrModal && (
        <QrCodeModal
          title={qrModal.label}
          tag={qrModal.tag}
          url={qrModal.url}
          onClose={() => setQrModal(null)}
        />
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
