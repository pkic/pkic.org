import { useState, useEffect, useRef } from "preact/hooks";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { Tabs } from "../Tabs";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, Textarea, TextInput } from "../../ui/TextControl";
import { highlightTemplateSyntax } from "../../shared/email-template-syntax";
import {
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
  type EventEmailCampaignPreviewResponse,
} from "../../../shared/schemas/event-email-campaigns";
import { TEMPLATE_HELPERS, TEMPLATE_PARTIALS, type TemplateHelperItem } from "../../shared/email-template-helpers";
import type { EmailMessageType } from "../../../shared/schemas/email-templates";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../shared/email-preview-tabs";
import {
  HELPER_CATEGORIES,
  PERSONAL_ONLY_HELPERS,
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
import { emailTemplateCatalog, getEmailTemplateEditorVersion } from "../../shared/email-template-catalog";

// The syntax-highlight backdrop rides this chunk rather than the entry
// stylesheet, because only the two template editors use it.
import "../../ui/OverlayEditor.css";
import "../../ui/Content.css";

/**
 * One template token, inserted at the caret.
 *
 * A tag that reads a recipient's own data cannot be honoured by a single BCC
 * message, so in broadcast mode the control is disabled rather than removed:
 * the vocabulary stays visible and the title says why it is unavailable.
 */
function SnippetButton({
  snippet,
  label,
  personal,
  personalOnly,
  onInsert,
}: {
  snippet: string;
  label: string;
  personal: boolean;
  personalOnly?: boolean;
  onInsert: (snippet: string) => void;
}) {
  const unavailable = Boolean(personalOnly) && !personal;
  return (
    <Button
      size="sm"
      disabled={unavailable}
      title={unavailable ? "Only available in Personal mode" : snippet}
      onClick={() => onInsert(snippet)}
    >
      {label}
    </Button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EventEmailCampaign({
  campaignsPath,
  daysPath,
  audience: defaultAudience = "attendees",
  notify = () => {},
}: {
  campaignsPath: string;
  daysPath: string;
  audience?: "attendees" | "speakers";
  notify?: (message: string, type: "success" | "error") => void;
}) {
  const days = useDays(daysPath);

  const [templateKey, setTemplateKey] = useState("");
  const [mode, setMode] = useState<"personal" | "bcc_batch">("personal");
  const [messageType, setMessageType] = useState<EmailMessageType>("promotional");
  const [batchSize, setBatchSize] = useState(500);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience] = useState<"attendees" | "speakers">(defaultAudience);

  // attendee filters
  const [attendeeStatus, setAttendeeStatus] = useState<EventRegistrationStatusFilter>("registered");
  const [attendanceType, setAttendanceType] = useState("all");
  const [dayFilter, setDayFilter] = useState("");
  const [dayWaitlistStatus, setDayWaitlistStatus] = useState("all");

  // speaker filters
  const [speakerStatus, setSpeakerStatus] = useState("confirmed");

  // preview state
  const [preview, setPreview] = useState<EventEmailCampaignPreviewResponse | null>(null);
  const [rawPreviewTab, setPreviewTab] = useHashQueryParam("campaignTab", "html");
  const previewTab: EmailPreviewTab = rawPreviewTab === "text" ? "text" : "html";
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [status, setStatus] = useState("Preview required before sending.");
  const [sending, setSending] = useState(false);

  // backdrop ref for textarea highlight
  const bodyPreRef = useRef<HTMLPreElement>(null);
  const templateRequestIdRef = useRef(0);
  const availableHelperLabels = availableHelperLabelsForAudience(audience);
  const availablePartials = availablePartialsForAudience(audience);

  // Sync highlight backdrop
  useEffect(() => {
    if (bodyPreRef.current) bodyPreRef.current.innerHTML = `${highlightTemplateSyntax(body)}\n`;
  }, [body]);

  /**
   * The body control. `Textarea` is a function component, and a ref on one
   * resolves to the component rather than the DOM node, so the element is
   * reached from the backdrop it shares a control box with.
   */
  function bodyControl(): HTMLTextAreaElement | null {
    return bodyPreRef.current?.parentElement?.querySelector("textarea") ?? null;
  }

  function handleBodyScroll() {
    const ta = bodyControl();
    if (bodyPreRef.current && ta) {
      bodyPreRef.current.scrollTop = ta.scrollTop;
    }
  }

  function insertSnippet(snippet: string) {
    const ta = bodyControl();
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const newVal = body.substring(0, start) + snippet + body.substring(end);
    setBody(newVal);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
      ta.focus();
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
      base.filter.dayWaitlistStatus = dayWaitlistStatus as CampaignPayload["filter"]["dayWaitlistStatus"];
    } else {
      base.filter.speakerStatus = speakerStatus as CampaignPayload["filter"]["speakerStatus"];
    }
    return base;
  }

  async function handlePreview() {
    if (!subject.trim() || !body.trim()) {
      notify("Subject and body are required.", "error");
      return;
    }
    setStatus("Generating preview…");
    setPreview(null);
    setPreviewConfirmed(false);
    try {
      const res = await requestJson(`${campaignsPath}/previews`, eventEmailCampaignPreviewResponseSchema, {
        method: "POST",
        body: JSON.stringify(buildPayload()),
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
    setStatus("Sending…");
    try {
      const res = await requestJson(campaignsPath, eventEmailCampaignResponseSchema, {
        method: "POST",
        body: JSON.stringify(buildPayload(preview.previewToken)),
      });
      const count = res.queuedRecipients;
      notify(`Email queued for ${count} recipient${count !== 1 ? "s" : ""}`, "success");
      setStatus(`✓ Sent to ${count} recipients.`);
      setPreview(null);
      setPreviewConfirmed(false);
      setSubject("");
      setBody("");
      setTemplateKey("");
      setMessageType("promotional");
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(msg);
      notify(msg, "error");
    } finally {
      setSending(false);
    }
  }

  const personal = mode === "personal";

  function isHelperVisible(item: TemplateHelperItem): boolean {
    return availableHelperLabels.has(item.label);
  }

  function isHelperPersonalOnly(item: TemplateHelperItem): boolean {
    return PERSONAL_ONLY_HELPERS.has(item.label);
  }

  return (
    <div class="pk pk-stack">
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
              onChange={(e) => setMode((e.target as HTMLSelectElement).value as "personal" | "bcc_batch")}
            >
              <option value="personal">Personal (1:1)</option>
              <option value="bcc_batch">Broadcast BCC</option>
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
              <option value="transactional">Transactional</option>
              <option value="promotional">Promotional</option>
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
      <Field label="Subject">
        {(control) => (
          <TextInput
            {...control}
            type="text"
            placeholder="Email subject"
            value={subject}
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
          />
        )}
      </Field>

      {/* Body + variables sidebar */}
      <div class="pk-grid pk-grid--roomy">
        {/* The field's control box is the backdrop's positioning context —
            both want `position: relative` — so the backdrop and the control
            sit directly in the box the Field provides rather than in a second
            box of their own. */}
        <Field label="Message" help="Markdown, {{variables}}">
          {(control) => (
            <>
              <pre
                ref={bodyPreRef}
                aria-hidden="true"
                class="pk-overlay-editor__backdrop pk-overlay-editor__backdrop--wrap"
              />
              <Textarea
                {...control}
                class="pk-mono pk-overlay-editor__input"
                rows={14}
                placeholder="Write your message here, or load a template above."
                value={body}
                onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                onScroll={handleBodyScroll}
              />
            </>
          )}
        </Field>
        <Panel>
          <PanelHeader title="Template helpers" />
          <PanelBody class="pk-stack pk-stack--snug">
            {HELPER_CATEGORIES.map((category) => {
              const items = TEMPLATE_HELPERS.filter((item) => item.category === category && isHelperVisible(item));
              if (items.length === 0) return null;
              return (
                <div key={category} class="pk-stack pk-stack--tight">
                  <span class="pk-small pk-strong">{category}</span>
                  <div class="pk-cluster">
                    {items.map((item) => (
                      <SnippetButton
                        key={item.label}
                        snippet={item.snippet}
                        label={item.label}
                        personal={personal}
                        personalOnly={isHelperPersonalOnly(item)}
                        onInsert={insertSnippet}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <div class="pk-stack pk-stack--tight">
              <span class="pk-small pk-strong">Partials</span>
              <div class="pk-cluster">
                {TEMPLATE_PARTIALS.filter((partial) => availablePartials.has(partial.name)).map((partial) => (
                  <SnippetButton
                    key={partial.name}
                    snippet={`{{> ${partial.name}}}`}
                    label={partial.name}
                    personal={personal}
                    personalOnly={partial.name === "reg_details"}
                    onInsert={insertSnippet}
                  />
                ))}
              </div>
            </div>
            {!personal && <p class="pk-small">Recipient-specific tags are disabled in Broadcast BCC mode.</p>}
          </PanelBody>
        </Panel>
      </div>

      {/* Filters */}
      {audience === "attendees" ? (
        <div class="pk-grid">
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
                onChange={(e) => setDayWaitlistStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="all">Any state</option>
                <option value="active">Active waitlist</option>
                <option value="waiting">Waiting</option>
                <option value="offered">Offer sent</option>
                <option value="accepted">Accepted offer</option>
                <option value="none">Not waitlisted</option>
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <div class="pk-grid">
          <Field label="Speaker status">
            {(control) => (
              <Select
                {...control}
                value={speakerStatus}
                onChange={(e) => setSpeakerStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="confirmed">Confirmed</option>
                <option value="all">All active</option>
                <option value="invited">Invited</option>
                <option value="pending">Pending</option>
              </Select>
            )}
          </Field>
        </div>
      )}

      {/* Action bar */}
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
        {/*
         * The only account of what the last preview or send did, so it is a
         * live region: a screen-reader user who has tabbed past the buttons is
         * told the result instead of having to go looking for it.
         */}
        <span class="pk-small" role="status">
          {status}
        </span>
      </div>

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
            {/*
             * The rendered email is author-supplied HTML, so it stays in an
             * iframe with an empty `sandbox`: no scripts, no forms, no
             * same-origin access, no navigation. `srcdoc` keeps it out of a
             * network fetch. Neither may be relaxed.
             */}
            {previewTab === "html" && (
              <iframe
                title="Rendered campaign email preview"
                srcdoc={preview.html}
                sandbox=""
                class="pk-framed"
                height={600}
              />
            )}
            {previewTab === "text" && <pre class="pk-code-block pk-small pk-break">{preview.text}</pre>}
            <Checkbox
              class="pk-small"
              checked={previewConfirmed}
              onChange={(e) => setPreviewConfirmed((e.target as HTMLInputElement).checked)}
              label="I reviewed this email preview and confirm sending."
            />
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
