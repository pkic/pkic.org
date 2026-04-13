import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
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
    if (start === -1) { out.push(esc(source.slice(pos))); break; }
    if (start > pos) out.push(esc(source.slice(pos, start)));

    const end = source.indexOf("}}", start + 2);
    if (end === -1) { out.push(esc(source.slice(start))); break; }

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
      const pos = subject.length;
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
    if (!body.trim()) { toast("Body cannot be empty", "error"); return; }
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
    if (!body.trim()) { toast("Body cannot be empty", "error"); return; }
    setSaving(true);
    try {
      const effectiveContentType = isLayout ? "html" : contentType;
      const result = await api<{ success: boolean; version: number }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/versions`,
        { method: "POST", body: JSON.stringify({ content: body, subjectTemplate: subject || undefined, contentType: effectiveContentType }) },
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
          <button class="btn btn-sm btn-secondary" onClick={onBack}>← Back to list</button>
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
                    onChange={(e) => setContentType((e.target as HTMLSelectElement).value as "markdown" | "html" | "text")}
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
                  <pre ref={subjectPreRef} aria-hidden="true" class="adm-template-backdrop adm-template-backdrop-subject"></pre>
                  <input
                    type="text"
                    class={`form-control form-control-sm font-monospace adm-template-input-overlay${subject ? " adm-template-input-hidden-text" : ""}`}
                    value={subject}
                    placeholder="e.g. Your invitation to {{eventName}}"
                    onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
                    onFocus={() => { editorFocusRef.current = "subject"; }}
                  />
                </div>
              </div>

              {/* Body with highlight backdrop */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">
                  Body <span class="text-muted fw-normal">(supports {"{{variables}}"}, {"{{#if}}...{{/if}}"}, {"{{#each}}...{{/each}}"})</span>
                </label>
                <div class="adm-template-overlay-wrap">
                  <pre ref={bodyPreRef} aria-hidden="true" class="adm-template-backdrop adm-template-backdrop-body"></pre>
                  <textarea
                    ref={bodyTextareaRef}
                    class="form-control font-monospace adm-template-input-overlay adm-template-body-input"
                    rows={16}
                    value={body}
                    onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                    onFocus={() => { editorFocusRef.current = "body"; }}
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
                <button class="btn btn-outline-primary" onClick={() => void doPreview()}>Render Preview</button>
                <button class="btn btn-success" onClick={() => void doSave()} disabled={saving}>
                  {saving ? "Saving…" : "Save as Draft"}
                </button>
                <span class="text-muted small">Saving creates a new draft version. Activate it below to put it in use.</span>
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
                  <ul class="nav nav-tabs mb-2">
                    <li class="nav-item">
                      <button
                        class={`nav-link${previewTab === "html" ? " active" : ""}`}
                        type="button"
                        onClick={() => setPreviewTab("html")}
                      >HTML</button>
                    </li>
                    <li class="nav-item">
                      <button
                        class={`nav-link${previewTab === "text" ? " active" : ""}`}
                        type="button"
                        onClick={() => setPreviewTab("text")}
                      >Text</button>
                    </li>
                  </ul>
                  {previewTab === "html"
                    ? <iframe ref={iframeRef} sandbox="" class="adm-template-preview-frame" />
                    : <pre class="json-out adm-template-preview-text">{previewText}</pre>
                  }
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
          <div class="table-responsive">
            <table class="table table-sm">
              <thead>
                <tr><th>Version</th><th>Status</th><th>Checksum</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {versions.length === 0 ? (
                  <tr><td colSpan={5} class="text-center text-muted fst-italic">No versions yet</td></tr>
                ) : versions.map((v) => (
                  <tr key={v.id}>
                    <td class="mono">v{v.version}</td>
                    <td><Badge status={v.status} /></td>
                    <td class="mono adm-template-checksum">{v.checksum_sha256.substring(0, 12)}…</td>
                    <td class="mono">{v.created_at ? new Date(v.created_at).toLocaleString("en-GB") : "—"}</td>
                    <td class="text-nowrap">
                      {v.status !== "active"
                        ? <button class="btn btn-sm btn-outline-success me-1" onClick={() => void doActivate(v.version)}>Activate</button>
                        : <span class="badge text-bg-success me-1">In use</span>
                      }
                      <button class="btn btn-sm btn-outline-secondary" onClick={() => loadVersion(v)}>Load</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Create new template
// ────────────────────────────────────────────────────────

function CreateTemplate({
  existingKeys,
  onCreated,
  onCancel,
}: {
  existingKeys: string[];
  onCreated: (key: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<"markdown" | "html" | "text">("markdown");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const keyError = key && !/^[a-z][a-z0-9_]*$/.test(key)
    ? "Use lowercase letters, digits, and underscores only (must start with a letter)"
    : key && existingKeys.includes(key)
      ? "A template with this key already exists"
      : null;

  async function doCreate() {
    if (!key || keyError) { toast("Fix the template key first", "error"); return; }
    if (!body.trim()) { toast("Body cannot be empty", "error"); return; }
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
        <button class="btn btn-sm btn-secondary" onClick={onCancel}>← Back to list</button>
      </div>
      <div class="card-body" style="max-width:640px">
        <div class="mb-3">
          <label class="form-label small fw-semibold mb-1">Template key</label>
          <input
            type="text"
            class={`form-control form-control-sm font-monospace${keyError ? " is-invalid" : ""}`}
            value={key}
            placeholder="e.g. speaker_confirmation"
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
          {keyError && <div class="invalid-feedback">{keyError}</div>}
          <div class="form-text">A unique identifier for this template. Cannot be changed later.</div>
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
        <button class="btn btn-success" onClick={() => void doCreate()} disabled={saving || !key || !!keyError}>
          {saving ? "Creating…" : "Create Template"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

type TemplatesView = "list" | "create" | { key: string; versions: EmailTemplateVersion[] };

function groupTemplates(templates: EmailTemplateVersion[]): Map<string, EmailTemplateVersion[]> {
  const grouped = new Map<string, EmailTemplateVersion[]>();
  for (const template of templates) {
    const list = grouped.get(template.template_key) ?? [];
    list.push(template);
    grouped.set(template.template_key, list);
  }
  return grouped;
}

export function Templates() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grouped, setGrouped] = useState<Map<string, EmailTemplateVersion[]>>(new Map());
  const [view, setView] = useState<TemplatesView>("list");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
      setGrouped(groupTemplates(data.templates ?? []));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function reloadAndKeepKey(key: string) {
    const data = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
    const newGrouped = groupTemplates(data.templates ?? []);
    setGrouped(newGrouped);
    const versions = newGrouped.get(key) ?? [];
    setView({ key, versions });
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
        existingKeys={Array.from(grouped.keys())}
        onCreated={async (key) => {
          await load();
          // reload to get fresh data, then open editor
          const data = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
          const newGrouped = groupTemplates(data.templates ?? []);
          setGrouped(newGrouped);
          const versions = newGrouped.get(key) ?? [];
          setView(versions.length ? { key, versions } : "list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const entries = Array.from(grouped.entries());

  if (!entries.length) {
    return (
      <div class="text-center py-4">
        <p class="text-muted fst-italic small mb-3">
          No email templates found. Create one or use the seed script to populate initial templates.
        </p>
        <button class="btn btn-success btn-sm" onClick={() => setView("create")}>
          + New Template
        </button>
      </div>
    );
  }

  return (
    <div>
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-success btn-sm" onClick={() => setView("create")}>
          + New Template
        </button>
      </div>
      <div class="table-responsive">
      <table class="table table-sm table-hover">
        <thead>
          <tr><th>Template Key</th><th>Active</th><th>Status</th><th>Versions</th><th></th></tr>
        </thead>
        <tbody>
          {entries.map(([key, versions]) => {
            const activeVersion = versions.find((v) => v.status === "active");
            const hasDraft = versions.some((v) => v.status === "draft");
            return (
              <tr key={key}>
                <td class="mono adm-template-key">{key}</td>
                <td class="mono">{activeVersion ? `v${activeVersion.version}` : "—"}</td>
                <td>
                  <Badge status={activeVersion ? "active" : "draft"} />
                  {hasDraft && activeVersion && <span class="badge text-bg-warning ms-1">draft pending</span>}
                </td>
                <td class="mono">{versions.length}</td>
                <td>
                  <button
                    class="btn btn-sm btn-outline-success"
                    onClick={() => setView({ key, versions })}
                  >
                    Edit →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}
