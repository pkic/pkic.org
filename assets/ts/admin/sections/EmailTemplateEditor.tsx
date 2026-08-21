import { useEffect, useRef, useState } from "preact/hooks";
import { Tabs } from "../../components/Tabs";
import { Badge } from "../../components/Badge";
import { DataTable } from "../../components/Table";
import { api } from "../api";
import { toast } from "../ui";
import { highlightTemplateSyntax } from "../email-template-syntax";
import type { EmailTemplateVersion } from "../types";
import {
  TEMPLATE_HELPERS,
  TEMPLATE_PARTIALS,
  PREVIEW_DEFAULTS,
  type TemplateHelperCategory,
} from "../email-template-helpers";
import type { EmailContentType, EmailMessageType } from "../../../shared/schemas/admin-email-templates";

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];

// ────────────────────────────────────────────────────────
// Template editor component
// ────────────────────────────────────────────────────────

export function TemplateEditor({
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

  const [contentType, setContentType] = useState<EmailContentType>(current?.content_type ?? "markdown");
  const [messageType, setMessageType] = useState<EmailMessageType>(current?.message_type ?? "transactional");
  const [subject, setSubject] = useState(current?.subject_template ?? "");
  const [body, setBody] = useState(current?.body ?? "");
  const [previewData, setPreviewData] = useState(JSON.stringify(PREVIEW_DEFAULTS, null, 2));
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewStatus, setPreviewStatus] = useState("Preview not rendered yet.");
  const [saving, setSaving] = useState(false);
  const [hasPreviewedRef] = [useRef(false)];

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
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = `${el.value.slice(0, start)}${snippet}${el.value.slice(end)}`;
        el.value = next; // imperative — textarea is uncontrolled
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
    const newBody = version.body ?? "";
    setSubject(version.subject_template ?? "");
    setBody(newBody);
    setContentType(version.content_type ?? "markdown");
    setMessageType(version.message_type ?? "transactional");
    if (bodyTextareaRef.current) {
      bodyTextareaRef.current.value = newBody;
    }
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
      hasPreviewedRef.current = true;
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
    if (!hasPreviewedRef.current) {
      toast("Please render a preview before saving", "error");
      return;
    }
    setSaving(true);
    try {
      const effectiveContentType = isLayout ? "html" : contentType;
      const result = await api<{ success: boolean; version: { version: number } }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            content: body,
            subjectTemplate: subject || undefined,
            contentType: effectiveContentType,
            messageType: isLayout ? undefined : messageType,
          }),
        },
      );
      toast(`Saved as draft v${result.version.version}`, "success");
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
                <div class="row g-2 mb-2">
                  <div class="col-md-6">
                    <label class="form-label small fw-semibold mb-1">Content type</label>
                    <select
                      class="form-select form-select-sm"
                      value={contentType}
                      onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                    >
                      <option value="markdown">Markdown</option>
                      <option value="html">HTML</option>
                      <option value="text">Plain text</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label small fw-semibold mb-1">Default message type</label>
                    <select
                      class="form-select form-select-sm"
                      value={messageType}
                      onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
                    >
                      <option value="transactional">Transactional</option>
                      <option value="promotional">Promotional</option>
                    </select>
                  </div>
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
                    class="adm-template-backdrop adm-template-backdrop-subject font-monospace"
                  ></pre>
                  <input
                    type="text"
                    class="form-control form-control-sm font-monospace adm-template-input-overlay"
                    value={subject}
                    placeholder="e.g. Your invitation to {{eventName}}"
                    onInput={(e) => {
                      setSubject((e.target as HTMLInputElement).value);
                      hasPreviewedRef.current = false;
                    }}
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
                    class="adm-template-backdrop adm-template-backdrop-body font-monospace"
                  ></pre>
                  <textarea
                    ref={bodyTextareaRef}
                    class="form-control font-monospace adm-template-input-overlay adm-template-body-input"
                    rows={16}
                    defaultValue={body}
                    onInput={(e) => {
                      setBody((e.target as HTMLTextAreaElement).value);
                      hasPreviewedRef.current = false;
                    }}
                    onFocus={() => {
                      editorFocusRef.current = "body";
                    }}
                    onScroll={handleBodyScroll}
                  />
                </div>
              </div>

              {/* Partials */}
              <div class="mb-3">
                <label class="form-label small fw-semibold mb-1">Insert partial</label>
                <div class="input-group input-group-sm">
                  <select
                    id="partialSelect"
                    class="form-select form-select-sm"
                    onChange={(e) => {
                      const sel = e.target as HTMLSelectElement;
                      if (!sel.value) return;
                      insertSnippet(`{{> ${sel.value}}}`, "body");
                      sel.value = "";
                    }}
                  >
                    <option value="">— select partial to insert —</option>
                    {TEMPLATE_PARTIALS.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} — {p.description}
                      </option>
                    ))}
                  </select>
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
                <label class="form-label small fw-semibold mb-1 d-flex justify-content-between align-items-center">
                  Preview data (JSON)
                  <button
                    type="button"
                    class="btn btn-link btn-sm p-0 text-muted"
                    onClick={() => setPreviewData(JSON.stringify(PREVIEW_DEFAULTS, null, 2))}
                  >
                    Reset to defaults
                  </button>
                </label>
                <textarea
                  class="form-control font-monospace adm-template-preview-data"
                  rows={6}
                  value={previewData}
                  onInput={(e) => setPreviewData((e.target as HTMLTextAreaElement).value)}
                />
              </div>

              <div class="d-flex gap-2 align-items-center flex-wrap">
                <button class="btn btn-outline-primary" onClick={() => void doPreview()}>
                  Render Preview
                </button>
                <button
                  class="btn btn-success"
                  onClick={() => void doSave()}
                  disabled={saving || !hasPreviewedRef.current}
                >
                  {saving ? "Saving…" : "Save as Draft"}
                </button>
                <span class="text-muted small">
                  Preview required before saving. Saving creates a new draft version — activate it below.
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
                header: "Type",
                cell: (v) => (v.message_type ? <Badge status={v.message_type} /> : "—"),
              },
              {
                header: "Checksum",
                cell: (v) => <>{v.checksum_sha256.substring(0, 12)}…</>,
                className: "mono adm-template-checksum",
              },
              {
                header: "Created",
                cell: (v) => (v.created_at ? new Date(v.created_at).toLocaleString("en-US") : "—"),
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
