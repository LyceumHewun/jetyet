import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  FileCode2,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../client";
import {
  Badge,
  Confirm,
  CopyButton,
  Empty,
  StackDrillDown,
} from "../components";
import type { ViewContext } from "./viewTypes";

const templateChips = [
  { label: "proxies (yaml)", snippet: "{{ proxies | yaml | indent: 2 }}" },
  { label: "choices (yaml)", snippet: "{{ choices | yaml | indent: 6 }}" },
  { label: "user.name", snippet: "{{ user.name }}" },
  { label: "nodes", snippet: "nodes" },
];

export function TemplatesWorkspace({ ctx }: { ctx: ViewContext }) {
  const {
    state,
    route,
    navigate,
    goBackToRoot,
    linkProps,
    refresh,
    confirmModal,
    closeModal,
    notify,
  } = ctx;

  const uid = useId();
  const [search, setSearch] = useState("");
  const isCreating = route.mode === "new";
  const filtered = state.templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.name, t.format].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  const selectedTemplate = isCreating
    ? undefined
    : state.templates.find((t) => t.id === route.id) || filtered[0];

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [userId, setUserId] = useState("");
  const [preview, setPreview] = useState("");
  const [validatedKey, setValidatedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [studioPane, setStudioPane] = useState<"editor" | "preview">("editor");

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const loadedTargetRef = useRef<string>("");

  useEffect(() => {
    const targetKey = isCreating ? "__new__" : selectedTemplate?.id || "";
    if (loadedTargetRef.current !== targetKey) {
      loadedTargetRef.current = targetKey;
      if (isCreating) {
        setName("Custom mihomo");
        setBody(
          state.templates[0]?.body ||
            state.templates[0]?.draft ||
            "mixed-port: 7890\nmode: rule\ndns:\n  enable: true\n  nameserver:\n    - https://1.1.1.1/dns-query\nproxies:\n{{ proxies | yaml | indent: 2 }}\nproxy-groups:\n  - name: Proxy\n    type: select\n    proxies:\n{{ choices | yaml | indent: 6 }}\nrules:\n  - MATCH,Proxy\n",
        );
      } else if (selectedTemplate) {
        setName(selectedTemplate.name || "");
        setBody(selectedTemplate.draft ?? selectedTemplate.body ?? "");
      }
      setPreview("");
      setValidatedKey("");
      setError("");
    }
  }, [isCreating, selectedTemplate?.id, state.templates]);

  useEffect(() => {
    if (!userId && state.users[0]?.id) {
      setUserId(state.users[0].id);
    } else if (userId && !state.users.some((u) => u.id === userId)) {
      setUserId(state.users[0]?.id || "");
    }
  }, [state.users, userId]);

  const validationKey = `${selectedTemplate?.id || "new"}:${userId}:${body}`;
  const isValidated = Boolean(preview && validatedKey === validationKey);

  const insertSnippet = (snippet: string) => {
    const ta = editorRef.current;
    if (!ta) {
      setBody((prev) => prev + "\n" + snippet);
      setPreview("");
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    setPreview("");
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const persistDraft = async (): Promise<string> => {
    if (!name.trim()) throw Error("Template name is required.");
    if (!isCreating && selectedTemplate) {
      await api(`templates/${selectedTemplate.id}`, "PUT", { name, body });
      return selectedTemplate.id;
    }
    const created = await api("templates", "POST", { name, body });
    loadedTargetRef.current = created.id;
    navigate({ section: "templates", id: created.id }, true);
    return created.id;
  };

  const runStudioAction = async (kind: "save" | "preview" | "publish") => {
    setBusy(true);
    setError("");
    try {
      const targetId = await persistDraft();
      if (kind === "save") {
        await refresh();
        notify("Draft saved");
        return;
      }
      if (kind === "preview") {
        if (!userId) throw Error("Select a preview user first.");
        const res = await api(`templates/${targetId}/preview`, "POST", {
          userId,
          body,
        });
        setPreview(res.text || "");
        setValidatedKey(`${targetId}:${userId}:${body}`);
        setStudioPane("preview");
        await refresh();
        notify("Preview validated");
        return;
      }
      if (!userId) throw Error("Select a preview user first.");
      await api(`templates/${targetId}/publish`, "POST", { userId });
      await refresh();
      setPreview("");
      setValidatedKey("");
      notify("Template published");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template action failed");
    } finally {
      setBusy(false);
    }
  };

  const hasDetail = Boolean(route.id || isCreating);

  const listPane = (
    <div className="pane-stack">
      <div className="pane-top">
        <div className="pane-title-row">
          <div>
            <p className="eyebrow">MIHOMO STUDIO</p>
            <h1 id="main-heading" tabIndex={-1}>
              Templates
            </h1>
          </div>
          <a
            {...linkProps({ section: "templates", mode: "new" })}
            className="btn primary compact-button"
          >
            <Plus size={16} aria-hidden="true" />
            <span>New template</span>
          </a>
        </div>

        <search className="pane-search">
          <div className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Templates"
              placeholder="Search template name…"
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
      </div>

      {!filtered.length ? (
        <Empty
          title={search ? "No matching templates" : "No templates yet"}
          icon={<FileCode2 size={26} />}
          action={
            search ? (
              <button type="button" onClick={() => setSearch("")}>
                Clear search
              </button>
            ) : (
              <a
                {...linkProps({ section: "templates", mode: "new" })}
                className="btn primary"
              >
                <Plus size={17} aria-hidden="true" />
                <span>Create template</span>
              </a>
            )
          }
        >
          {search
            ? "Try another template name."
            : "Define complete mihomo YAML configurations using Liquid variables."}
        </Empty>
      ) : (
        <ul className="selector-list" aria-label="Template list">
          {filtered.map((t) => {
            const active = selectedTemplate?.id === t.id && !isCreating;
            const hasDraft = Boolean(t.draft && t.draft !== t.body);
            return (
              <li key={t.id}>
                <a
                  {...linkProps({ section: "templates", id: t.id })}
                  className={active ? "selector-card active" : "selector-card"}
                  aria-current={active ? "true" : undefined}
                >
                  <div className="selector-card-top">
                    <span className="flow-medallion lavender" aria-hidden="true">
                      <FileCode2 size={16} />
                    </span>
                    <div className="selector-title-wrap">
                      <strong>{t.name}</strong>
                      <small>{t.format || "mihomo"} · complete YAML</small>
                    </div>
                    <Badge
                      tone={
                        t.published
                          ? hasDraft
                            ? "warning"
                            : "good"
                          : "neutral"
                      }
                    >
                      {t.published
                        ? hasDraft
                          ? "Draft edit"
                          : "Published"
                        : "Draft"}
                    </Badge>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const activeTemplateExists = Boolean(!isCreating && selectedTemplate);
  const currentDraftDirty = Boolean(
    selectedTemplate &&
      ((selectedTemplate.draft ?? selectedTemplate.body ?? "") !== body ||
        selectedTemplate.name !== name),
  );

  const detailPane =
    !isCreating && !selectedTemplate ? (
      <div className="surface-card detail-empty">
        <Empty
          title="Select or create a template"
          icon={<FileCode2 size={28} />}
          action={
            <a
              {...linkProps({ section: "templates", mode: "new" })}
              className="btn primary"
            >
              <Plus size={17} aria-hidden="true" />
              <span>New template</span>
            </a>
          }
        >
          Edit Liquid YAML and validate rendered mihomo configs side-by-side
          before publishing.
        </Empty>
      </div>
    ) : (
      <div className="detail-stack template-studio">
        <div className="surface-card studio-header-card">
          <div className="studio-top-row">
            <div className="studio-name-field">
              <label htmlFor={`${uid}-tpl-name`} className="visually-hidden">
                Template name
              </label>
              <input
                id={`${uid}-tpl-name`}
                required
                placeholder="Template name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="studio-status-pills">
                <Badge
                  tone={
                    isCreating
                      ? "neutral"
                      : selectedTemplate?.published
                        ? "good"
                        : "neutral"
                  }
                >
                  {isCreating
                    ? "New draft"
                    : selectedTemplate?.published
                      ? "Published"
                      : "Unpublished"}
                </Badge>
                {currentDraftDirty && <Badge tone="warning">Unsaved</Badge>}
              </div>
            </div>

            <div className="studio-action-bar">
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void runStudioAction("save")}
              >
                <Save size={16} aria-hidden="true" />
                <span>Save draft</span>
              </button>
              <button
                type="button"
                disabled={busy || !userId || !name.trim()}
                onClick={() => void runStudioAction("preview")}
              >
                <Play size={16} aria-hidden="true" />
                <span>Validate & preview</span>
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !isValidated || !name.trim()}
                onClick={() => void runStudioAction("publish")}
              >
                <UploadCloud size={16} aria-hidden="true" />
                <span>{busy ? "Publishing…" : "Publish"}</span>
              </button>
              {activeTemplateExists && selectedTemplate && (
                <button
                  type="button"
                  className="danger-outline"
                  aria-label={`Delete ${selectedTemplate.name}`}
                  disabled={busy}
                  onClick={() =>
                    confirmModal(
                      <Confirm
                        title={`Delete ${selectedTemplate.name}?`}
                        action="Delete"
                        danger
                        onClose={closeModal}
                        onConfirm={async () => {
                          await api(`templates/${selectedTemplate.id}`, "DELETE");
                          await refresh();
                          closeModal();
                          navigate({ section: "templates" });
                          notify("Template deleted");
                        }}
                      >
                        <p className="body-copy">
                          Templates assigned to users or serving as the last
                          published template cannot be deleted.
                        </p>
                      </Confirm>,
                    )
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="token-strip" aria-label="Insert template variables">
            <span className="token-label">Insert variable:</span>
            {templateChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="token-chip"
                onClick={() => insertSnippet(chip.snippet)}
              >
                <code>{chip.label}</code>
              </button>
            ))}
          </div>

          {!state.users.length && (
            <p className="notice-banner warning">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                Create at least one subscription user to validate and publish
                this template.{" "}
                <a
                  {...linkProps({ section: "users", mode: "new" })}
                  className="inline-link"
                >
                  Add user <ArrowRight size={14} aria-hidden="true" />
                </a>
              </span>
            </p>
          )}

          {error && (
            <p className="form-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <div className="studio-mobile-switch">
          <div className="segmented-tabs" role="tablist" aria-label="Studio pane">
            <button
              type="button"
              role="tab"
              aria-selected={studioPane === "editor"}
              className={studioPane === "editor" ? "seg-tab active" : "seg-tab"}
              onClick={() => setStudioPane("editor")}
            >
              Liquid YAML Editor
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={studioPane === "preview"}
              className={studioPane === "preview" ? "seg-tab active" : "seg-tab"}
              onClick={() => setStudioPane("preview")}
            >
              Preview ({isValidated ? "Valid" : "Pending"})
            </button>
          </div>
        </div>

        <div className="studio-split">
          <section
            className={`surface-card studio-pane ${studioPane === "editor" ? "mobile-show" : "mobile-hide"}`}
            aria-label="Liquid template source"
          >
            <div className="card-head-row">
              <div>
                <label htmlFor={`${uid}-tpl-source`} className="studio-label">
                  Liquid template (YAML)
                </label>
                <p className="muted-copy">
                  Must render complete proxies, proxy-groups, rules, and dns.
                </p>
              </div>
              <span className="mono muted-copy">
                {body.split("\n").length} lines
              </span>
            </div>
            <textarea
              ref={editorRef}
              id={`${uid}-tpl-source`}
              className="template-source"
              spellCheck={false}
              rows={20}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setPreview("");
                setValidatedKey("");
              }}
            />
          </section>

          <section
            className={`terminal-card studio-pane studio-preview-pane ${studioPane === "preview" ? "mobile-show" : "mobile-hide"}`}
            aria-label="Rendered mihomo preview"
          >
            <div className="terminal-head">
              <div className="terminal-dots" aria-hidden="true">
                <i className="dot-r" />
                <i className="dot-y" />
                <i className="dot-g" />
              </div>
              <span className="terminal-title">Rendered Preview</span>
              {isValidated ? (
                <Badge tone="good" icon={<ShieldCheck size={13} />}>
                  Validated · credentials hidden
                </Badge>
              ) : (
                <Badge tone="neutral">Preview required to publish</Badge>
              )}
            </div>

            <div className="preview-controls-bar">
              <label htmlFor={`${uid}-preview-user`} className="preview-user-label">
                Preview as user
              </label>
              <select
                id={`${uid}-preview-user`}
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setPreview("");
                  setValidatedKey("");
                }}
              >
                <option value="">Choose user</option>
                {state.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              {isValidated && (
                <CopyButton
                  text={preview}
                  label="Copy YAML"
                  variant="compact"
                />
              )}
            </div>

            {isValidated ? (
              <pre className="terminal-body preview-output">{preview}</pre>
            ) : (
              <div className="preview-placeholder">
                <FileCode2 size={28} aria-hidden="true" />
                <p>
                  Click <strong>Validate & preview</strong> to render this
                  template for the selected user and verify mihomo syntax,
                  proxy groups, and DNS settings.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    );

  return (
    <StackDrillDown
      hasDetail={hasDetail}
      backLabel="Templates"
      detailTitle={isCreating ? "New template" : selectedTemplate?.name || "Template"}
      onBack={() => goBackToRoot("templates")}
      listPane={listPane}
      detailPane={detailPane}
      listAriaLabel="Template selector"
    />
  );
}
