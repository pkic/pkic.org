import { useState, useEffect, useRef } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import {
  adminEventEmailPreviewResponseSchema,
  adminEventEmailSendResponseSchema,
} from "../../../../../shared/schemas/admin-events";
import {
  TEMPLATE_HELPERS,
  TEMPLATE_PARTIALS,
  type TemplateHelperItem,
} from "../../../../shared/email-template-helpers";
import { toast } from "../../../ui";
import type { EmailMessageType } from "../../../../../shared/schemas/email-templates";
import { EMAIL_PREVIEW_TABS, type EmailPreviewTab } from "../../../../shared/email-preview-tabs";
import {
  HELPER_CATEGORIES,
  PERSONAL_ONLY_HELPERS,
  SnippetBtn,
  availableHelperLabelsForAudience,
  availablePartialsForAudience,
  highlightBody,
  type CampaignPayload,
  useDays,
} from "./event-email-support";
import {
  EVENT_REGISTRATION_STATUS_FILTERS,
  eventRegistrationStatusLabel,
  eventRegistrationStatusFilterSchema,
  type EventRegistrationStatusFilter,
} from "../../../../../shared/schemas/event-registrations";
import { ServerSearchSelect } from "../../../components/ServerSearchSelect";
import { emailTemplateCatalog, getEmailTemplateEditorVersion } from "../../../../shared/email-template-catalog";

// ─── Main component ───────────────────────────────────────────────────────────

export function EventEmail({
  slug,
  audience: defaultAudience = "attendees",
}: {
  slug: string;
  audience?: "attendees" | "speakers";
}) {
  const days = useDays(slug);

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
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
    text: string;
    recipientCount?: number;
    previewToken?: string;
  } | null>(null);
  const [previewTab, setPreviewTab] = useState<EmailPreviewTab>("html");
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [status, setStatus] = useState("Preview required before sending.");
  const [sending, setSending] = useState(false);

  // backdrop refs for textarea highlight
  const bodyPreRef = useRef<HTMLPreElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const templateRequestIdRef = useRef(0);
  const availableHelperLabels = availableHelperLabelsForAudience(audience);
  const availablePartials = availablePartialsForAudience(audience);

  // Sync highlight backdrop
  useEffect(() => {
    if (bodyPreRef.current) bodyPreRef.current.innerHTML = highlightBody(body) + "\n";
  }, [body]);

  function handleBodyScroll() {
    if (bodyPreRef.current && bodyTextareaRef.current) {
      bodyPreRef.current.scrollTop = bodyTextareaRef.current.scrollTop;
    }
  }

  function insertSnippet(snippet: string) {
    const ta = bodyTextareaRef.current;
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
      toast((e as Error).message, "error");
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
      toast("Subject and body are required.", "error");
      return;
    }
    setStatus("Generating preview…");
    setPreview(null);
    setPreviewConfirmed(false);
    try {
      const res = await api(
        `/api/v1/admin/events/${slug}/emails/campaign/preview`,
        adminEventEmailPreviewResponseSchema,
        {
          method: "POST",
          body: JSON.stringify(buildPayload()),
        },
      );
      setPreview(res);
      setStatus(
        `Preview ready — ${res.recipientCount != null ? `${res.recipientCount} recipients` : "confirm to send"}.`,
      );
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(msg);
      toast(msg, "error");
    }
  }

  async function handleSend() {
    if (!previewConfirmed) {
      toast("Review the preview and tick the confirmation checkbox.", "error");
      return;
    }
    if (!preview) return;
    setSending(true);
    setStatus("Sending…");
    try {
      const res = await api(`/api/v1/admin/events/${slug}/emails/campaign/send`, adminEventEmailSendResponseSchema, {
        method: "POST",
        body: JSON.stringify(buildPayload(preview.previewToken)),
      });
      const count = res.queuedRecipients ?? 0;
      toast(`Email queued for ${count} recipient${count !== 1 ? "s" : ""}`, "success");
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
      toast(msg, "error");
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
    <div>
      {/* Template + mode */}
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <ServerSearchSelect
            catalog={emailTemplateCatalog("msg_")}
            label="Template"
            value={templateKey}
            selectedLabel={templateKey}
            placeholder="Write from scratch"
            onChange={(template) => void handleTemplateChange(template?.template_key ?? "")}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Delivery mode</label>
          <select
            class="form-select form-select-sm"
            value={mode}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value as "personal" | "bcc_batch")}
          >
            <option value="personal">Personal (1:1)</option>
            <option value="bcc_batch">Broadcast BCC</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Message type</label>
          <select
            class="form-select form-select-sm"
            value={messageType}
            onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as EmailMessageType)}
          >
            <option value="transactional">Transactional</option>
            <option value="promotional">Promotional</option>
          </select>
        </div>
        {!personal && (
          <div class="col-md-12 col-lg-3">
            <label class="form-label small mb-1">BCC batch size</label>
            <input
              class="form-control form-control-sm"
              type="number"
              min={1}
              max={500}
              value={batchSize}
              onInput={(e) => setBatchSize(parseInt((e.target as HTMLInputElement).value) || 500)}
            />
          </div>
        )}
      </div>

      {/* Subject */}
      <div class="mb-2">
        <label class="form-label small mb-1">Subject</label>
        <input
          class="form-control form-control-sm"
          type="text"
          placeholder="Email subject"
          value={subject}
          onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Body + variables sidebar */}
      <div class="row g-2 mb-2">
        <div class="col-md-8">
          <label class="form-label small mb-1">
            Message <span class="text-muted fw-normal">(Markdown, {"{{variables}}"})</span>
          </label>
          <div class="adm-email-editor-wrap">
            <pre ref={bodyPreRef} aria-hidden="true" class="adm-email-backdrop" />
            <textarea
              ref={bodyTextareaRef}
              class="form-control font-monospace adm-email-body-input"
              rows={14}
              placeholder="Write your message here, or load a template above."
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              onScroll={handleBodyScroll}
            />
          </div>
        </div>
        <div class="col-md-4">
          <div class="card border-0 bg-light h-100 p-2">
            {HELPER_CATEGORIES.map((category) => {
              const items = TEMPLATE_HELPERS.filter((item) => item.category === category && isHelperVisible(item));
              if (items.length === 0) return null;
              return (
                <div key={category} class="mb-3">
                  <div class="small fw-semibold mb-1">{category}</div>
                  <div class="d-flex gap-1 flex-wrap">
                    {items.map((item) => (
                      <SnippetBtn
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
            <div class="small fw-semibold mb-1">Partials</div>
            <div class="d-flex gap-1 flex-wrap mb-2">
              {TEMPLATE_PARTIALS.filter((partial) => availablePartials.has(partial.name)).map((partial) => (
                <SnippetBtn
                  key={partial.name}
                  snippet={`{{> ${partial.name}}}`}
                  label={partial.name}
                  personal={personal}
                  personalOnly={partial.name === "reg_details"}
                  onInsert={insertSnippet}
                />
              ))}
            </div>
            {!personal && (
              <div class="small text-muted mt-1">Recipient-specific tags are disabled in Broadcast BCC mode.</div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      {audience === "attendees" ? (
        <div class="row g-2 mb-2">
          <div class="col-md-3">
            <label class="form-label small mb-1">Registration status</label>
            <select
              class="form-select form-select-sm"
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
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-1">Attendance type</label>
            <select
              class="form-select form-select-sm"
              value={attendanceType}
              onChange={(e) => setAttendanceType((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All types</option>
              <option value="in_person">In-person</option>
              <option value="virtual">Virtual</option>
              <option value="on_demand">On-demand</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-1">Specific day</label>
            <select
              class="form-select form-select-sm"
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
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-1">Day waitlist</label>
            <select
              class="form-select form-select-sm"
              value={dayWaitlistStatus}
              onChange={(e) => setDayWaitlistStatus((e.target as HTMLSelectElement).value)}
            >
              <option value="all">Any state</option>
              <option value="active">Active waitlist</option>
              <option value="waiting">Waiting</option>
              <option value="offered">Offer sent</option>
              <option value="accepted">Accepted offer</option>
              <option value="none">Not waitlisted</option>
            </select>
          </div>
        </div>
      ) : (
        <div class="row g-2 mb-2">
          <div class="col-md-4">
            <label class="form-label small mb-1">Speaker status</label>
            <select
              class="form-select form-select-sm"
              value={speakerStatus}
              onChange={(e) => setSpeakerStatus((e.target as HTMLSelectElement).value)}
            >
              <option value="confirmed">Confirmed</option>
              <option value="all">All active</option>
              <option value="invited">Invited</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
        <button type="button" class="btn btn-sm btn-outline-primary" onClick={() => void handlePreview()}>
          Preview Email
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onClick={() => void handleSend()}
          disabled={sending || !previewConfirmed}
        >
          Send Email
        </button>
        <span class="small text-muted">{status}</span>
      </div>

      {/* Preview panel */}
      {preview && (
        <div class="card border">
          <div class="card-header bg-light small fw-semibold">Email Preview</div>
          <div class="card-body">
            <div class="small text-muted">Subject</div>
            <div class="fw-semibold mb-2">{preview.subject}</div>
            {preview.recipientCount != null && (
              <div class="small text-muted mb-1">{preview.recipientCount} recipients</div>
            )}
            <Tabs
              items={EMAIL_PREVIEW_TABS}
              active={previewTab}
              onChange={(key) => setPreviewTab(key as EmailPreviewTab)}
              className="mb-2"
            />
            {previewTab === "html" && <iframe srcdoc={preview.html} sandbox="" class="adm-email-preview-frame" />}
            {previewTab === "text" && <pre class="json-out adm-email-preview-text">{preview.text}</pre>}
            <div class="form-check mt-2">
              <input
                class="form-check-input"
                type="checkbox"
                id="em-confirm"
                checked={previewConfirmed}
                onChange={(e) => setPreviewConfirmed((e.target as HTMLInputElement).checked)}
              />
              <label class="form-check-label small" for="em-confirm">
                I reviewed this email preview and confirm sending.
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
