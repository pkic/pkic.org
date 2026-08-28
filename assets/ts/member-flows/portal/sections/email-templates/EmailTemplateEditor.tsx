import { useEffect, useRef, useState } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { highlightTemplateSyntax } from "../../../../shared/email-template-syntax";
import type { EmailTemplateVersion } from "../../../../../shared/schemas/email-templates";
import {
  TEMPLATE_HELPERS,
  TEMPLATE_PARTIALS,
  PREVIEW_DEFAULTS,
  type TemplateHelperCategory,
} from "../../../../shared/email-template-helpers";
import {
  emailTemplateVersionsListResponseSchema,
  emailTemplatePreviewResponseSchema,
  emailTemplateVersionCreateResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../../../../shared/schemas/email-templates";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../../../shared/email-preview-tabs";
import { EMAIL_TEMPLATES_API } from "../../../../shared/email-template-catalog";

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];

// ────────────────────────────────────────────────────────
// Template editor component
// ────────────────────────────────────────────────────────

export function TemplateEditor({
  templateKey,
  initialVersion,
  canWrite,
  onBack,
}: {
  templateKey: string;
  initialVersion: EmailTemplateVersion | null;
  canWrite: boolean;
  onBack: () => void;
}) {
  const current = initialVersion;
  const isLayout = templateKey === EMAIL_LAYOUT_TEMPLATE_KEY;

  const [contentType, setContentType] = useState<EmailContentType>(current?.content_type ?? "markdown");
  const [messageType, setMessageType] = useState<EmailMessageType>(current?.message_type ?? "transactional");
  const [subject, setSubject] = useState(current?.subject_template ?? "");
  const [body, setBody] = useState(current?.body ?? "");
  const [previewData, setPreviewData] = useState(JSON.stringify(PREVIEW_DEFAULTS, null, 2));
  const [previewTab, setPreviewTab] = useState<EmailPreviewTab>("html");
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
  const historyRef = useRef<ApiTableActions | null>(null);

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
    if (!canWrite) return;
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
      const result = await postJson(
        `${EMAIL_TEMPLATES_API}/preview`,
        {
          subjectTemplate: subject || undefined,
          content: previewContent,
          contentType: isLayout ? "html" : contentType,
          layoutHtml,
          data,
        },
        emailTemplatePreviewResponseSchema,
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
    if (!canWrite) return;
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
      const result = await postJson(
        `${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions`,
        {
          content: body,
          subjectTemplate: subject || undefined,
          contentType: effectiveContentType,
          messageType: isLayout ? undefined : messageType,
        },
        emailTemplateVersionCreateResponseSchema,
      );
      toast(`Saved as draft v${result.version.version}`, "success");
      await historyRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function doActivate(version: number) {
    if (!canWrite) return;
    try {
      await postJson(
        `${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/activate`,
        { version },
        successResponseSchema,
      );
      toast(`v${version} is now active`, "success");
      await historyRef.current?.reload();
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
                    <label class="form-label small fw-semibold mb-1" for="email-template-editor-content-type">
                      Content type
                    </label>
                    <select
                      id="email-template-editor-content-type"
                      class="form-select form-select-sm"
                      value={contentType}
                      disabled={!canWrite}
                      onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                    >
                      <option value="markdown">Markdown</option>
                      <option value="html">HTML</option>
                      <option value="text">Plain text</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label small fw-semibold mb-1" for="email-template-editor-message-type">
                      Default message type
                    </label>
                    <select
                      id="email-template-editor-message-type"
                      class="form-select form-select-sm"
                      value={messageType}
                      disabled={!canWrite}
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
                <label class="form-label small fw-semibold mb-1" for="email-template-editor-subject">
                  Subject template <span class="text-muted fw-normal">(supports conditions and variables)</span>
                </label>
                <div class="adm-template-overlay-wrap">
                  <pre
                    ref={subjectPreRef}
                    aria-hidden="true"
                    class="adm-template-backdrop adm-template-backdrop-subject font-monospace"
                  ></pre>
                  <input
                    id="email-template-editor-subject"
                    type="text"
                    class="form-control form-control-sm font-monospace adm-template-input-overlay"
                    value={subject}
                    disabled={!canWrite}
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
                <label class="form-label small fw-semibold mb-1" for="email-template-editor-body">
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
                    id="email-template-editor-body"
                    ref={bodyTextareaRef}
                    class="form-control font-monospace adm-template-input-overlay adm-template-body-input"
                    rows={16}
                    defaultValue={body}
                    readOnly={!canWrite}
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
                <label class="form-label small fw-semibold mb-1" for="email-template-partial">
                  Insert partial
                </label>
                <div class="input-group input-group-sm">
                  <select
                    id="email-template-partial"
                    class="form-select form-select-sm"
                    disabled={!canWrite}
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
                            disabled={!canWrite}
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
              {canWrite && (
                <div class="mb-3">
                  <label
                    class="form-label small fw-semibold mb-1 d-flex justify-content-between align-items-center"
                    for="email-template-preview-data"
                  >
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
                    id="email-template-preview-data"
                    class="form-control font-monospace adm-template-preview-data"
                    rows={6}
                    value={previewData}
                    disabled={!canWrite}
                    onInput={(e) => setPreviewData((e.target as HTMLTextAreaElement).value)}
                  />
                </div>
              )}

              <div class="d-flex gap-2 align-items-center flex-wrap">
                {canWrite ? (
                  <>
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
                  </>
                ) : (
                  <span class="text-muted small">Read-only access. Template changes require write permission.</span>
                )}
              </div>
            </div>

            {/* Preview column */}
            {canWrite && (
              <div class="col-lg-5">
                <div class="card border">
                  <div class="card-header bg-light small fw-semibold">Rendered Preview</div>
                  <div class="card-body">
                    <div class="mb-2">
                      <div class="small text-muted">Subject</div>
                      <div class="fw-semibold">{previewSubject}</div>
                    </div>
                    <Tabs
                      items={EMAIL_PREVIEW_TABS}
                      active={previewTab}
                      onChange={(key) => setPreviewTab(key as EmailPreviewTab)}
                      className="mb-2"
                    />
                    {previewTab === "html" ? (
                      <iframe
                        ref={iframeRef}
                        title="Rendered email HTML preview"
                        sandbox=""
                        class="adm-template-preview-frame"
                      />
                    ) : (
                      <pre class="json-out adm-template-preview-text">{previewText}</pre>
                    )}
                    <div class="small text-muted mt-2">{previewStatus}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Version history */}
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Version History</h6>
          <ApiDataTable
            endpoint={`${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions`}
            responseSchema={emailTemplateVersionsListResponseSchema}
            resolve={(response) => response.versions}
            resolvePage={(response) => response.page}
            paginate
            initialPageSize={25}
            initialSort="-version"
            actionsRef={historyRef}
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
                    {canWrite && v.status !== "active" ? (
                      <button class="btn btn-sm btn-outline-success me-1" onClick={() => void doActivate(v.version)}>
                        Activate
                      </button>
                    ) : v.status === "active" ? (
                      <span class="badge text-bg-success me-1">In use</span>
                    ) : null}
                    <button class="btn btn-sm btn-outline-secondary" onClick={() => loadVersion(v)}>
                      Load
                    </button>
                  </>
                ),
                className: "text-nowrap",
              },
            ]}
            empty="No versions yet"
            rowKey={(v) => v.id}
          />
        </div>
      </div>
    </div>
  );
}
