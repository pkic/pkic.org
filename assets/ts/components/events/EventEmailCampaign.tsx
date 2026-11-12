import type { EventEmailCampaignAudience } from "../../../shared/schemas/event-email-campaigns";
import { formatNumber } from "../../../shared/format-number";
import { useState, useEffect, useRef } from "preact/hooks";
import type { z } from "zod";
import type { promotionFormatSchema } from "../../../shared/schemas/event-promotion-kit";
import { RECOMMENDED_KIT_FORMATS, SpeakerKitAttachments } from "./SpeakerKitAttachments";
import { PromotionMaterialAttachments } from "./PromotionMaterialAttachments";
import { useContractForm } from "../../hooks/useContractForm";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { Tabs } from "../Tabs";
import { Button, ButtonLink } from "../../ui/Button";
import { EmailHtmlPreview } from "../../ui/EmailHtmlPreview";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, TextInput } from "../../ui/TextControl";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { IconBraces } from "../icons";
import { Menu } from "../../ui/Menu";
import type { MarkdownEditorHandle } from "../markdown-editor/MarkdownEditor";
import {
  eventEmailCampaignPreviewInputSchema,
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
  speakerKitTestResponseSchema,
  eventEmailCampaignSendModeSchema,
  type EventEmailCampaignPreviewResponse,
  type EventEmailCampaignSendMode,
  type PromotionMaterialFile,
} from "../../../shared/schemas/event-email-campaigns";
import { EMAIL_MESSAGE_TYPE_OPTIONS } from "../../shared/email-type-options";
import { type TemplateHelperItem } from "../../shared/email-template-helpers";
import { bodyTemplateInsertions, subjectTemplateInsertions } from "../../shared/email-template-insertions";
import { highlightTemplateSyntax } from "../../shared/email-template-syntax";
import type { EmailMessageType } from "../../../shared/schemas/email-templates";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../shared/email-preview-tabs";
import {
  PERSONAL_ONLY_HELPERS,
  SEND_MODE_LABELS,
  availableHelperLabelsForAudience,
  availablePartialsForAudience,
  type CampaignPayload,
} from "./event-email-campaign-support";
import { ServerSearchSelect } from "../ServerSearchSelect";
import { requestJson } from "../../shared/api-client";
import { EventEmailCampaignAudienceFields, useCampaignAudience } from "./EventEmailCampaignAudienceFields";
import { emailTemplateCatalog, getEmailTemplateEditorVersion } from "../../shared/email-template-catalog";

import "../../ui/Content.css";
import "../../ui/OverlayEditor.css";

// ─── Main component ───────────────────────────────────────────────────────────

export function EventEmailCampaign({
  campaignsPath,
  daysPath,
  initialAudience = "attendees",
  initialSubject = "",
  initialBody = "",
  initialAttachKits = false,
  materials,
  notify = () => {},
  cancelHref,
  onSent,
}: {
  campaignsPath: string;
  daysPath: string;
  initialAudience?: EventEmailCampaignAudience;
  initialSubject?: string;
  initialBody?: string;
  initialAttachKits?: boolean;
  /** Files picked from one person's promotion materials: the message goes to that person only. */
  materials?: { userId: string; files: PromotionMaterialFile[]; onReview?: () => void };
  notify?: (message: string, type: "success" | "error") => void;
  /** The way back, when the composer is a page of its own. */
  cancelHref?: string;
  /** Told once the campaign is queued, so a page can return to where it came from. */
  onSent?: () => void;
}) {
  const [templateKey, setTemplateKey] = useState("");
  const [mode, setMode] = useState<EventEmailCampaignSendMode>("personal");
  const [messageType, setMessageType] = useState<EmailMessageType>("promotional");
  const [batchSize, setBatchSize] = useState(500);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const selection = useCampaignAudience(daysPath, initialAudience, initialAttachKits ? "scheduled" : "confirmed");
  const { audience, speakerStatus } = selection;
  const filter: CampaignPayload["filter"] = materials
    ? { audience: "attendees", attendeeStatus: "all", userIds: [materials.userId] }
    : selection.filter;
  const filterKey = JSON.stringify(filter);
  const materialsKey = JSON.stringify(materials?.files ?? null);

  // promotion kit attachments
  const [kitFormats, setKitFormats] = useState<z.infer<typeof promotionFormatSchema>[]>([...RECOMMENDED_KIT_FORMATS]);
  const [kitResend, setKitResend] = useState(false);
  const [attachKits, setAttachKits] = useState(initialAttachKits);
  const kitsAvailable = audience === "speakers" && speakerStatus === "scheduled";
  const sendsKits = !materials && kitsAvailable && attachKits;
  const sendsFiles = sendsKits || Boolean(materials);

  // preview state
  const [preview, setPreview] = useState<EventEmailCampaignPreviewResponse | null>(null);
  const [rawPreviewTab, setPreviewTab] = useHashQueryParam("campaignTab", "html");
  const previewTab: EmailPreviewTab = rawPreviewTab === "text" ? "text" : "html";
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [status, setStatus] = useState("Preview required before sending.");
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);

  const bodyEditor = useRef<MarkdownEditorHandle>(null);
  const subjectPreRef = useRef<HTMLPreElement>(null);
  const [bodyRevision, setBodyRevision] = useState(0);
  const templateRequestIdRef = useRef(0);
  const availableHelperLabels = availableHelperLabelsForAudience(filter.audience, {
    kits: sendsKits,
    materials: Boolean(materials),
  });
  const availablePartials = availablePartialsForAudience(filter.audience);

  useEffect(() => {
    if (subjectPreRef.current) {
      subjectPreRef.current.innerHTML = subject ? `${highlightTemplateSyntax(subject)}&nbsp;` : "";
    }
  }, [subject]);

  useEffect(() => {
    setPreview(null);
    setPreviewConfirmed(false);
  }, [
    subject,
    body,
    templateKey,
    filterKey,
    mode,
    messageType,
    batchSize,
    sendsKits,
    kitFormats,
    kitResend,
    materialsKey,
  ]);

  function insertSnippet(snippet: string) {
    bodyEditor.current?.insertText(snippet);
  }

  function insertSubjectSnippet(snippet: string) {
    const input = subjectPreRef.current?.parentElement?.querySelector("input");
    const start = input?.selectionStart ?? subject.length;
    const end = input?.selectionEnd ?? start;
    setSubject(`${subject.slice(0, start)}${snippet}${subject.slice(end)}`);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  async function handleTemplateChange(key: string) {
    setTemplateKey(key);
    if (!key) {
      templateRequestIdRef.current += 1;
      return;
    }
    const requestId = templateRequestIdRef.current + 1;
    templateRequestIdRef.current = requestId;
    try {
      const version = await getEmailTemplateEditorVersion(key);
      if (templateRequestIdRef.current !== requestId) {
        return;
      }
      if (!version) return;
      setSubject(version.subject_template ?? "");
      setBody(version.body ?? "");
      setBodyRevision((revision) => revision + 1);
      setMessageType(version.message_type ?? "promotional");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }

  function buildPayload(withToken?: string): CampaignPayload {
    const base: CampaignPayload = {
      subjectOverride: subject,
      bodyContent: body,
      messageType,
      sendMode: sendsFiles ? "personal" : mode,
      batchSize,
      filter,
    };
    if (sendsKits) base.kit = { formats: kitFormats, resend: kitResend };
    if (materials) base.materials = { files: materials.files };
    if (templateKey) base.templateKey = templateKey;
    if (withToken) base.previewToken = withToken;
    return base;
  }

  const form = useContractForm(eventEmailCampaignPreviewInputSchema, buildPayload());

  async function handlePreview() {
    const checked = form.submit();
    if (!checked.data) {
      if (checked.formMessage) notify(checked.formMessage, "error");
      return;
    }
    setStatus("Generating preview…");
    setPreview(null);
    setPreviewConfirmed(false);
    try {
      const res = await requestJson(`${campaignsPath}/previews`, eventEmailCampaignPreviewResponseSchema, {
        method: "POST",
        body: JSON.stringify(checked.data),
      });
      setPreview(res);
      setStatus(`Preview ready — ${res.recipientCount} recipients.`);
    } catch (e) {
      // A refusal that names a field (an unknown variable in the message) shows on that field.
      const msg = form.refuse(e);
      setStatus(msg);
      notify(msg, "error");
    }
  }

  async function handleSend() {
    if (!previewConfirmed) {
      notify("Review the preview and tick the confirmation checkbox.", "error");
      return;
    }
    if (!preview) return;
    setSending(true);
    setStatus("Queueing campaign…");
    try {
      const res = await requestJson(campaignsPath, eventEmailCampaignResponseSchema, {
        method: "POST",
        body: JSON.stringify(buildPayload(preview.previewToken)),
      });
      const count = res.queuedRecipients;
      notify(
        sendsKits
          ? `Preparing ${formatNumber(count)} speaker kit email${count !== 1 ? "s" : ""}`
          : materials
            ? "Preparing the email with the picked files"
            : `Campaign accepted for ${count} recipient${count !== 1 ? "s" : ""}`,
        "success",
      );
      setStatus(
        sendsFiles
          ? "Each email goes out once its files are ready."
          : `${res.stagedRecipients} of ${count} recipients added to the outbox. Open the Email outbox to add any remaining campaign messages.`,
      );
      setPreview(null);
      setPreviewConfirmed(false);
      setSubject("");
      setBody("");
      setBodyRevision((revision) => revision + 1);
      setTemplateKey("");
      setMessageType("promotional");
      onSent?.();
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(msg);
      notify(msg, "error");
    } finally {
      setSending(false);
    }
  }

  async function handleTest() {
    if (!preview) return;
    setTesting(true);
    try {
      const res = await requestJson(`${campaignsPath}/tests`, speakerKitTestResponseSchema, {
        method: "POST",
        body: JSON.stringify(buildPayload(preview.previewToken)),
      });
      notify(`Test on its way to you, using the kit for “${res.sessionTitle}”`, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setTesting(false);
    }
  }

  // Each kit is personal, so an attached kit rules out a shared BCC send.
  const personal = sendsFiles || mode === "personal";

  function isHelperAvailable(item: TemplateHelperItem): boolean {
    return availableHelperLabels.has(item.label);
  }

  const subjectInsertions = subjectTemplateInsertions(insertSubjectSnippet, isHelperAvailable).map((item) => ({
    ...item,
    disabled: !personal && PERSONAL_ONLY_HELPERS.has(item.id),
  }));
  const bodyInsertions = bodyTemplateInsertions(insertSnippet, isHelperAvailable, (partial) =>
    availablePartials.has(partial.name),
  ).map((item) => ({
    ...item,
    disabled: !personal && (PERSONAL_ONLY_HELPERS.has(item.id) || item.id === "partial-reg_details"),
  }));

  return (
    <div class="pk pk-stack" {...form.handlers}>
      {materials ? (
        <Field label="Recipient" help="Only the person whose promotion materials you picked.">
          {() => <p class="pk-small">{preview?.sampleRecipients[0] ?? "Shown in the preview"}</p>}
        </Field>
      ) : (
        <EventEmailCampaignAudienceFields
          selection={selection}
          audienceField={form.of("filter.audience")}
          invitationField={form.of("filter.invitationStatus")}
        />
      )}

      {/* Template + mode */}
      <div class="pk-grid">
        <Field label="Template">
          {(control) => (
            <ServerSearchSelect
              {...control}
              catalog={emailTemplateCatalog("msg_")}
              searchLabel="Template"
              value={templateKey}
              selectedLabel={templateKey}
              placeholder="Write from scratch"
              onChange={(template) => void handleTemplateChange(template?.template_key ?? "")}
            />
          )}
        </Field>
        <Field label="Delivery mode">
          {(control) => (
            <Select
              {...control}
              value={personal ? "personal" : mode}
              disabled={sendsFiles}
              onChange={(e) => setMode(eventEmailCampaignSendModeSchema.parse((e.target as HTMLSelectElement).value))}
            >
              {eventEmailCampaignSendModeSchema.options.map((sendMode) => (
                <option key={sendMode} value={sendMode}>
                  {SEND_MODE_LABELS[sendMode]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Message type">
          {(control) => (
            <Select
              {...control}
              value={messageType}
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
        {!personal && (
          <Field label="BCC batch size">
            {(control) => (
              <TextInput
                {...control}
                type="number"
                min={1}
                max={500}
                value={batchSize}
                onInput={(e) => setBatchSize(parseInt((e.target as HTMLInputElement).value) || 500)}
              />
            )}
          </Field>
        )}
      </div>

      {/* Subject */}
      <Field label="Subject" {...form.of("subjectOverride")}>
        {(control) => (
          <div class="pk-template-subject">
            <div class="pk-overlay-editor">
              <pre ref={subjectPreRef} aria-hidden="true" class="pk-overlay-editor__backdrop"></pre>
              <TextInput
                {...control}
                class="pk-mono pk-overlay-editor__input"
                type="text"
                name="subjectOverride"
                placeholder="Email subject"
                value={subject}
                onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
              />
            </div>
            <Menu label="Insert subject variable" align="end" items={subjectInsertions}>
              <IconBraces />
            </Menu>
          </div>
        )}
      </Field>

      <Field label="Message" help="Markdown, {{variables}}" {...form.of("bodyContent")}>
        {(control) => (
          <MarkdownEditor
            {...control}
            key={bodyRevision}
            profile="content"
            name="bodyContent"
            label="Message"
            initialValue={body}
            initialMode="visual"
            templateInsertions={bodyInsertions}
            editorRef={bodyEditor}
            onChange={setBody}
          />
        )}
      </Field>
      {!personal && <p class="pk-small">Recipient-specific insertions are unavailable in Broadcast BCC mode.</p>}

      {materials && <PromotionMaterialAttachments files={materials.files} onReview={materials.onReview} />}
      {!materials && audience === "speakers" && (
        <SpeakerKitAttachments
          available={kitsAvailable}
          attached={attachKits}
          formats={kitFormats}
          resend={kitResend}
          formatsField={form.of("kit.formats")}
          onAttachedChange={setAttachKits}
          onFormatsChange={setKitFormats}
          onResendChange={setKitResend}
        />
      )}

      {/* Preview panel */}
      {preview && (
        <Panel>
          <PanelHeader title="Email Preview" />
          <PanelBody class="pk-stack pk-stack--snug">
            <div class="pk-stack pk-stack--tight">
              <span class="pk-small">Subject</span>
              <span class="pk-strong">{preview.subject}</span>
            </div>
            <span class="pk-small">
              {sendsKits
                ? `${formatNumber(preview.recipientCount)} emails, one per speaker for each session`
                : `${preview.recipientCount} recipients`}
            </span>
            <Tabs items={EMAIL_PREVIEW_TABS} active={previewTab} onChange={(key) => setPreviewTab(key)} className="" />
            {previewTab === "html" && (
              <EmailHtmlPreview title="Rendered campaign email preview" html={preview.html} height={600} />
            )}
            {previewTab === "text" && <pre class="pk-code-block pk-small pk-break">{preview.text}</pre>}
          </PanelBody>
        </Panel>
      )}
      {/* Action bar */}
      <div class="pk-stack pk-stack--snug">
        {preview && (
          <Checkbox
            class="pk-small"
            checked={previewConfirmed}
            onChange={(e) => setPreviewConfirmed((e.target as HTMLInputElement).checked)}
            label="I reviewed this email preview and confirm sending."
          />
        )}
        <div class="pk-cluster">
          <Button onClick={() => void handlePreview()}>Preview Email</Button>
          {sendsKits && preview && (
            <Button onClick={() => void handleTest()} disabled={testing} loading={testing}>
              Send test to me
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void handleSend()}
            disabled={sending || !previewConfirmed || preview?.recipientCount === 0}
            loading={sending}
          >
            Send Email
          </Button>
          {cancelHref && (
            <ButtonLink variant="ghost" href={cancelHref}>
              Cancel
            </ButtonLink>
          )}
          {/*
           * The only account of what the last preview or send did, so it is a
           * live region: a screen-reader user who has tabbed past the buttons is
           * told the result instead of having to go looking for it.
           */}
          <span class="pk-small" role="status">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
