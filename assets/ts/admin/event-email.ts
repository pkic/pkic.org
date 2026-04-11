import { esc, hide, q, show, toast } from "./ui";
import type { ApiFn } from "./types";
import type { EmailTemplateVersion } from "./email-templates";

export function createEmailSection(api: ApiFn): {
  emailTabHtml: (ns: string) => string;
  wireEmailTab: (slug: string, ns: string, audience: "attendees" | "speakers") => Promise<void>;
} {
  const _emailPreviewTokens = new Map<string, string | null>();

  function emailTabHtml(ns: string): string {
    const e = (s: string) => `${ns}-em-${s}`;
    return (
      `<div id="${e("wrap")}">` +
        `<div class="row g-2 mb-2">` +
          `<div class="col-md-6"><label class="form-label small mb-1" for="${e("template")}">Template</label>` +
            `<select class="form-select form-select-sm" id="${e("template")}"><option value="">— write from scratch —</option></select></div>` +
          `<div class="col-md-3"><label class="form-label small mb-1" for="${e("mode")}">Delivery mode</label>` +
            `<select class="form-select form-select-sm" id="${e("mode")}"><option value="personal">Personal (1:1)</option><option value="bcc_batch">Broadcast BCC</option></select></div>` +
          `<div class="col-md-3 d-none" id="${e("batch-size-wrap")}"><label class="form-label small mb-1">BCC batch size</label>` +
            `<input class="form-control form-control-sm" id="${e("batch-size")}" type="number" min="1" max="500" value="500"></div>` +
        `</div>` +
        `<div class="mb-2"><label class="form-label small mb-1" for="${e("subject")}">Subject</label>` +
          `<input class="form-control form-control-sm" id="${e("subject")}" type="text" placeholder="Email subject"></div>` +
        `<div class="row g-2 mb-2">` +
          `<div class="col-md-8">` +
            `<label class="form-label small mb-1" for="${e("body")}">Message <span class="text-muted fw-normal">(Markdown, {{variables}})</span></label>` +
            `<div style="position:relative">` +
              `<pre id="${e("body-src")}" aria-hidden="true" style="position:absolute;inset:0;margin:0;padding:.375rem .75rem;font-size:.8rem;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace;line-height:1.5;white-space:pre-wrap;word-break:break-all;overflow:hidden;border:none;border-radius:.375rem;background:#fff;pointer-events:none;color:#212529"></pre>` +
              `<textarea class="form-control font-monospace" id="${e("body")}" rows="14" style="position:relative;z-index:1;background:transparent;color:transparent;caret-color:#212529;font-size:.8rem;resize:vertical" placeholder="Write your message here, or load a template above."></textarea>` +
            `</div>` +
          `</div>` +
          `<div class="col-md-4">` +
            `<div class="card border-0 bg-light h-100 p-2">` +
              `<div class="small fw-semibold mb-1">Variables</div>` +
              `<div class="d-flex gap-1 flex-wrap mb-3">` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{firstName}}" data-em-target="body" data-em-personal-only="1">firstName</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{lastName}}" data-em-target="body" data-em-personal-only="1">lastName</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{eventName}}" data-em-target="subject">eventName</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{eventUrl}}" data-em-target="body">eventUrl</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{proposalTitle}}" data-em-target="body" data-em-personal-only="1">proposalTitle</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{registrationUrl}}" data-em-target="body">registrationUrl</button>` +
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{proposalUrl}}" data-em-target="body">proposalUrl</button>` +
              `</div>` +
              `<div class="small fw-semibold mb-1">Custom Fields</div>` +
              `<div class="small text-muted mb-1">Active form fields for this event are available as {{field_key}}.</div>` +
              `<div class="d-flex gap-1 flex-wrap mb-3" id="${e("custom-fields")}"></div>` +
              `<div class="small fw-semibold mb-1">Partials</div>` +
              `<div class="small text-muted mb-1">Include shared email sections.</div>` +
              `<div class="d-flex gap-1 flex-wrap">` +
                `<button type="button" class="btn btn-sm btn-outline-info" data-em-snippet="{{> reg_details}}" data-em-target="body" data-em-personal-only="1">reg_details</button>` +
                `<button type="button" class="btn btn-sm btn-outline-info" data-em-snippet="{{> sponsors_block}}" data-em-target="body">sponsors_block</button>` +
                `<button type="button" class="btn btn-sm btn-outline-info" data-em-snippet="{{> about_pkic}}" data-em-target="body">about_pkic</button>` +
              `</div>` +
              `<div class="small text-muted mt-2 d-none" id="${e("broadcast-note")}">Recipient-specific tags are disabled in Broadcast BCC mode.</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="row g-2 mb-2" id="${e("attendee-filters")}">` +
          `<div class="col-md-4"><label class="form-label small mb-1">Registration status</label>` +
            `<select class="form-select form-select-sm" id="${e("attendee-status")}"><option value="registered">Registered</option><option value="all">All</option><option value="pending_email_confirmation">Pending confirmation</option><option value="waitlisted">Waitlisted</option><option value="cancelled">Cancelled</option></select></div>` +
          `<div class="col-md-4"><label class="form-label small mb-1">Attendance type</label>` +
            `<select class="form-select form-select-sm" id="${e("attendance")}"><option value="all">All types</option><option value="in_person">In-person</option><option value="virtual">Virtual</option><option value="on_demand">On-demand</option></select></div>` +
          `<div class="col-md-4"><label class="form-label small mb-1">Specific day</label>` +
            `<select class="form-select form-select-sm" id="${e("day")}"><option value="">All days</option></select></div>` +
        `</div>` +
        `<div class="row g-2 mb-2 d-none" id="${e("speaker-filters")}">` +
          `<div class="col-md-4"><label class="form-label small mb-1">Speaker status</label>` +
            `<select class="form-select form-select-sm" id="${e("speaker-status")}"><option value="confirmed">Confirmed</option><option value="all">All active</option><option value="invited">Invited</option><option value="pending">Pending</option></select></div>` +
        `</div>` +
        `<div class="d-flex gap-2 align-items-center flex-wrap mb-2">` +
          `<button type="button" class="btn btn-sm btn-outline-primary" id="${e("preview-btn")}">Preview Email</button>` +
          `<button type="button" class="btn btn-sm btn-primary" id="${e("send-btn")}" disabled>Send Email</button>` +
          `<span class="small text-muted" id="${e("status")}">Preview required before sending.</span>` +
        `</div>` +
        `<div id="${e("preview-panel")}" class="d-none">` +
          `<div class="card border"><div class="card-header bg-light small fw-semibold">Email Preview</div><div class="card-body">` +
            `<div class="small text-muted">Subject</div><div id="${e("preview-subject")}" class="fw-semibold mb-2"></div>` +
            `<div class="small text-muted mb-1" id="${e("preview-meta")}"></div>` +
            `<ul class="nav nav-tabs mb-2" role="tablist">` +
              `<li class="nav-item"><button class="nav-link active" id="${e("prev-tab-html")}" type="button">HTML</button></li>` +
              `<li class="nav-item"><button class="nav-link" id="${e("prev-tab-text")}" type="button">Text</button></li>` +
            `</ul>` +
            `<div id="${e("prev-html-wrap")}"><iframe id="${e("preview-html")}" style="width:100%;height:300px;border:1px solid #dee2e6;border-radius:.375rem;background:#fff"></iframe></div>` +
            `<pre id="${e("preview-text")}" class="json-out d-none" style="height:300px"></pre>` +
            `<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="${e("confirm")}"><label class="form-check-label small" for="${e("confirm")}">I reviewed this email preview and confirm sending.</label></div>` +
          `</div></div>` +
        `</div>` +
      `</div>`
    );
  }

  function setEmailPreviewTab(ns: string, tab: "html" | "text"): void {
    const e = (s: string) => `#${ns}-em-${s}`;
    const htmlBtn = q<HTMLButtonElement>(e("prev-tab-html"));
    const textBtn = q<HTMLButtonElement>(e("prev-tab-text"));
    const htmlWrap = q(e("prev-html-wrap"));
    const textWrap = q(e("preview-text"));
    if (tab === "html") {
      htmlBtn?.classList.add("active");
      textBtn?.classList.remove("active");
      show(htmlWrap);
      hide(textWrap);
    } else {
      textBtn?.classList.add("active");
      htmlBtn?.classList.remove("active");
      hide(htmlWrap);
      show(textWrap);
    }
  }

  function escEmailHighlight(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/({{[^}]*}})/g, '<mark style="background-color:rgba(255,165,0,.2);border-radius:2px;padding:0 1px">$1</mark>');
  }

  function readEmailPayload(
    ns: string,
    audience: "attendees" | "speakers",
  ): {
    templateKey?: string;
    subjectOverride?: string;
    bodyContent?: string;
    sendMode: "personal" | "bcc_batch";
    batchSize: number;
    filter: {
      audience: "attendees" | "speakers";
      attendeeStatus?: "all" | "registered" | "pending_email_confirmation" | "waitlisted" | "cancelled";
      attendanceType?: "all" | "in_person" | "virtual" | "on_demand";
      dayDate?: string;
      speakerStatus?: "all" | "confirmed" | "invited" | "pending";
    };
  } {
    const r = (id: string) => `#${ns}-em-${id}`;
    const templateKeyRaw = (q<HTMLSelectElement>(r("template"))?.value ?? "").trim();
    const subjectOverrideRaw = (q<HTMLInputElement>(r("subject"))?.value ?? "").trim();
    const bodyContentRaw = (q<HTMLTextAreaElement>(r("body"))?.value ?? "").trim();
    const sendMode = (q<HTMLSelectElement>(r("mode"))?.value ?? "personal") as "personal" | "bcc_batch";
    const batchSize = parseInt(q<HTMLInputElement>(r("batch-size"))?.value ?? "500", 10) || 500;
    return {
      templateKey: templateKeyRaw || undefined,
      subjectOverride: subjectOverrideRaw || undefined,
      bodyContent: bodyContentRaw || undefined,
      sendMode,
      batchSize,
      filter: {
        audience,
        attendeeStatus: audience === "attendees"
          ? ((q<HTMLSelectElement>(r("attendee-status"))?.value ?? "registered") as "all" | "registered" | "pending_email_confirmation" | "waitlisted" | "cancelled")
          : undefined,
        attendanceType: audience === "attendees"
          ? ((q<HTMLSelectElement>(r("attendance"))?.value ?? "all") as "all" | "in_person" | "virtual" | "on_demand")
          : undefined,
        dayDate: audience === "attendees" ? (q<HTMLSelectElement>(r("day"))?.value?.trim() || undefined) : undefined,
        speakerStatus: audience === "speakers"
          ? ((q<HTMLSelectElement>(r("speaker-status"))?.value ?? "confirmed") as "all" | "confirmed" | "invited" | "pending")
          : undefined,
      },
    };
  }

  function invalidateEmailPreview(ns: string, message = "Preview required before sending."): void {
    _emailPreviewTokens.set(ns, null);
    const r = (id: string) => `#${ns}-em-${id}`;
    const sendBtn = q<HTMLButtonElement>(r("send-btn"));
    if (sendBtn) sendBtn.disabled = true;

    const confirm = q<HTMLInputElement>(r("confirm"));
    if (confirm) confirm.checked = false;

    hide(q(r("preview-panel")));

    const statusEl = q(r("status"));
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = "small text-muted";
    }
  }

  async function wireEmailTab(slug: string, ns: string, audience: "attendees" | "speakers"): Promise<void> {
    const r = (id: string) => `#${ns}-em-${id}`;
    const wrap = q<HTMLElement>(`#${ns}-em-wrap`);
    if (!wrap || wrap.dataset.wired === "1") return;
    wrap.dataset.wired = "1";

    const isAttendees = audience === "attendees";
    q(r("attendee-filters"))?.classList.toggle("d-none", !isAttendees);
    q(r("speaker-filters"))?.classList.toggle("d-none", isAttendees);

    const templateSelect = q<HTMLSelectElement>(r("template"));
    const daySelect = q<HTMLSelectElement>(r("day"));
    const modeSelect = q<HTMLSelectElement>(r("mode"));
    const customFieldsEl = q<HTMLElement>(r("custom-fields"));
    const broadcastNoteEl = q<HTMLElement>(r("broadcast-note"));
    if (!templateSelect || !daySelect || !modeSelect) return;

    const templatesByKey = new Map<string, EmailTemplateVersion>();

    try {
      const [templatesRes, daysRes, formRes] = await Promise.all([
        api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates"),
        api<{ days: Array<{ date: string; label: string | null }> }>(`/api/v1/admin/events/${slug}/days`),
        api<{ form: { fields?: Array<{ key: string; label: string }> } | null }>(`/api/v1/events/${slug}/forms?purpose=${audience === "attendees" ? "event_registration" : "proposal_submission"}`),
      ]);

      const allMsgTemplates = (templatesRes.templates ?? []).filter((t) => t.template_key.startsWith("msg_"));
      for (const tmpl of allMsgTemplates) {
        const existing = templatesByKey.get(tmpl.template_key);
        if (!existing || tmpl.status === "active" || tmpl.version > existing.version) {
          templatesByKey.set(tmpl.template_key, tmpl);
        }
      }

      const keys = Array.from(templatesByKey.keys()).sort();
      templateSelect.innerHTML = keys.length
        ? '<option value="">— write from scratch —</option>' + keys.map((key) => `<option value="${esc(key)}">${esc(key)}</option>`).join("")
        : '<option value="">No msg_ templates found</option>';

      if (isAttendees) {
        const dayOptions = (daysRes.days ?? []).map((day) => ({
          value: day.date,
          label: day.label ? `${day.date} (${day.label})` : day.date,
        }));
        daySelect.innerHTML = '<option value="">All days</option>' + dayOptions.map((d) => `<option value="${esc(d.value)}">${esc(d.label)}</option>`).join("");
      }

      if (customFieldsEl) {
        const fields = formRes.form?.fields ?? [];
        customFieldsEl.innerHTML = fields.length
          ? fields.map((field) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-em-snippet="{{${esc(field.key)}}}" data-em-target="body" data-em-personal-only="1" title="${esc(field.label ?? field.key)}">${esc(field.key)}</button>`).join("")
          : '<span class="small text-muted">No active custom fields.</span>';
      }
    } catch (err) {
      toast((err as Error).message, "error");
    }

    const bodyEl = q<HTMLTextAreaElement>(r("body"));
    const bodySrcEl = q<HTMLElement>(r("body-src"));

    const syncBodyHighlight = (): void => {
      if (!bodyEl || !bodySrcEl) return;
      bodySrcEl.innerHTML = escEmailHighlight(bodyEl.value);
      bodySrcEl.scrollTop = bodyEl.scrollTop;
    };

    const loadTemplateContent = (): void => {
      const tmpl = templatesByKey.get(templateSelect.value);
      if (!tmpl) return;
      const subject = q<HTMLInputElement>(r("subject"));
      if (subject && tmpl.subject_template) subject.value = tmpl.subject_template;
      if (bodyEl && tmpl.body != null) { bodyEl.value = tmpl.body; syncBodyHighlight(); }
      invalidateEmailPreview(ns);
    };

    const syncModeControls = (): void => {
      const isBroadcast = modeSelect.value === "bcc_batch";
      q(r("batch-size-wrap"))?.classList.toggle("d-none", !isBroadcast);
      broadcastNoteEl?.classList.toggle("d-none", !isBroadcast);
      wrap.querySelectorAll<HTMLButtonElement>("[data-em-personal-only='1']").forEach((btn) => {
        if (!btn.dataset.emOriginalTitle) btn.dataset.emOriginalTitle = btn.title;
        btn.disabled = isBroadcast;
        btn.classList.toggle("disabled", isBroadcast);
        btn.title = isBroadcast ? "Recipient-specific tags are only available in Personal (1:1) mode." : (btn.dataset.emOriginalTitle ?? "");
      });
    };

    const insertSnippet = (snippet: string, target: "subject" | "body"): void => {
      const field: HTMLInputElement | HTMLTextAreaElement | null = target === "subject"
        ? q<HTMLInputElement>(r("subject"))
        : bodyEl;
      if (!field) return;
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      field.value = `${field.value.slice(0, start)}${snippet}${field.value.slice(end)}`;
      const nextPos = start + snippet.length;
      field.focus();
      field.setSelectionRange(nextPos, nextPos);
      if (target === "body") syncBodyHighlight();
      invalidateEmailPreview(ns);
    };

    wrap.addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-em-snippet]");
      if (!btn) return;
      const snippet = btn.dataset.emSnippet ?? "";
      const target = btn.dataset.emTarget === "subject" ? "subject" : "body";
      insertSnippet(snippet, target);
    });

    bodyEl?.addEventListener("scroll", () => {
      if (bodySrcEl && bodyEl) { bodySrcEl.scrollTop = bodyEl.scrollTop; bodySrcEl.scrollLeft = bodyEl.scrollLeft; }
    });

    [r("template"), r("mode"), r("batch-size"), r("attendee-status"), r("attendance"), r("day"), r("speaker-status"), r("subject"), r("body")].forEach((sel) =>
      q(sel)?.addEventListener("input", () => { syncBodyHighlight(); invalidateEmailPreview(ns); }),
    );

    [r("template"), r("mode"), r("attendee-status"), r("attendance"), r("day"), r("speaker-status")].forEach((sel) =>
      q(sel)?.addEventListener("change", () => { syncModeControls(); invalidateEmailPreview(ns); }),
    );

    templateSelect.addEventListener("change", () => loadTemplateContent());

    q<HTMLInputElement>(r("confirm"))?.addEventListener("change", (event) => {
      const sendBtn = q<HTMLButtonElement>(r("send-btn"));
      if (!sendBtn) return;
      sendBtn.disabled = !(event.target as HTMLInputElement).checked || !_emailPreviewTokens.get(ns);
    });

    q(r("prev-tab-html"))?.addEventListener("click", () => setEmailPreviewTab(ns, "html"));
    q(r("prev-tab-text"))?.addEventListener("click", () => setEmailPreviewTab(ns, "text"));

    q(r("preview-btn"))?.addEventListener("click", () => void doEmailPreview(slug, ns, audience));
    q(r("send-btn"))?.addEventListener("click", () => void doEmailSend(slug, ns, audience));

    syncModeControls();
    syncBodyHighlight();
    invalidateEmailPreview(ns);
  }

  async function doEmailPreview(slug: string, ns: string, audience: "attendees" | "speakers"): Promise<void> {
    const r = (id: string) => `#${ns}-em-${id}`;
    const payload = readEmailPayload(ns, audience);
    const statusEl = q(r("status"));
    const btn = q<HTMLButtonElement>(r("preview-btn"));
    const sendBtn = q<HTMLButtonElement>(r("send-btn"));

    if (!payload.bodyContent && !payload.templateKey) {
      if (statusEl) {
        statusEl.textContent = "Add a message body or select a template first.";
        statusEl.className = "small text-danger";
      }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Rendering..."; }
    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) { statusEl.textContent = "Rendering email preview..."; statusEl.className = "small text-muted"; }

    try {
      const result = await api<{
        previewToken: string;
        previewExpiresAt: string;
        recipientCount: number;
        batchCount: number;
        sampleRecipients: string[];
        subject: string;
        html: string;
        text: string;
      }>(`/api/v1/admin/events/${slug}/emails/campaign/preview`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      _emailPreviewTokens.set(ns, result.previewToken);

      const subjectEl = q(r("preview-subject"));
      const metaEl = q(r("preview-meta"));
      const iframe = q<HTMLIFrameElement>(r("preview-html"));
      const textEl = q<HTMLElement>(r("preview-text"));
      const confirm = q<HTMLInputElement>(r("confirm"));

      if (confirm) confirm.checked = false;
      if (subjectEl) subjectEl.textContent = result.subject;
      if (metaEl) {
        const sample = result.sampleRecipients.slice(0, 5).join(", ");
        metaEl.textContent = `Recipients: ${result.recipientCount}, batches: ${result.batchCount}${sample ? `, sample: ${sample}` : ""}`;
      }
      if (iframe) iframe.srcdoc = result.html;
      if (textEl) textEl.textContent = result.text;

      setEmailPreviewTab(ns, "html");
      show(q(r("preview-panel")));

      if (statusEl) {
        const expiresAt = new Date(result.previewExpiresAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
        statusEl.textContent = `Preview ready. Confirm to send. Expires at ${expiresAt}.`;
        statusEl.className = "small text-success";
      }
    } catch (err) {
      _emailPreviewTokens.set(ns, null);
      hide(q(r("preview-panel")));
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
      toast((err as Error).message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Preview Email"; }
    }
  }

  async function doEmailSend(slug: string, ns: string, audience: "attendees" | "speakers"): Promise<void> {
    const r = (id: string) => `#${ns}-em-${id}`;
    const payload = readEmailPayload(ns, audience);
    const statusEl = q(r("status"));
    const sendBtn = q<HTMLButtonElement>(r("send-btn"));
    const confirm = q<HTMLInputElement>(r("confirm"));
    const token = _emailPreviewTokens.get(ns) ?? null;

    if (!token) {
      if (statusEl) { statusEl.textContent = "Preview email before sending."; statusEl.className = "small text-danger"; }
      return;
    }

    if (!confirm?.checked) {
      if (statusEl) { statusEl.textContent = "Confirm preview before sending."; statusEl.className = "small text-danger"; }
      return;
    }

    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Queueing..."; }

    try {
      const result = await api<{ queuedRecipients: number; queuedBatches: number }>(`/api/v1/admin/events/${slug}/emails/campaign/send`, {
        method: "POST",
        body: JSON.stringify({ ...payload, previewToken: token }),
      });

      if (statusEl) { statusEl.textContent = `Queued ${result.queuedRecipients} recipients in ${result.queuedBatches} batch(es).`; statusEl.className = "small text-success"; }
      toast(`Sent to ${result.queuedRecipients} recipients`, "success");
      invalidateEmailPreview(ns, "Email sent. Render a new preview for the next send.");
    } catch (err) {
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
      toast((err as Error).message, "error");
    } finally {
      if (sendBtn) { sendBtn.textContent = "Send Email"; sendBtn.disabled = !confirm?.checked || !_emailPreviewTokens.get(ns); }
    }
  }


  return { emailTabHtml, wireEmailTab };
}
