import { useEffect, useRef, useState } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import { statusLabel } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Alert } from "../../../../ui/Alert";
import { Badge, type BadgeTone } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput, Textarea } from "../../../../ui/TextControl";
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

// The syntax-highlight backdrop rides this chunk rather than the entry
// stylesheet, because only the two template editors use it.
import "../../../../ui/OverlayEditor.css";
import "../../../../ui/Content.css";

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];

/** Only the version actually in use carries a tone; a draft is not a status. */
function versionTone(status: string): BadgeTone {
  return status === "active" ? "ok" : "neutral";
}

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
  const hasPreviewedRef = useRef(false);

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

  // Sync iframe srcdoc. The tab is a dependency because leaving the HTML tab
  // unmounts the frame, so a viewer coming back gets a brand-new empty element
  // that the already-rendered HTML has to be written into again.
  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml, previewTab]);

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
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title={`Edit: ${templateKey}`} headingLevel={2}>
          {isLayout && <Badge tone="info">shared shell</Badge>}
          <Button size="sm" onClick={onBack}>
            ← Back to list
          </Button>
        </PanelHeader>
        <PanelBody>
          <div class="pk-grid pk-grid--roomy">
            {/* Editor column */}
            <div class="pk-stack">
              {isLayout && <Alert tone="info">This template controls the outer email shell used for all emails.</Alert>}
              {!isLayout && (
                <div class="pk-grid">
                  {/* Written out rather than composed from <Field>: every
                      control on this screen is addressed by a fixed id, which
                      <Field> generates for itself. The markup is the one
                      <Field> builds — the group carries any state modifier and
                      the control sits in the box the state mark reads. */}
                  <div class="pk-field">
                    <label class="pk-field__label" for="email-template-editor-content-type">
                      Content type
                    </label>
                    <div class="pk-field__control">
                      <Select
                        id="email-template-editor-content-type"
                        value={contentType}
                        disabled={!canWrite}
                        onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                      >
                        <option value="markdown">Markdown</option>
                        <option value="html">HTML</option>
                        <option value="text">Plain text</option>
                      </Select>
                    </div>
                  </div>
                  <div class="pk-field">
                    <label class="pk-field__label" for="email-template-editor-message-type">
                      Default message type
                    </label>
                    <div class="pk-field__control">
                      <Select
                        id="email-template-editor-message-type"
                        value={messageType}
                        disabled={!canWrite}
                        onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
                      >
                        <option value="transactional">Transactional</option>
                        <option value="promotional">Promotional</option>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Subject with highlight backdrop */}
              <div class="pk-field">
                <label class="pk-field__label" for="email-template-editor-subject">
                  Subject template <span class="pk-muted">(supports conditions and variables)</span>
                </label>
                {/* The overlay editor is this field's control box: both are the
                    positioned box its contents are placed against, so they are
                    one element rather than two nested ones. */}
                <div class="pk-field__control pk-overlay-editor">
                  <pre ref={subjectPreRef} aria-hidden="true" class="pk-overlay-editor__backdrop"></pre>
                  <TextInput
                    id="email-template-editor-subject"
                    class="pk-mono pk-overlay-editor__input"
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
              <div class="pk-field">
                <label class="pk-field__label" for="email-template-editor-body">
                  Body{" "}
                  <span class="pk-muted">
                    (supports {"{{variables}}"}, {"{{#if}}...{{/if}}"}, {"{{#each}}...{{/each}}"})
                  </span>
                </label>
                <div class="pk-field__control pk-overlay-editor">
                  <pre
                    ref={bodyPreRef}
                    aria-hidden="true"
                    class="pk-overlay-editor__backdrop pk-overlay-editor__backdrop--wrap"
                  ></pre>
                  {/*
                   * Written out rather than composed from <Textarea>: the caret
                   * arithmetic in insertSnippet needs the element itself, and a
                   * ref on a Preact function component resolves to the
                   * component instance rather than the DOM node. The classes
                   * are exactly the ones <Textarea> applies.
                   */}
                  <textarea
                    id="email-template-editor-body"
                    ref={bodyTextareaRef}
                    class="pk-input pk-input--textarea pk-mono pk-overlay-editor__input"
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
              <div class="pk-field">
                <label class="pk-field__label" for="email-template-partial">
                  Insert partial
                </label>
                <div class="pk-field__control">
                  <Select
                    id="email-template-partial"
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
                  </Select>
                </div>
              </div>

              {/* Template helpers */}
              <div class="pk-stack pk-stack--snug">
                {/* A heading over a row of buttons, not the label of a control:
                    `pk-field__label` outside a `pk-field` names nothing and can
                    never carry a state. */}
                <div class="pk-stack pk-stack--tight">
                  <span class="pk-small pk-strong">Template helpers</span>
                  <span class="pk-small">Click to insert into the active field.</span>
                </div>
                {HELPER_CATEGORIES.map((cat) => (
                  <div key={cat} class="pk-stack pk-stack--tight">
                    <span class="pk-small pk-strong">{cat}</span>
                    <div class="pk-cluster">
                      {TEMPLATE_HELPERS.filter((item) => item.category === cat).map((item) => (
                        <Button
                          key={item.label}
                          size="sm"
                          disabled={!canWrite}
                          onClick={() => insertSnippet(item.snippet, item.target)}
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Preview data */}
              {canWrite && (
                <div class="pk-field">
                  <div class="pk-cluster pk-cluster--between">
                    <label class="pk-field__label" for="email-template-preview-data">
                      Preview data (JSON)
                    </label>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setPreviewData(JSON.stringify(PREVIEW_DEFAULTS, null, 2))}
                    >
                      Reset to defaults
                    </Button>
                  </div>
                  <div class="pk-field__control">
                    <Textarea
                      id="email-template-preview-data"
                      class="pk-mono"
                      rows={6}
                      value={previewData}
                      onInput={(e) => setPreviewData((e.target as HTMLTextAreaElement).value)}
                    />
                  </div>
                </div>
              )}

              <div class="pk-cluster">
                {canWrite ? (
                  <>
                    <Button variant="secondary" onClick={() => void doPreview()}>
                      Render Preview
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void doSave()}
                      disabled={saving || !hasPreviewedRef.current}
                      loading={saving}
                    >
                      {saving ? "Saving…" : "Save as Draft"}
                    </Button>
                    <span class="pk-small">
                      Preview required before saving. Saving creates a new draft version — activate it below.
                    </span>
                  </>
                ) : (
                  <span class="pk-small">Read-only access. Template changes require write permission.</span>
                )}
              </div>
            </div>

            {/* Preview column */}
            {canWrite && (
              <Panel>
                <PanelHeader title="Rendered Preview" />
                <PanelBody class="pk-stack pk-stack--snug">
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-small">Subject</span>
                    <span class="pk-strong">{previewSubject}</span>
                  </div>
                  <Tabs
                    items={EMAIL_PREVIEW_TABS}
                    active={previewTab}
                    onChange={(key) => setPreviewTab(key as EmailPreviewTab)}
                  />
                  {previewTab === "html" ? (
                    <iframe
                      ref={iframeRef}
                      title="Rendered email HTML preview"
                      sandbox=""
                      class="pk-framed"
                      height={360}
                    />
                  ) : (
                    <pre class="pk-code-block pk-small pk-break">{previewText}</pre>
                  )}
                  <p class="pk-small" role="status">
                    {previewStatus}
                  </p>
                </PanelBody>
              </Panel>
            )}
          </div>
        </PanelBody>
      </Panel>

      {/* Version history */}
      <Panel>
        <PanelHeader title="Version History" headingLevel={2} />
        <PanelBody>
          <ApiDataTable
            caption="Email template versions"
            endpoint={`${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions`}
            responseSchema={emailTemplateVersionsListResponseSchema}
            resolve={(response) => response.versions}
            resolvePage={(response) => response.page}
            paginate
            initialPageSize={25}
            initialSort="-version"
            actionsRef={historyRef}
            columns={[
              { header: "Version", cell: (v) => <code>v{v.version}</code> },
              {
                header: "Status",
                cell: (v) => <Badge tone={versionTone(v.status)}>{statusLabel(v.status)}</Badge>,
              },
              {
                header: "Type",
                cell: (v) => (v.message_type ? <Badge tone="neutral">{statusLabel(v.message_type)}</Badge> : "—"),
              },
              {
                header: "Checksum",
                cell: (v) => <code>{v.checksum_sha256.substring(0, 12)}…</code>,
                className: "pk-small",
              },
              {
                header: "Created",
                cell: (v) => (v.created_at ? new Date(v.created_at).toLocaleString("en-US") : "—"),
                className: "pk-small",
              },
              {
                header: "",
                cell: (v) => (
                  <div class="pk-cluster">
                    {canWrite && v.status !== "active" ? (
                      <Button size="sm" onClick={() => void doActivate(v.version)}>
                        Activate
                      </Button>
                    ) : v.status === "active" ? (
                      <Badge tone="ok">In use</Badge>
                    ) : null}
                    <Button size="sm" onClick={() => loadVersion(v)}>
                      Load
                    </Button>
                  </div>
                ),
              },
            ]}
            empty="No versions yet"
            rowKey={(v) => v.id}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
