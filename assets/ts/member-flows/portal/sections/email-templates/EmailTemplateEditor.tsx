import { IconBraces } from "../../../../components/icons";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";
import type { MarkdownEditorHandle } from "../../../../components/markdown-editor/MarkdownEditor";
import { useEffect, useRef, useState } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { Menu } from "../../../../ui/Menu";
import { Field } from "../../../../ui/Field";
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
  emailTemplatePreviewResponseSchema,
  emailTemplateVersionCreateResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../../../../shared/schemas/email-templates";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { EMAIL_CONTENT_TYPE_OPTIONS, EMAIL_MESSAGE_TYPE_OPTIONS } from "../../../../shared/email-type-options";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../../../shared/email-preview-tabs";
import { EMAIL_TEMPLATES_API } from "../../../../shared/email-template-catalog";
import { EmailTemplateVersionHistory } from "./EmailTemplateVersionHistory";

// The syntax-highlight backdrop rides this chunk rather than the entry
// stylesheet, because only the two template editors use it.
import "../../../../ui/OverlayEditor.css";
import "../../../../ui/Content.css";
const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];

export function TemplateEditor({
  templateKey,
  initialVersion,
  canWrite,
}: {
  templateKey: string;
  initialVersion: EmailTemplateVersion | null;
  canWrite: boolean;
}) {
  const current = initialVersion;
  const isLayout = templateKey === EMAIL_LAYOUT_TEMPLATE_KEY;

  const [contentType, setContentType] = useState<EmailContentType>(current?.content_type ?? "markdown");
  const [messageType, setMessageType] = useState<EmailMessageType>(current?.message_type ?? "transactional");
  const [subject, setSubject] = useState(current?.subject_template ?? "");
  const [fromEmail, setFromEmail] = useState(current?.from_email ?? "");
  const [fromName, setFromName] = useState(current?.from_name ?? "");
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
  const bodyEditor = useRef<MarkdownEditorHandle>(null);
  const [bodyRevision, setBodyRevision] = useState(0);
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
      const control = bodyControl();
      if (control) {
        bodyPreRef.current.scrollTop = control.scrollTop;
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

  /**
   * The body control. `Textarea` is a function component, and a ref on one
   * resolves to the component rather than the DOM node, so the element is
   * reached from the backdrop it shares a control box with.
   */
  function bodyControl(): HTMLTextAreaElement | null {
    return bodyPreRef.current?.parentElement?.querySelector("textarea") ?? null;
  }

  function handleBodyScroll() {
    const control = bodyControl();
    if (bodyPreRef.current && control) {
      bodyPreRef.current.scrollTop = control.scrollTop;
      bodyPreRef.current.scrollLeft = control.scrollLeft;
    }
  }

  function insertSnippet(snippet: string, preferredTarget?: "subject" | "body" | null) {
    const target = preferredTarget ?? editorFocusRef.current;
    if (target === "subject") {
      const input = subjectPreRef.current?.parentElement?.querySelector("input");
      const start = input?.selectionStart ?? subject.length;
      const end = input?.selectionEnd ?? start;
      setSubject(`${subject.slice(0, start)}${snippet}${subject.slice(end)}`);
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(start + snippet.length, start + snippet.length);
      });
      editorFocusRef.current = "subject";
    } else if (contentType === "markdown") {
      bodyEditor.current?.insertText(snippet);
    } else {
      setBody((b) => {
        const el = bodyControl();
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
    setFromEmail(version.from_email ?? "");
    setFromName(version.from_name ?? "");
    setBody(newBody);
    setBodyRevision((revision) => revision + 1);
    setContentType(version.content_type ?? "markdown");
    setMessageType(version.message_type ?? "transactional");
    const control = bodyControl();
    if (control) control.value = newBody;
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
          fromEmail: fromEmail.trim() || undefined,
          fromName: fromName.trim() || undefined,
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
      <Breadcrumb
        items={[
          { label: "Settings", href: "#/settings" },
          { label: "Email templates", href: "#/settings/email-templates" },
          { label: templateKey },
        ]}
      />
      <Panel>
        <PanelHeader title={`Edit: ${templateKey}`}>
          {isLayout && <Badge tone="info">shared shell</Badge>}
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void doSave()}
              disabled={saving || !hasPreviewedRef.current}
              loading={saving}
            >
              {saving ? "Saving…" : "Save as Draft"}
            </Button>
          )}
        </PanelHeader>
        <PanelBody>
          {/* A source and its preview are a pair, so they take half the page
              each rather than two of however many tracks fit (#49). */}
          <div class="pk-split">
            {/* Editor column */}
            <div class="pk-stack">
              {isLayout && <Alert tone="info">This template controls the outer email shell used for all emails.</Alert>}
              {!isLayout && (
                <div class="pk-grid">
                  <Field label="Content type">
                    {(control) => (
                      <Select
                        {...control}
                        value={contentType}
                        disabled={!canWrite}
                        onChange={(e) => setContentType((e.target as HTMLSelectElement).value as EmailContentType)}
                      >
                        {EMAIL_CONTENT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Default message type">
                    {(control) => (
                      <Select
                        {...control}
                        value={messageType}
                        disabled={!canWrite}
                        onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
                      >
                        {EMAIL_MESSAGE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              )}

              {!isLayout && (
                // The sender a template's messages carry. Empty means the
                // environment's configured address and name, as before (#106).
                <div class="pk-grid">
                  <Field label="From name" help="Shown beside the address; leave empty for the configured name.">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={fromName}
                        disabled={!canWrite}
                        onInput={(e) => setFromName((e.target as HTMLInputElement).value)}
                      />
                    )}
                  </Field>
                  <Field label="From address" help="Leave empty to send from the configured sender.">
                    {(control) => (
                      <TextInput
                        {...control}
                        type="email"
                        value={fromEmail}
                        disabled={!canWrite}
                        onInput={(e) => setFromEmail((e.target as HTMLInputElement).value)}
                      />
                    )}
                  </Field>
                </div>
              )}

              <Field label="Subject template" help="Supports conditions and variables.">
                {(control) => (
                  <div class="pk-template-subject">
                    <div class="pk-overlay-editor">
                      <pre ref={subjectPreRef} aria-hidden="true" class="pk-overlay-editor__backdrop"></pre>
                      <TextInput
                        {...control}
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
                    <Menu
                      label="Insert subject variable"
                      align="end"
                      items={TEMPLATE_HELPERS.filter((item) => item.category === "Variables").map((item) => ({
                        id: item.label,
                        label: item.label,
                        disabled: !canWrite,
                        onSelect: () => insertSnippet(item.snippet, "subject"),
                      }))}
                    >
                      <IconBraces />
                    </Menu>
                  </div>
                )}
              </Field>

              <Field label="Body" help="Supports {{variables}}, {{#if}}...{{/if}}, {{#each}}...{{/each}}.">
                {(control) =>
                  contentType === "markdown" ? (
                    <MarkdownEditor
                      {...control}
                      key={bodyRevision}
                      name="content"
                      label="Body"
                      initialValue={body}
                      initialMode="visual"
                      templateInsertions={[
                        ...TEMPLATE_HELPERS.map((item) => ({
                          id: item.label,
                          label: item.label,
                          disabled: !canWrite,
                          onSelect: () => insertSnippet(item.snippet, "body"),
                        })),
                        ...TEMPLATE_PARTIALS.map((partial, index) => ({
                          id: `partial-${partial.name}`,
                          label: `${partial.name} — ${partial.description}`,
                          separatorBefore: index === 0,
                          disabled: !canWrite,
                          onSelect: () => insertSnippet(`{{> ${partial.name}}}`, "body"),
                        })),
                      ]}
                      editorRef={bodyEditor}
                      disabled={!canWrite}
                      onFocus={() => {
                        editorFocusRef.current = "body";
                      }}
                      onChange={(value) => {
                        setBody(value);
                        hasPreviewedRef.current = false;
                      }}
                    />
                  ) : (
                    <>
                      <pre
                        ref={bodyPreRef}
                        aria-hidden="true"
                        class="pk-overlay-editor__backdrop pk-overlay-editor__backdrop--wrap"
                      ></pre>
                      <Textarea
                        {...control}
                        class="pk-mono pk-overlay-editor__input"
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
                    </>
                  )
                }
              </Field>

              {contentType !== "markdown" && (
                <details>
                  <summary class="pk-small pk-strong">Insert variables and reusable content</summary>
                  <div class="pk-stack">
                    {/* Partials */}
                    <Field label="Insert partial">
                      {(control) => (
                        <Select
                          {...control}
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
                      )}
                    </Field>

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
                  </div>
                </details>
              )}

              <p class="pk-small">
                {canWrite
                  ? "Preview your changes, save a draft, then activate it in Version history."
                  : "Read-only access. Template changes require write permission."}
              </p>
            </div>

            {/* Preview column */}
            {canWrite && (
              <Panel>
                <PanelHeader title="Rendered Preview">
                  <Button variant="secondary" size="sm" onClick={() => void doPreview()}>
                    Render Preview
                  </Button>
                </PanelHeader>
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
                  <details>
                    <summary class="pk-small pk-strong">Preview sample data</summary>
                    {/* Preview data. The reset sits under the field rather than in
                  its label row: the label names the control and nothing else. */}
                    <div class="pk-stack pk-stack--tight">
                      <Field label="Preview data (JSON)">
                        {(control) => (
                          <Textarea
                            {...control}
                            class="pk-mono"
                            rows={6}
                            value={previewData}
                            onInput={(e) => setPreviewData((e.target as HTMLTextAreaElement).value)}
                          />
                        )}
                      </Field>
                      <div class="pk-cluster pk-cluster--end">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => setPreviewData(JSON.stringify(PREVIEW_DEFAULTS, null, 2))}
                        >
                          Reset to defaults
                        </Button>
                      </div>
                    </div>
                  </details>
                </PanelBody>
              </Panel>
            )}
          </div>
        </PanelBody>
      </Panel>

      <EmailTemplateVersionHistory
        templateKey={templateKey}
        canWrite={canWrite}
        historyRef={historyRef}
        onLoad={loadVersion}
        onActivate={doActivate}
      />
    </div>
  );
}
