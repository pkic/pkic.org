import {
  eventEmailCampaignAudienceSchema,
  isInvitationCampaignAudience,
  type EventEmailCampaignAudience,
} from "../../../shared/schemas/event-email-campaigns";
import { useState, useEffect, useRef } from "preact/hooks";
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
  eventEmailCampaignDayWaitlistFilterSchema,
  eventEmailCampaignPreviewInputSchema,
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
  eventEmailCampaignSendModeSchema,
  eventEmailCampaignSpeakerStatusFilterSchema,
  type EventEmailCampaignDayWaitlistFilter,
  type EventEmailCampaignPreviewResponse,
  type EventEmailCampaignSendMode,
  type EventEmailCampaignInvitationStatusFilter,
  type EventEmailCampaignSpeakerStatusFilter,
} from "../../../shared/schemas/event-email-campaigns";
import { EMAIL_MESSAGE_TYPE_OPTIONS } from "../../shared/email-type-options";
import { type TemplateHelperItem } from "../../shared/email-template-helpers";
import { bodyTemplateInsertions, subjectTemplateInsertions } from "../../shared/email-template-insertions";
import { highlightTemplateSyntax } from "../../shared/email-template-syntax";
import type { EmailMessageType } from "../../../shared/schemas/email-templates";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../shared/email-preview-tabs";
import {
  AUDIENCE_LABELS,
  DAY_WAITLIST_FILTER_LABELS,
  PERSONAL_ONLY_HELPERS,
  SEND_MODE_LABELS,
  SPEAKER_STATUS_FILTER_LABELS,
  availableHelperLabelsForAudience,
  availablePartialsForAudience,
  type CampaignPayload,
  useDays,
} from "./event-email-campaign-support";
import {
  EVENT_REGISTRATION_STATUS_FILTERS,
  eventRegistrationStatusLabel,
  eventRegistrationStatusFilterSchema,
  type EventRegistrationStatusFilter,
} from "../../../shared/schemas/event-registrations";
import { ServerSearchSelect } from "../ServerSearchSelect";
import { requestJson } from "../../shared/api-client";
import { EventInvitationStatusFilter } from "./EventInvitationStatusFilter";
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
  notify = () => {},
  cancelHref,
  onSent,
}: {
  campaignsPath: string;
  daysPath: string;
  initialAudience?: EventEmailCampaignAudience;
  initialSubject?: string;
  initialBody?: string;
  notify?: (message: string, type: "success" | "error") => void;
  /** The way back, when the composer is a page of its own. */
  cancelHref?: string;
  /** Told once the campaign is queued, so a page can return to where it came from. */
  onSent?: () => void;
}) {
  const days = useDays(daysPath);

  const [templateKey, setTemplateKey] = useState("");
  const [mode, setMode] = useState<EventEmailCampaignSendMode>("personal");
  const [messageType, setMessageType] = useState<EmailMessageType>("promotional");
  const [batchSize, setBatchSize] = useState(500);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [audience, setAudience] = useState<EventEmailCampaignAudience>(initialAudience);

  // attendee filters
  const [attendeeStatus, setAttendeeStatus] = useState<EventRegistrationStatusFilter>("registered");
  const [attendanceType, setAttendanceType] = useState("all");
  const [dayFilter, setDayFilter] = useState("");
  const [dayWaitlistStatus, setDayWaitlistStatus] = useState<EventEmailCampaignDayWaitlistFilter>("all");

  // speaker filters
  const [speakerStatus, setSpeakerStatus] = useState<EventEmailCampaignSpeakerStatusFilter>("confirmed");
  const [invitationStatus, setInvitationStatus] = useState<EventEmailCampaignInvitationStatusFilter>("all");

  // preview state
  const [preview, setPreview] = useState<EventEmailCampaignPreviewResponse | null>(null);
  const [rawPreviewTab, setPreviewTab] = useHashQueryParam("campaignTab", "html");
  const previewTab: EmailPreviewTab = rawPreviewTab === "text" ? "text" : "html";
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [status, setStatus] = useState("Preview required before sending.");
  const [sending, setSending] = useState(false);

  const bodyEditor = useRef<MarkdownEditorHandle>(null);
  const subjectPreRef = useRef<HTMLPreElement>(null);
  const [bodyRevision, setBodyRevision] = useState(0);
  const templateRequestIdRef = useRef(0);
  const availableHelperLabels = availableHelperLabelsForAudience(audience);
  const availablePartials = availablePartialsForAudience(audience);

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
    audience,
    mode,
    messageType,
    batchSize,
    attendeeStatus,
    attendanceType,
    dayFilter,
    dayWaitlistStatus,
    speakerStatus,
    invitationStatus,
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
      sendMode: mode,
      batchSize,
      filter: {
        audience,
      },
    };
    if (templateKey) base.templateKey = templateKey;
    if (withToken) base.previewToken = withToken;
    if (audience === "attendees") {
      base.filter.attendeeStatus = attendeeStatus as CampaignPayload["filter"]["attendeeStatus"];
      base.filter.attendanceType = attendanceType as CampaignPayload["filter"]["attendanceType"];
      if (dayFilter) base.filter.dayDate = dayFilter;
      base.filter.dayWaitlistStatus = dayWaitlistStatus;
    } else if (audience === "speakers") {
      base.filter.speakerStatus = speakerStatus;
    } else if (isInvitationCampaignAudience(audience)) {
      base.filter.invitationStatus = invitationStatus;
    }
    return base;
  }

  const form = useContractForm(eventEmailCampaignPreviewInputSchema, buildPayload());

  async function handlePreview() {
    const checked = form.submit();
    if (!checked.data) {
      notify(checked.message, "error");
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
      const msg = (e as Error).message;
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
      notify(`Campaign accepted for ${count} recipient${count !== 1 ? "s" : ""}`, "success");
      setStatus(
        `${res.stagedRecipients} of ${count} recipients added to the outbox. Open the Email outbox to add any remaining campaign messages.`,
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

  const personal = mode === "personal";

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
      <div class="pk-grid" aria-label="Audience and filters">
        <Field label="Audience" {...form.of("filter.audience")}>
          {(control) => (
            <Select
              {...control}
              name="filter.audience"
              value={audience}
              onChange={(event) =>
                setAudience(eventEmailCampaignAudienceSchema.parse((event.target as HTMLSelectElement).value))
              }
            >
              {eventEmailCampaignAudienceSchema.options.map((option) => (
                <option key={option} value={option}>
                  {AUDIENCE_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {isInvitationCampaignAudience(audience) ? (
          <EventInvitationStatusFilter
            value={invitationStatus}
            onChange={setInvitationStatus}
            field={form.of("filter.invitationStatus")}
          />
        ) : audience === "attendees" ? (
          <>
            <Field label="Registration status">
              {(control) => (
                <Select
                  {...control}
                  value={attendeeStatus}
                  onChange={(e) =>
                    setAttendeeStatus(eventRegistrationStatusFilterSchema.parse((e.target as HTMLSelectElement).value))
                  }
                >
                  {EVENT_REGISTRATION_STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {status === "all" ? "All" : eventRegistrationStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Attendance type">
              {(control) => (
                <Select
                  {...control}
                  value={attendanceType}
                  onChange={(e) => setAttendanceType((e.target as HTMLSelectElement).value)}
                >
                  <option value="all">All types</option>
                  <option value="in_person">In-person</option>
                  <option value="virtual">Virtual</option>
                  <option value="on_demand">On-demand</option>
                </Select>
              )}
            </Field>
            <Field label="Specific day">
              {(control) => (
                <Select
                  {...control}
                  value={dayFilter}
                  onChange={(e) => setDayFilter((e.target as HTMLSelectElement).value)}
                >
                  <option value="">All days</option>
                  {days.map((d) => {
                    const dateKey = d.day_date ?? d.date ?? "";
                    return (
                      <option key={dateKey} value={dateKey}>
                        {d.label ?? dateKey}
                      </option>
                    );
                  })}
                </Select>
              )}
            </Field>
            <Field label="Day waitlist">
              {(control) => (
                <Select
                  {...control}
                  value={dayWaitlistStatus}
                  onChange={(e) =>
                    setDayWaitlistStatus(
                      eventEmailCampaignDayWaitlistFilterSchema.parse((e.target as HTMLSelectElement).value),
                    )
                  }
                >
                  {eventEmailCampaignDayWaitlistFilterSchema.options.map((waitlistStatus) => (
                    <option key={waitlistStatus} value={waitlistStatus}>
                      {DAY_WAITLIST_FILTER_LABELS[waitlistStatus]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : (
          <Field label="Speaker status">
            {(control) => (
              <Select
                {...control}
                value={speakerStatus}
                onChange={(e) =>
                  setSpeakerStatus(
                    eventEmailCampaignSpeakerStatusFilterSchema.parse((e.target as HTMLSelectElement).value),
                  )
                }
              >
                {/* Reading the contract's order puts "All active" at the head
                    of the list where the hand-written version led with
                    "Confirmed"; the composer still opens on confirmed
                    speakers, because that is what the state starts as. */}
                {eventEmailCampaignSpeakerStatusFilterSchema.options.map((status) => (
                  <option key={status} value={status}>
                    {SPEAKER_STATUS_FILTER_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

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
              value={mode}
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

      {/* Preview panel */}
      {preview && (
        <Panel>
          <PanelHeader title="Email Preview" />
          <PanelBody class="pk-stack pk-stack--snug">
            <div class="pk-stack pk-stack--tight">
              <span class="pk-small">Subject</span>
              <span class="pk-strong">{preview.subject}</span>
            </div>
            <span class="pk-small">{preview.recipientCount} recipients</span>
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
          <Button size="sm" onClick={() => void handlePreview()}>
            Preview Email
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSend()}
            disabled={sending || !previewConfirmed}
            loading={sending}
          >
            Send Email
          </Button>
          {cancelHref && (
            <ButtonLink size="sm" variant="ghost" href={cancelHref}>
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
