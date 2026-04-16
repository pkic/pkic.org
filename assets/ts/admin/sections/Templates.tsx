import { useState, useEffect, useRef } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { ApiDataTable, DataTable, type ApiTableActions } from "../../components/Table";
import { Tabs } from "../../components/Tabs";
import { api } from "../api";
import { esc, toast } from "../ui";
import type { EmailTemplateVersion } from "../types";
import { TEMPLATE_HELPERS, type TemplateHelperCategory } from "../email-template-helpers";

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];

// ────────────────────────────────────────────────────────
// Syntax highlight
// ────────────────────────────────────────────────────────

function highlightTemplateSyntax(source: string): string {
  const out: string[] = [];
  const stack: number[] = [];
  let pos = 0;

  while (pos < source.length) {
    const start = source.indexOf("{{", pos);
    if (start === -1) {
      out.push(esc(source.slice(pos)));
      break;
    }
    if (start > pos) out.push(esc(source.slice(pos, start)));

    const end = source.indexOf("}}", start + 2);
    if (end === -1) {
      out.push(esc(source.slice(start)));
      break;
    }

    const token = source.slice(start, end + 2);
    const inner = source.slice(start + 2, end).trim();
    let cls = "adm-template-token-var";

    if (inner.startsWith("#")) {
      const depth = stack.length % 8;
      stack.push(depth);
      cls = `adm-template-token-depth-${depth}`;
    } else if (inner.startsWith("/")) {
      const depth = stack.length > 0 ? stack.pop()! : 0;
      cls = `adm-template-token-depth-${depth % 8}`;
    } else if (inner === "else") {
      const depth = stack.length > 0 ? stack[stack.length - 1] : 0;
      cls = `adm-template-token-depth-${depth % 8}`;
    }

    out.push(`<span class="adm-template-token ${cls}">${esc(token)}</span>`);
    pos = end + 2;
  }

  return out.join("");
}

// ────────────────────────────────────────────────────────
// Template editor component
// ────────────────────────────────────────────────────────

function TemplateEditor({
  templateKey,
  versions,
  onBack,
  onReload,
}: {
  templateKey: string;
  versions: EmailTemplateVersion[];
  onBack: () => void;
  onReload: () => Promise<void>;
}) {
  const active = versions.find((v) => v.status === "active");
  const current = active ?? versions[0];
  const isLayout = templateKey === EMAIL_LAYOUT_TEMPLATE_KEY;

  const [contentType, setContentType] = useState<"markdown" | "html" | "text">(
    (current?.content_type as "markdown" | "html" | "text") ?? "markdown",
  );
  const [subject, setSubject] = useState(current?.subject_template ?? "");
  const [body, setBody] = useState(current?.body ?? "");
  const [previewData, setPreviewData] = useState("");
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewStatus, setPreviewStatus] = useState("Preview not rendered yet.");
  const [saving, setSaving] = useState(false);

  const subjectPreRef = useRef<HTMLPreElement>(null);
  const bodyPreRef = useRef<HTMLPreElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorFocusRef = useRef<"subject" | "body">("body");

  // sync highlight backdrop when subject/body changes
  useEffect(() => {
    if (subjectPreRef.current) {
      subjectPreRef.current.innerHTML = subject ? `${highlightTemplateSyntax(subject)}&nbsp;` : "";
    }
  }, [subject]);

  useEffect(() => {
    if (bodyPreRef.current) {
      bodyPreRef.current.innerHTML = `${highlightTemplateSyntax(body)}\n`;
      if (bodyTextareaRef.current) {
        bodyPreRef.current.scrollTop = bodyTextareaRef.current.scrollTop;
      }
    }
  }, [body]);

  // sync iframe srcdoc
  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml]);

  function handleBodyScroll() {
    if (bodyPreRef.current && bodyTextareaRef.current) {
      bodyPreRef.current.scrollTop = bodyTextareaRef.current.scrollTop;
      bodyPreRef.current.scrollLeft = bodyTextareaRef.current.scrollLeft;
    }
  }

  function insertSnippet(snippet: string, preferredTarget?: "subject" | "body" | null) {
    const target = preferredTarget ?? editorFocusRef.current;
    if (target === "subject") {
      setSubject((s) => s + snippet);
      editorFocusRef.current = "subject";
    } else {
      setBody((b) => {
        const el = bodyTextareaRef.current;
        if (!el) return b + snippet;
        const start = el.selectionStart ?? b.length;
        const end = el.selectionEnd ?? b.length;
        const next = `${b.slice(0, start)}${snippet}${b.slice(end)}`;
        // restore cursor after re-render
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + snippet.length, start + snippet.length);
        });
        return next;
      });
      editorFocusRef.current = "body";
    }
  }

  function loadVersion(version: EmailTemplateVersion) {
    setSubject(version.subject_template ?? "");
    setBody(version.body ?? "");
    setContentType((version.content_type as "markdown" | "html" | "text") ?? "markdown");
    toast(`Loaded v${version.version} into editor`, "info");
  }

  async function doPreview() {
    if (!body.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }
    let data: Record<string, unknown> | undefined;
    if (previewData.trim()) {
      try {
        const parsed = JSON.parse(previewData) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Must be a JSON object");
        data = parsed as Record<string, unknown>;
      } catch (e) {
        toast(`Invalid preview JSON: ${(e as Error).message}`, "error");
        return;
      }
    }
    setPreviewStatus("Rendering preview...");
    try {
      const layoutHtml = isLayout ? body : undefined;
      const previewContent = isLayout
        ? "<h2>Layout preview</h2><p>This is how body content will appear inside the shared email shell.</p>"
        : body;
      const result = await api<{ subject: string; html: string; text: string }>(
        "/api/v1/admin/email-templates/preview",
        {
          method: "POST",
          body: JSON.stringify({
            subjectTemplate: subject || undefined,
            content: previewContent,
            contentType: isLayout ? "html" : contentType,
            layoutHtml,
            data,
          }),
        },
      );
      setPreviewSubject(result.subject);
      setPreviewHtml(result.html);
      setPreviewText(result.text);
      setPreviewStatus("Preview rendered.");
    } catch (e) {
      const msg = (e as Error).message;
      toast(msg, "error");
      setPreviewStatus(msg);
    }
  }

  async function doSave() {
    if (!body.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }
    setSaving(true);
    try {
      const effectiveContentType = isLayout ? "html" : contentType;
      const result = await api<{ success: boolean; version: number }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            content: body,
            subjectTemplate: subject || undefined,
            contentType: effectiveContentType,
          }),
        },
      );
      toast(`Saved as draft v${result.version}`, "success");
      await onReload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function doActivate(version: number) {
    try {
      await api(`/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/activate`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
      toast(`v${version} is now active`, "success");
      await onReload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white d-flex align-items-center justify-content-between">
          <span class="fw-semibold">
            Edit: <span class="mono">{templateKey}</span>
            {isLayout && <span class="badge text-bg-info ms-2">shared shell</span>}
          </span>
          <button class="btn btn-sm btn-secondary" onClick={onBack}>
            ← Back to list
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3">
            {/* Editor column */}
            <div class="col-lg-7">
              {isLayout && (
                <div class="alert alert-info small py-2 mb-3">
                  This template controls the outer email shell used for all emails.
                </div>
              )}
              {!isLayout && (
                <div class="mb-2">
                  <label class="form-label small fw-semibold mb-1">Content type</label>
                  <select
                    class="form-select form-select-sm"
                    value={contentType}
                    onChange={(e) =>
                      setContentType((e.target as HTMLSelectElement).value as "markdown" | "html" | "text")
                    }
                  >
                    <option value="markdown">Markdown</option>
                    <option value="html">HTML</option>
                    <option value="text">Plain text</option>
                  </select>
                </div>
              )}

              {/* Subject with highlight backdrop */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">
                  Subject template <span class="text-muted fw-normal">(supports conditions and variables)</span>
                </label>
                <div class="adm-template-overlay-wrap">
                  <pre
                    ref={subjectPreRef}
                    aria-hidden="true"
                    class="adm-template-backdrop adm-template-backdrop-subject"
                  ></pre>
                  <input
                    type="text"
                    class={`form-control form-control-sm font-monospace adm-template-input-overlay${subject ? " adm-template-input-hidden-text" : ""}`}
                    value={subject}
                    placeholder="e.g. Your invitation to {{eventName}}"
                    onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
                    onFocus={() => {
                      editorFocusRef.current = "subject";
                    }}
                  />
                </div>
              </div>

              {/* Body with highlight backdrop */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">
                  Body{" "}
                  <span class="text-muted fw-normal">
                    (supports {"{{variables}}"}, {"{{#if}}...{{/if}}"}, {"{{#each}}...{{/each}}"})
                  </span>
                </label>
                <div class="adm-template-overlay-wrap">
                  <pre
                    ref={bodyPreRef}
                    aria-hidden="true"
                    class="adm-template-backdrop adm-template-backdrop-body"
                  ></pre>
                  <textarea
                    ref={bodyTextareaRef}
                    class="form-control font-monospace adm-template-input-overlay adm-template-body-input"
                    rows={16}
                    value={body}
                    onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                    onFocus={() => {
                      editorFocusRef.current = "body";
                    }}
                    onScroll={handleBodyScroll}
                  />
                </div>
              </div>

              {/* Template helpers */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">Template helpers</label>
                <div class="small text-muted mb-2">Click to insert into the active field.</div>
                <div class="d-flex gap-2 flex-wrap">
                  {HELPER_CATEGORIES.map((cat) => (
                    <div key={cat} class="w-100">
                      <div class="small text-muted fw-semibold mb-1">{cat}</div>
                      <div class="d-flex gap-2 flex-wrap">
                        {TEMPLATE_HELPERS.filter((item) => item.category === cat).map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            class="btn btn-sm btn-outline-secondary"
                            onClick={() => insertSnippet(item.snippet, item.target)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview data */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">Preview data (JSON)</label>
                <textarea
                  class="form-control font-monospace"
                  rows={6}
                  value={previewData}
                  placeholder="Optional: provide sample variables as JSON"
                  onInput={(e) => setPreviewData((e.target as HTMLTextAreaElement).value)}
                />
              </div>

              <div class="d-flex gap-2 align-items-center flex-wrap">
                <button class="btn btn-outline-primary" onClick={() => void doPreview()}>
                  Render Preview
                </button>
                <button class="btn btn-success" onClick={() => void doSave()} disabled={saving}>
                  {saving ? "Saving…" : "Save as Draft"}
                </button>
                <span class="text-muted small">
                  Saving creates a new draft version. Activate it below to put it in use.
                </span>
              </div>
            </div>

            {/* Preview column */}
            <div class="col-lg-5">
              <div class="card border">
                <div class="card-header bg-light small fw-semibold">Rendered Preview</div>
                <div class="card-body">
                  <div class="mb-2">
                    <div class="small text-muted">Subject</div>
                    <div class="fw-semibold">{previewSubject}</div>
                  </div>
                  <Tabs
                    items={[
                      { key: "html", label: "HTML" },
                      { key: "text", label: "Text" },
                    ]}
                    active={previewTab}
                    onChange={(key) => setPreviewTab(key as "html" | "text")}
                    className="mb-2"
                  />
                  {previewTab === "html" ? (
                    <iframe ref={iframeRef} sandbox="" class="adm-template-preview-frame" />
                  ) : (
                    <pre class="json-out adm-template-preview-text">{previewText}</pre>
                  )}
                  <div class="small text-muted mt-2">{previewStatus}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Version history */}
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Version History</h6>
          <DataTable
            columns={[
              { header: "Version", cell: (v) => `v${v.version}`, className: "mono" },
              { header: "Status", cell: (v) => <Badge status={v.status} /> },
              {
                header: "Checksum",
                cell: (v) => <>{v.checksum_sha256.substring(0, 12)}…</>,
                className: "mono adm-template-checksum",
              },
              {
                header: "Created",
                cell: (v) => (v.created_at ? new Date(v.created_at).toLocaleString("en-GB") : "—"),
                className: "mono",
              },
              {
                header: "",
                cell: (v) => (
                  <>
                    {v.status !== "active" ? (
                      <button class="btn btn-sm btn-outline-success me-1" onClick={() => void doActivate(v.version)}>
                        Activate
                      </button>
                    ) : (
                      <span class="badge text-bg-success me-1">In use</span>
                    )}
                    <button class="btn btn-sm btn-outline-secondary" onClick={() => loadVersion(v)}>
                      Load
                    </button>
                  </>
                ),
                className: "text-nowrap",
              },
            ]}
            data={versions}
            empty="No versions yet"
            rowKey={(v) => v.id}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Create new template
// ────────────────────────────────────────────────────────

function CreateTemplate({ onCreated, onCancel }: { onCreated: (key: string) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<"markdown" | "html" | "text">("markdown");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyCheckStatus, setKeyCheckStatus] = useState<"idle" | "checking" | "exists" | "available">("idle");

  useEffect(() => {
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
      setKeyCheckStatus("idle");
      return;
    }
    setKeyCheckStatus("checking");
    const timer = setTimeout(() => {
      api<{ exists: boolean }>(`/api/v1/admin/email-templates/${encodeURIComponent(key)}/exists`)
        .then((data) => setKeyCheckStatus(data.exists ? "exists" : "available"))
        .catch(() => setKeyCheckStatus("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [key]);

  const keyError =
    key && !/^[a-z][a-z0-9_]*$/.test(key)
      ? "Use lowercase letters, digits, and underscores only (must start with a letter)"
      : keyCheckStatus === "exists"
        ? "A template with this key already exists"
        : null;

  async function doCreate() {
    if (!key || keyError) {
      toast("Fix the template key first", "error");
      return;
    }
    if (keyCheckStatus === "checking") {
      toast("Still checking key availability, please wait", "error");
      return;
    }
    if (!body.trim()) {
      toast("Body cannot be empty", "error");
      return;
    }
    setSaving(true);
    try {
      await api<{ success: boolean; version: number }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
        { method: "POST", body: JSON.stringify({ content: body, subjectTemplate: subject || undefined, contentType }) },
      );
      toast(`Template "${key}" created as draft v1`, "success");
      onCreated(key);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white d-flex align-items-center justify-content-between">
        <span class="fw-semibold">Create New Template</span>
        <button class="btn btn-sm btn-secondary" onClick={onCancel}>
          ← Back to list
        </button>
      </div>
      <div class="card-body" style="max-width:640px">
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Template key</label>
          <input
            type="text"
            class={`form-control form-control-sm font-monospace${keyError ? " is-invalid" : keyCheckStatus === "available" ? " is-valid" : ""}`}
            value={key}
            placeholder="e.g. speaker_confirmation"
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
          {keyError && <div class="invalid-feedback">{keyError}</div>}
          {keyCheckStatus === "available" && <div class="valid-feedback">Key is available</div>}
          <div class="form-text">
            {keyCheckStatus === "checking"
              ? "Checking availability…"
              : "A unique identifier for this template. Cannot be changed later."}
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Content type</label>
          <select
            class="form-select form-select-sm"
            value={contentType}
            onChange={(e) => setContentType((e.target as HTMLSelectElement).value as "markdown" | "html" | "text")}
          >
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
            <option value="text">Plain text</option>
          </select>
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Subject template</label>
          <input
            type="text"
            class="form-control form-control-sm font-monospace"
            value={subject}
            placeholder="e.g. Your invitation to {{eventName}}"
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Body</label>
          <textarea
            class="form-control font-monospace"
            rows={12}
            value={body}
            placeholder="Template body content…"
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <button
          class="btn btn-success"
          onClick={() => void doCreate()}
          disabled={saving || !key || !!keyError || keyCheckStatus === "checking"}
        >
          {saving ? "Creating…" : "Create Template"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

interface TemplateSummary {
  template_key: string;
  active_version: number | null;
  version_count: number;
  draft_count: number;
}

type TemplatesView = "list" | "create" | { key: string; versions: EmailTemplateVersion[] };

export function Templates() {
  const [view, setView] = useState<TemplatesView>("list");
  const tableRef = useRef<ApiTableActions | null>(null);

  async function openEditor(key: string) {
    try {
      const data = await api<{ versions: EmailTemplateVersion[] }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
      );
      setView({ key, versions: data.versions ?? [] });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function reloadAndKeepKey(key: string) {
    try {
      const data = await api<{ versions: EmailTemplateVersion[] }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
      );
      setView({ key, versions: data.versions ?? [] });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (view !== "list" && view !== "create") {
    return (
      <TemplateEditor
        templateKey={view.key}
        versions={view.versions}
        onBack={() => setView("list")}
        onReload={() => reloadAndKeepKey(view.key)}
      />
    );
  }

  if (view === "create") {
    return (
      <CreateTemplate
        onCreated={async (key) => {
          tableRef.current?.reload();
          await openEditor(key);
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <ApiDataTable<TemplateSummary>
      endpoint="/api/v1/admin/email-templates"
      resolve={(d) => (d as { templates: TemplateSummary[] }).templates}
      resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
      paginate
      searchPlaceholder="Search template key…"
      actionsRef={tableRef}
      toolbar={() => (
        <button class="btn btn-success btn-sm ms-auto" onClick={() => setView("create")}>
          + New Template
        </button>
      )}
      columns={[
        { header: "Template Key", cell: (t) => t.template_key, className: "mono adm-template-key" },
        {
          header: "Active",
          cell: (t) => (t.active_version != null ? `v${t.active_version}` : "—"),
          className: "mono",
        },
        {
          header: "Status",
          cell: (t) => {
            const hasActive = t.active_version != null;
            const hasDraft = t.draft_count > 0;
            return (
              <>
                <Badge status={hasActive ? "active" : "draft"} />
                {hasDraft && hasActive && <span class="badge text-bg-warning ms-1">draft pending</span>}
              </>
            );
          },
        },
        { header: "Versions", cell: (t) => t.version_count, className: "mono" },
        {
          header: "",
          cell: (t) => (
            <button class="btn btn-sm btn-outline-success" onClick={() => void openEditor(t.template_key)}>
              Edit →
            </button>
          ),
        },
      ]}
      empty="No templates"
      rowKey={(t) => t.template_key}
    />
  );
}
