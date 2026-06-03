import { useState, useEffect, useRef } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import {
  TEMPLATE_HELPERS,
  TEMPLATE_PARTIALS,
  type TemplateHelperCategory,
  type TemplateHelperItem,
} from "../../../email-template-helpers";
import { toast } from "../../../ui";
import type { EmailTemplateVersion } from "../../../types";

const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];
const PERSONAL_ONLY_HELPERS = new Set([
  "firstName",
  "lastName",
  "email",
  "organizationName",
  "jobTitle",
  "status",
  "statusLabel",
  "attendanceType",
  "attendanceLabel",
  "manageUrl",
  "proposalTitle",
  "proposalAbstract",
  "speakerStatus",
  "acceptedTermsText",
  "if firstName",
  "if eq status",
  "if acceptedTermsText",
  "each customAnswerRows",
  "each dayAttendance",
]);

// ─── Highlight helpers ────────────────────────────────────────────────────────

function highlightBody(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/({{[^}]*}})/g, '<mark class="adm-template-token-mark">$1</mark>');
}

// ─── Variable snippet button ──────────────────────────────────────────────────

function SnippetBtn({
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
  onInsert: (s: string) => void;
}) {
  const disabled = personalOnly && !personal;
  return (
    <button
      type="button"
      class={`btn btn-sm btn-outline-secondary${disabled ? " adm-snippet-disabled" : ""}`}
      title={disabled ? "Only available in Personal mode" : snippet}
      onClick={() => !disabled && onInsert(snippet)}
    >
      {label}
    </button>
  );
}

// ─── Template selector ────────────────────────────────────────────────────────

interface TemplateOption {
  key: string;
  label: string;
}

interface CampaignPayload {
  templateKey?: string;
  subjectOverride: string;
  bodyContent: string;
  messageType?: "transactional" | "promotional";
  sendMode: "personal" | "bcc_batch";
  batchSize: number;
  filter: {
    audience: "attendees" | "speakers";
    attendeeStatus?: "all" | "registered" | "pending_email_confirmation" | "waitlisted" | "cancelled";
    attendanceType?: "all" | "in_person" | "virtual" | "on_demand";
    dayDate?: string;
    speakerStatus?: "all" | "confirmed" | "invited" | "pending";
  };
  previewToken?: string;
}

function useTemplates(): { templates: TemplateOption[]; loading: boolean } {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ templates: Array<{ template_key: string }> }>("/api/v1/admin/email-templates")
      .then((d) => {
        const opts: TemplateOption[] = (d.templates ?? [])
          .filter((t) => t.template_key.startsWith("msg_"))
          .map((t) => ({ key: t.template_key, label: t.template_key }));
        setTemplates(opts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { templates, loading };
}

// ─── Day selector helper ──────────────────────────────────────────────────────

function useDays(slug: string) {
  const [days, setDays] = useState<Array<{ day_date?: string; date?: string; label?: string | null }>>([]);
  useEffect(() => {
    api<{ days: Array<{ day_date?: string; date?: string; label?: string | null }> }>(
      `/api/v1/admin/events/${slug}/days`,
    )
      .then((d) => setDays(d.days ?? []))
      .catch(() => {});
  }, [slug]);
  return days;
}

function availableHelperLabelsForAudience(audience: "attendees" | "speakers"): Set<string> {
  if (audience === "attendees") {
    return new Set([
      "eventName",
      "eventUrl",
      "eventTimezone",
      "firstName",
      "lastName",
      "email",
      "organizationName",
      "jobTitle",
      "status",
      "statusLabel",
      "attendanceType",
      "attendanceLabel",
      "manageUrl",
      "registrationUrl",
      "if firstName",
      "if eq status",
      "else block",
      "unless",
      "each customAnswerRows",
      "CTA button",
    ]);
  }

  return new Set([
    "eventName",
    "eventUrl",
    "eventTimezone",
    "firstName",
    "lastName",
    "email",
    "organizationName",
    "jobTitle",
    "proposalTitle",
    "proposalAbstract",
    "speakerStatus",
    "proposalUrl",
    "if firstName",
    "else block",
    "unless",
    "each customAnswerRows",
    "CTA button",
  ]);
}

function availablePartialsForAudience(audience: "attendees" | "speakers"): Set<string> {
  return audience === "attendees"
    ? new Set(["reg_details", "sponsors_block", "about_pkic", "donation_request"])
    : new Set(["sponsors_block", "about_pkic", "donation_request"]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EventEmail({
  slug,
  audience: defaultAudience = "attendees",
}: {
  slug: string;
  audience?: "attendees" | "speakers";
}) {
  const { templates, loading: templatesLoading } = useTemplates();
  const days = useDays(slug);

  const [templateKey, setTemplateKey] = useState("");
  const [mode, setMode] = useState<"personal" | "bcc_batch">("personal");
  const [messageType, setMessageType] = useState<"transactional" | "promotional">("promotional");
  const [batchSize, setBatchSize] = useState(500);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience] = useState<"attendees" | "speakers">(defaultAudience);

  // attendee filters
  const [attendeeStatus, setAttendeeStatus] = useState("registered");
  const [attendanceType, setAttendanceType] = useState("all");
  const [dayFilter, setDayFilter] = useState("");

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
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
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
      const data = await api<{ versions: EmailTemplateVersion[] }>(
        `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
      );
      if (templateRequestIdRef.current !== requestId) {
        return;
      }
      const active = data.versions.find((version) => version.status === "active");
      const version = active ?? data.versions[0];
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
      const res = await api<{
        subject: string;
        html: string;
        text: string;
        recipientCount?: number;
        previewToken?: string;
      }>(`/api/v1/admin/events/${slug}/emails/campaign/preview`, {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
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
      const res = await api<{ queuedRecipients?: number; queuedBatches?: number }>(
        `/api/v1/admin/events/${slug}/emails/campaign/send`,
        {
          method: "POST",
          body: JSON.stringify(buildPayload(preview.previewToken)),
        },
      );
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
          <label class="form-label small mb-1">Template</label>
          <select
            class="form-select form-select-sm"
            value={templateKey}
            onChange={(e) => void handleTemplateChange((e.target as HTMLSelectElement).value)}
            disabled={templatesLoading}
          >
            <option value="">— write from scratch —</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key}
              </option>
            ))}
          </select>
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
            onChange={(e) => setMessageType((e.target as HTMLSelectElement).value as "transactional" | "promotional")}
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
          <div class="col-md-4">
            <label class="form-label small mb-1">Registration status</label>
            <select
              class="form-select form-select-sm"
              value={attendeeStatus}
              onChange={(e) => setAttendeeStatus((e.target as HTMLSelectElement).value)}
            >
              <option value="registered">Registered</option>
              <option value="all">All</option>
              <option value="pending_email_confirmation">Pending confirmation</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div class="col-md-4">
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
          <div class="col-md-4">
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
              items={[
                { key: "html", label: "HTML" },
                { key: "text", label: "Text" },
              ]}
              active={previewTab}
              onChange={(key) => setPreviewTab(key as "html" | "text")}
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
