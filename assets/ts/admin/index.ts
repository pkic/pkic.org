/**
 * Admin console SPA — compiled by Hugo's esbuild pipeline (assets/ts/admin.ts).
 * Loaded via {{ partial "script.html" }} to satisfy CSP script-src 'self'.
 * All event handlers are wired via addEventListener — no inline onclick attributes.
 */

// ── Type declarations ──────────────────────────────────────────────────────────

interface ApiOpts extends RequestInit {
  headers?: Record<string, string>;
}

interface EventSummary {
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  registration_mode: string;
  invite_limit_attendee: number;
  confirmed_registrations: number;
  total_registrations: number;
  pending_invites: number;
}

interface EventDetail extends EventSummary {
  id: string;
  base_path: string | null;
  user_retention_days: number | null;
  venue: string | null;
  virtual_url: string | null;
  hero_image_url: string | null;
  location: string | null;
  session_types: string[] | null;
  settings: Record<string, unknown>;
}

interface AdminEventTerm {
  id: string;
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}

interface AdminAttendanceOption {
  value: string;
  label: string;
  capacity?: number | null;
}

interface AdminEventDay {
  id: string;
  date: string;
  label: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  attendanceOptions: AdminAttendanceOption[];
  attendanceCounts: Record<string, number>;
}

function timeInZone(iso: string | null | undefined, timeZone: string | null | undefined): string {
  if (!iso || !timeZone) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

interface AdminEventFormSummary {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  field_count: number;
  submission_count: number;
}

interface AdminFormDetailField {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  sortOrder: number;
}

interface AdminFormSubmission {
  id: string;
  status: string;
  submittedAt: string;
  contextType: string | null;
  contextRef: string | null;
  submitter: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
  } | null;
  answers: Record<string, unknown>;
}

interface EventPermission {
  id: string;
  user_email: string;
  user_id: string | null;
  permission: string;
  granted_by_id: string;
  created_at: string;
  granter_email: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
}

interface Registration {
  id: string;
  user_id: string;
  user_email?: string;
  display_name?: string;
  status: string;
  attendance_type?: string;
  source_type?: string;
  created_at: string;
  referral_code?: string | null;
  dayAttendance?: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist?: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
  dayWaitlistSummary?: string | null;
  dayWaitlistCount?: number;
}

interface AdminRegistrationDay {
  dayDate: string;
  label: string | null;
}

interface ProposalSummary {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  submitted_at: string;
  updated_at: string;
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  decision_status: string | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

interface ProposalReview {
  id: string;
  reviewer_user_id: string;
  recommendation: "accept" | "reject" | "needs-work";
  score: number | null;
  reviewer_comment: string | null;
  applicant_note: string | null;
  updated_at: string;
  reviewer_email?: string;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
}

interface ProposalSpeaker {
  userId: string;
  role: string;
  status: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  hasHeadshot: boolean;
  hasBio: boolean;
}

interface ProposalAccess {
  eventPermissions: string[];
  canReview: boolean;
  canFinalize: boolean;
}

interface BadgeRoleInfo {
  admin_override: string | null;
  auto_detected: string;
  effective_role: string;
  available_roles: string[];
}

interface DonationPeriod {
  count: number;
  completed: number;
  pending: number;
  failed: number;
  expired: number;
  gross: number;
}

interface StatsResponse {
  registrations: {
    byStatus: Record<string, number>;
    total: number;
    weekly: Array<{ week: string; count: number }>;
    monthly: Array<{ month: string; count: number }>;
  };
  invites: { byStatus: Record<string, number>; total: number };
  email: { outboxByStatus: Record<string, number>; totalQueued: number; totalFailed: number };
  topEvents: Array<{ slug: string; name: string; confirmed: number; total: number }>;
  recentActivity: Array<{ date: string; registrations: number; invites: number }>;
  donations: {
    byStatus: Record<string, number>;
    byCurrency: Array<{ status: string; currency: string; count: number; total_gross: number; avg_gross: number; total_net: number | null }>;
    daily: Array<{ date: string } & DonationPeriod>;
    weekly: Array<{ week: string } & DonationPeriod>;
    monthly: Array<{ month: string } & DonationPeriod>;
  };
}

interface AdminEmailOutboxRow {
  id: string;
  eventSlug: string | null;
  eventName: string | null;
  templateKey: string;
  templateVersion: number | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  messageType: "transactional" | "promotional";
  provider: string;
  providerMessageId: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "retrying";
  attempts: number;
  sendAfter: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  bccRecipientCount: number;
  hasCalendarInvite: boolean;
  hasBadgeAttachment: boolean;
  usesDirectBody: boolean;
  hasCustomText: boolean;
}

interface AdminEmailOutboxResponse {
  outbox: AdminEmailOutboxRow[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byMessageType: Record<string, number>;
    topTemplates: Array<{ template_key: string; count: number }>;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

interface AdminJobsRunResponse {
  dryRun: boolean;
  reminders: {
    processed: number;
    inviteRemindersQueued: number;
    speakerInviteRemindersQueued: number;
    presentationRemindersQueued: number;
    preview: {
      attendeeInvites: Array<{
        category: "attendee_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      speakerInvites: Array<{
        category: "speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      coSpeakerInvites: Array<{
        category: "co_speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      presentationUploads: Array<{
        category: "presentation_upload_request";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
    };
  };
  shouldRunRetention: boolean;
  retention: {
    redactedRegistrations: number;
    redactedUsers: number;
    affectedEvents: number;
    preview: {
      dueEvents: Array<{
        eventId: string;
        eventName: string;
        eventSlug: string;
        endsAt: string | null;
        retentionDays: number;
        eligibleRegistrations: number;
        eligibleUsers: number;
      }>;
      totalEvents: number;
      totalRegistrations: number;
      totalUsers: number;
    };
  };
  outbox: {
    processed: number;
    failed: number;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
}

type AdminReminderPreviewRow = {
  category: "attendee_invite" | "speaker_invite" | "co_speaker_invite" | "presentation_upload_request";
  templateKey: string;
  eventName: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string | null;
  proposalTitle: string | null;
  reminderNumber: number;
  dueAt: string | null;
  subject: string;
};

type AdminDueWorkTab = "all" | "outbox" | "reminders" | "cleanup";

interface AdminDueWorkRow {
  bucket: Exclude<AdminDueWorkTab, "all">;
  typeLabel: string;
  title: string;
  subtitle: string | null;
  context: string;
  detail: string | null;
  dueAt: string | null;
  statusKey: string;
  statusLabel: string;
}

interface InviteRecord {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: string;
  status: string;
  decline_reason_code: string | null;
  decline_reason_note: string | null;
  unsubscribe_future: number;
  source_type: string;
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  // inviter info (populated when invite was sent by a registered user)
  inviter_user_id: string | null;
  inviter_email: string | null;
  inviter_first_name: string | null;
  inviter_last_name: string | null;
}

interface PromoterEntry {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  invites_sent: number;
  invites_accepted: number;
  invites_declined: number;
  invites_expired: number;
  invite_conversion_rate: number | null;
  last_invite_at: string | null;
  referral_codes_issued: number;
  referral_clicks: number;
  referral_conversions: number;
  impact_score: number;
}

interface ReferralCodeEntry {
  code: string;
  owner_type: string;
  owner_id: string;
  effective_user_id: string | null;
  owner_email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  channel_hint: string | null;
  clicks: number;
  conversions: number;
  created_at: string;
}

interface PromotersResponse {
  eventSlug: string;
  promoters: PromoterEntry[];
  referralCodes: ReferralCodeEntry[];
  clickTimeline: Array<{ date: string; clicks: number }>;
}

interface AdminInviteEntry {
  email: string;
  firstName?: string;
  lastName?: string;
}

interface EmailTemplateVersion {
  id: string;
  template_key: string;
  version: number;
  subject_template: string | null;
  body: string | null;
  content_type: string;
  r2_object_key: string | null;
  checksum_sha256: string;
  status: "draft" | "active";
  created_by_user_id: string | null;
  created_at: string;
}

const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";

interface TemplateHelperItem {
  category: "Variables" | "Conditions" | "CTAs";
  label: string;
  snippet: string;
  target?: "subject" | "body";
}

// ── State ──────────────────────────────────────────────────────────────────────

let _token: string | null = null;
let _email: string | null = null;
let _evList: EventSummary[] = [];
let _currentEventDetail: EventDetail | null = null;
let _proposalAccessByEventSlug: Record<string, ProposalAccess> = {};
let _templateEditorFocus: "subject" | "body" = "body";
let _templateEditorKey: string | null = null;

const TEMPLATE_HELPERS: TemplateHelperItem[] = [
  { category: "Variables", label: "eventName", snippet: "{{eventName}}", target: "subject" },
  { category: "Variables", label: "firstName", snippet: "{{firstName}}" },
  { category: "Variables", label: "proposalTitle", snippet: "{{proposalTitle}}" },
  { category: "Variables", label: "deadline", snippet: "{{deadline}}" },
  { category: "Variables", label: "daysUntilExpiry", snippet: "{{daysUntilExpiry}}" },
  { category: "Variables", label: "daysUntilDeadline", snippet: "{{daysUntilDeadline}}" },
  { category: "Conditions", label: "isReminder", snippet: "{{#if isReminder}}\n\n{{/if}}" },
  { category: "Conditions", label: "if eq", snippet: "{{#if eq status \"accepted\"}}\n\n{{/if}}" },
  { category: "Conditions", label: "if lte", snippet: "{{#if lte daysUntilExpiry \"2\"}}\n\n{{/if}}" },
  { category: "Conditions", label: "else block", snippet: "{{#if isReminder}}\n\n{{else}}\n\n{{/if}}" },
  { category: "Conditions", label: "unless", snippet: "{{#unless hasHeadshot}}\n\n{{/unless}}" },
  { category: "Conditions", label: "each", snippet: "{{#each attendees}}\n- {{this}}\n{{/each}}" },
  { category: "CTAs", label: "CTA register", snippet: "<div class=\"cta\"><a href=\"{{registrationUrl}}\">Register now &rarr;</a></div>" },
  { category: "CTAs", label: "CTA proposal", snippet: "<div class=\"cta\"><a href=\"{{proposalUrl}}\">Submit a proposal &rarr;</a></div>" },
  { category: "CTAs", label: "CTA upload", snippet: "<div class=\"cta\"><a href=\"{{uploadUrl}}\">Upload my presentation &rarr;</a></div>" },
];

function loadAuth(): void {
  _token = localStorage.getItem("pkic_at");
  _email = localStorage.getItem("pkic_ae");
}

function saveAuth(t: string, e: string | null): void {
  _token = t;
  _email = e;
  localStorage.setItem("pkic_at", t);
  if (e) localStorage.setItem("pkic_ae", e);
}

function clearAuth(): void {
  _token = _email = null;
  localStorage.removeItem("pkic_at");
  localStorage.removeItem("pkic_ae");
}

// ── API ────────────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, opts?: ApiOpts): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers ?? {}) } });
  const data: { error?: { message?: string } } = res.status === 204
    ? {}
    : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      clearAuth();
      showLogin();
      throw Object.assign(new Error("Session expired — please sign in again."), { status: 401 });
    }
    throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  }
  return data as T;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function q<T extends Element = Element>(sel: string, ctx: ParentNode = document): T | null {
  return ctx.querySelector<T>(sel);
}

function show(el: Element | null): void { el?.classList.remove("d-none"); }
function hide(el: Element | null): void { el?.classList.add("d-none"); }

function toast(msg: string, type: "success" | "error" | "info" = "info"): void {
  const el = document.createElement("div");
  const cls = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  el.className = `my-toast alert ${cls}`;
  el.textContent = msg;
  q("#toast-area")?.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function spinner(): string {
  return '<div class="text-center py-4"><div class="spinner-border text-success" role="status"></div></div>';
}

function setButtonLoading(btn: HTMLButtonElement): void {
  btn.dataset.originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML =
    `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>` +
    (btn.textContent?.trim() ?? "");
}

function resetButton(btn: HTMLButtonElement): void {
  const original = btn.dataset.originalHtml;
  if (original !== undefined) {
    btn.innerHTML = original;
    delete btn.dataset.originalHtml;
  }
  btn.disabled = false;
}

function fmt(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(status: string): string {
  const map: Record<string, string> = {
    // Registration statuses
    registered: "success", pending_email_confirmation: "warning",
    waitlisted: "info", cancelled: "danger", waiting: "warning", offered: "info",
    // Invite statuses
    sent: "primary", accepted: "success", declined: "danger", expired: "secondary", revoked: "secondary",
    // Email outbox statuses
    queued: "primary", retrying: "warning", failed: "danger", sending: "primary",
    transactional: "primary", promotional: "info",
    // Email template version statuses
    active: "success", draft: "warning",
    // Donation statuses
    pending: "warning", completed: "success",
    // Event/registration mode
    invite_only: "warning", invite_or_open: "primary", open: "success",
    // Proposal statuses / outcomes
    submitted: "primary", under_review: "info", rejected: "danger", needs_work: "warning", withdrawn: "secondary",
    // Review recommendation
    accept: "success", reject: "danger", "needs-work": "warning",
  };
  const labels: Record<string, string> = {
    registered: "Confirmed",
    pending_email_confirmation: "Pending confirmation",
    waitlisted: "Waitlisted",
    cancelled: "Cancelled",
    sent: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    revoked: "Revoked",
    queued: "Queued",
    retrying: "Retrying",
    failed: "Failed",
    sending: "Sending",
    transactional: "Transactional",
    promotional: "Promotional",
    active: "Active",
    draft: "Draft",
    pending: "Pending",
    completed: "Completed",
    invite_only: "Invite only",
    invite_or_open: "Invite or open",
    open: "Open",
    submitted: "Submitted",
    under_review: "Under review",
    rejected: "Rejected",
    needs_work: "Needs work",
    withdrawn: "Withdrawn",
    accept: "Accept",
    reject: "Reject",
    "needs-work": "Needs work",
    waiting: "Waiting",
    offered: "Offered",
  };
  const label = labels[status] ?? (status || "—");
  return `<span class="badge text-bg-${map[status] ?? "secondary"}">${esc(label)}</span>`;
}

function tbl(heads: string[], rows: string[], empty = "No data"): string {
  if (!rows.length) {
    return `<p class="text-muted text-center py-3 fst-italic small">${esc(empty)}</p>`;
  }
  return (
    '<div class="tbl-wrap"><table class="table table-sm table-hover mb-0">' +
    '<thead class="table-light"><tr>' +
    heads.map((h) => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function attendanceTypeLabel(attendanceType: string): string {
  switch (attendanceType) {
    case "in_person":
      return "In-person";
    case "virtual":
      return "Virtual";
    case "on_demand":
      return "On-demand";
    default:
      return attendanceType;
  }
}

function waitlistStatusBadge(status: string): string {
  switch (status) {
    case "waiting":
      return '<span class="badge text-bg-warning">Waiting</span>';
    case "offered":
      return '<span class="badge text-bg-info">Offer sent</span>';
    case "accepted":
      return '<span class="badge text-bg-success">Claimed</span>';
    case "expired":
      return '<span class="badge text-bg-secondary">Expired</span>';
    default:
      return `<span class="badge text-bg-secondary">${esc(status)}</span>`;
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function nav(sec: string): void {
  document.querySelectorAll<HTMLElement>(".adm-section").forEach((el) => el.classList.remove("active"));
  q(`#s-${sec}`)?.classList.add("active");
  document.querySelectorAll<HTMLButtonElement>(".sidebar-link[data-sec]").forEach((b) => {
    b.classList.toggle("active", b.dataset.sec === sec);
  });
  const loaders: Record<string, () => Promise<void>> = {
    dashboard: loadDashboard,
    events: loadEvents,
    email: loadEmail,
    duework: loadDueWork,
    templates: loadTemplates,
    stats: loadStats,
    donations: loadDonations,
    users: loadUsers,
  };
  loaders[sec]?.();
}

function showApp(): void {
  hide(q("#login-wrap"));
  show(q("#admin-root"));
  const sbUser = q("#sb-user");
  if (sbUser) sbUser.textContent = _email ?? "";
  nav("dashboard");
}

function showLogin(): void {
  hide(q("#verify-overlay"));
  show(q("#login-wrap"));
  hide(q("#admin-root"));
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

async function loadDashboard(): Promise<void> {
  const el = q("#d-body");
  if (!el) return;
  el.innerHTML = spinner();
  try {
    const s = await api<StatsResponse>("/api/v1/admin/stats");
    const { registrations: r, email: em, invites: inv, donations: don } = s;
    const donTop = don.byCurrency.find((d) => d.status === "completed");
    const donCompleted = don.byStatus.completed ?? 0;
    const donPending = don.byStatus.pending ?? 0;
    const donFailed = don.byStatus.failed ?? 0;
    const donExpired = don.byStatus.expired ?? 0;
    el.innerHTML =
      '<div class="stat-grid">' +
        sc("Total Registrations", r.total, `${r.byStatus.registered ?? 0} confirmed`) +
        sc("Pending Invites", inv.byStatus.sent ?? 0, `${inv.total} total`) +
        sc("Queued Emails", em.totalQueued, "") +
        sc("Failed Emails", em.totalFailed, "go to Email tab to fix", em.totalFailed > 0 ? "danger" : "") +
        sc("Completed Donations", donCompleted, donTop ? `${fmtMoney(donTop.total_gross, donTop.currency)} total` : "no data") +
        sc("Pending Donations", donPending, [donFailed > 0 ? `${donFailed} failed` : "", donExpired > 0 ? `${donExpired} expired` : ""].filter(Boolean).join(" · ") || "none failed", donFailed > 0 ? "danger" : "") +
      "</div>" +
      '<div class="row g-3">' +
        '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations by Status</h6>' +
          statusBars(r.byStatus, r.total) +
        "</div></div></div>" +
        '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Top Events</h6>' +
          tbl(
            ["Event", "Conf.", "Total"],
            s.topEvents.map(
              (e) =>
                `<tr><td><button class="btn btn-link p-0 small text-start" data-nav-event="${esc(e.slug)}">${esc(e.name)}</button></td>` +
                `<td>${e.confirmed}</td><td>${e.total}</td></tr>`,
            ),
            "No events",
          ) +
        "</div></div></div>" +
      "</div>";
    // Wire up top-events buttons using event delegation (no inline onclick)
    el.querySelectorAll<HTMLButtonElement>("[data-nav-event]").forEach((btn) => {
      btn.addEventListener("click", () => {
        nav("events");
        const slug = btn.dataset.navEvent!;
        setTimeout(() => openEvent(slug), 200);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function sc(lbl: string, val: number, note: string, variant = ""): string {
  const cls = variant === "danger" && val > 0 ? " danger" : "";
  return (
    `<div class="stat-card${cls}">` +
    `<div class="val">${val}</div>` +
    `<div class="lbl">${esc(lbl)}</div>` +
    `<div class="note">${esc(note)}</div></div>`
  );
}

function statusBars(byStatus: Record<string, number>, total: number): string {
  if (!total) return '<p class="text-muted fst-italic small">No data</p>';
  return Object.entries(byStatus)
    .map(([k, v]) => {
      const pct = Math.round((v / total) * 100);
      return (
        `<div class="bar-row"><span class="bar-lbl">${esc(k)}</span>` +
        `<div class="bar-track"><div class="bar-fill ${esc(k)}" style="width:${pct}%"></div></div>` +
        `<span class="bar-cnt">${v}</span></div>`
      );
    })
    .join("");
}

function fmtMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  });
}

// ── Events ─────────────────────────────────────────────────────────────────────

async function loadEvents(): Promise<void> {
  const el = q("#e-body");
  if (!el) return;
  el.innerHTML = spinner();
  hide(q("#e-detail"));
  show(el);
  try {
    const d = await api<{ events: EventSummary[] }>("/api/v1/admin/events");
    _evList = d.events ?? [];
    el.innerHTML =
      '<div class="mb-3"><button class="btn btn-sm btn-success" id="btn-new-event">+ New Event</button></div>' +
      '<div id="new-event-form" class="d-none card border-0 shadow-sm mb-3"><div class="card-header bg-white fw-semibold">Create new event</div>' +
      '<div class="card-body">' + newEventFormHtml() + '</div></div>' +
      tbl(
        ["Event", "Dates", "Mode", "Confirmed", "Total", "Pending", ""],
        _evList.map(
          (e) =>
            `<tr><td><strong style="font-size:.85rem">${esc(e.name)}</strong><br>` +
            `<span class="mono text-muted">${esc(e.slug)}</span></td>` +
            `<td class="mono" style="white-space:nowrap;font-size:.75rem">${e.starts_at ? esc(e.starts_at.substring(0, 10)) : "—"}</td>` +
            `<td>${badge(e.registration_mode)}</td>` +
            `<td class="mono">${e.confirmed_registrations ?? 0}</td>` +
            `<td class="mono">${e.total_registrations ?? 0}</td>` +
            `<td class="mono">${e.pending_invites ?? 0}</td>` +
            `<td><button class="btn btn-sm btn-outline-success" data-open-event="${esc(e.slug)}">Manage →</button></td></tr>`,
        ),
        "No events found",
      );
    // Wire New Event button
    q("#btn-new-event")?.addEventListener("click", () => {
      const f = q("#new-event-form");
      f?.classList.toggle("d-none");
    });
    wireNewEventForm();
    el.querySelectorAll<HTMLButtonElement>("[data-open-event]").forEach((btn) => {
      btn.addEventListener("click", () => openEvent(btn.dataset.openEvent!));
    });
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function openEvent(slug: string): Promise<void> {
  const det = q("#e-detail");
  const eb = q("#e-body");
  if (!det) return;
  hide(eb);
  show(det);
  det.innerHTML = spinner();

  const ev = _evList.find((e) => e.slug === slug) ?? ({} as EventSummary);
  try {
    const detailResp = await api<{ event: EventDetail }>(`/api/v1/admin/events/${slug}`);
    _currentEventDetail = detailResp.event;

    det.innerHTML =
      '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
        `<span class="fw-semibold">${esc(ev.name || slug)}</span>` +
        '<button class="btn btn-sm btn-secondary" id="btn-close-event">&larr; Back</button>' +
      '</div><div class="card-body">' +
        '<ul class="nav nav-tabs mb-3">' +
          `<li class="nav-item"><button class="nav-link active" data-main-tab="registrations">Registrations</button></li>` +
          '<li class="nav-item"><button class="nav-link" data-main-tab="proposals">Proposals</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-main-tab="promoters">Promoters &#127881;</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-main-tab="settings">Event Settings</button></li>' +
        '</ul>' +
        `<div id="et-registrations">${registrationsGroupTabHtml(slug)}</div>` +
        `<div id="et-proposals-group" class="d-none">${proposalsGroupTabHtml()}</div>` +
        `<div id="et-promoters" class="d-none">${promotersTabHtml()}</div>` +
        `<div id="et-settings" class="d-none">${eventSettingsTabHtml()}</div>` +
      '</div></div>';

    q("#btn-close-event")?.addEventListener("click", closeEvent);

    det.querySelectorAll<HTMLButtonElement>("[data-main-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        det.querySelectorAll<HTMLButtonElement>("[data-main-tab]").forEach((b) => b.classList.remove("active"));
        ["registrations", "proposals-group", "promoters", "settings"].forEach((id) => hide(q(`#et-${id}`)));
        btn.classList.add("active");
        const tab = btn.dataset.mainTab!;
        if (tab === "registrations") {
          show(q("#et-registrations"));
          wireRegistrationsGroupTabs(slug);
          void loadEventRegistrations(slug);
        }
        if (tab === "proposals") {
          show(q("#et-proposals-group"));
          wireProposalsGroupTabs(slug);
          void loadEventProposals(slug);
        }
        if (tab === "promoters") {
          show(q("#et-promoters"));
          void loadEventPromoters(slug);
        }
        if (tab === "settings") {
          show(q("#et-settings"));
          wireEventSettingsTabs(slug);
        }
      });
    });

    wireInviteForm(slug);
    wireDetailsForm(slug);
    wireRegistrationsGroupTabs(slug);
    wireProposalsGroupTabs(slug);
    void loadEventRegistrations(slug);
  } catch (err) {
    det.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function closeEvent(): void {
  hide(q("#e-detail"));
  show(q("#e-body"));
}

function registrationsGroupTabHtml(slug: string): string {
  return (
    '<ul class="nav nav-tabs mb-3">' +
      '<li class="nav-item"><button class="nav-link active" data-reg-tab="regs">Registrations</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-reg-tab="invlist">Invite List</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-reg-tab="invite">Send Invite</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-reg-tab="email">Send Email</button></li>' +
    '</ul>' +
    `<div id="et-regs">${registrationsListHtml(slug)}</div>` +
    `<div id="et-invlist" class="d-none">${inviteListHtml(slug)}</div>` +
    `<div id="et-invite" class="d-none">${inviteFormHtml(slug)}</div>` +
    `<div id="et-email" class="d-none">${emailTabHtml("regs")}</div>`
  );
}

function wireRegistrationsGroupTabs(slug: string): void {
  const root = q("#et-registrations");
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("[data-reg-tab]").forEach((btn) => {
    btn.onclick = () => {
      root.querySelectorAll<HTMLButtonElement>("[data-reg-tab]").forEach((b) => b.classList.remove("active"));
      ["regs", "invlist", "invite", "email"].forEach((id) => hide(q(`#et-${id}`)));
      btn.classList.add("active");
      const tab = btn.dataset.regTab!;
      show(q(`#et-${tab}`));
      if (tab === "regs") void loadEventRegistrations(slug);
      if (tab === "invlist") void loadEventInvites(slug);
      if (tab === "email") void wireEmailTab(slug, "regs", "attendees");
    };
  });
}

function registrationsListHtml(slug: string): string {
  void slug;
  return (
    '<div class="d-flex justify-content-end mb-2">' +
      `<button class="btn btn-sm btn-outline-warning" data-run-waitlist-promotions="${esc(slug)}">Run waitlist promotions</button>` +
    '</div>' +
    '<div id="regs-list-body">' + spinner() + '</div>' +
    '<div id="regs-list-pager" class="mt-2"></div>'
  );
}

async function loadEventRegistrations(slug: string): Promise<void> {
  const body = q("#regs-list-body");
  const pager = q("#regs-list-pager");
  if (!body) return;
  body.innerHTML = spinner();
  if (pager) pager.innerHTML = "";

  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    try {
      const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      const d = await api<{
        registrations: Registration[];
        page?: { limit: number; offset: number; hasMore: boolean; total: number };
      }>(`/api/v1/admin/events/${slug}/registrations?${query.toString()}`);

      const regs = d.registrations ?? [];
      body.innerHTML = regsTable(regs);
      wireRegsTable(slug, regs);

      const pageOffset = d.page?.offset ?? offset;
      const pageLimit = d.page?.limit ?? pageSize;
      const hasMore = d.page?.hasMore ?? false;
      const pageTotal = d.page?.total ?? 0;
      const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

      document.querySelector<HTMLButtonElement>(`[data-run-waitlist-promotions="${slug}"]`)?.addEventListener("click", () => {
        void doRunWaitlistPromotions(slug);
      });

      if (pager) {
        pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, regs.length, pageTotal);
        pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
          offset = Math.max(0, pageOffset - pageLimit);
          void doLoad();
        });
        pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
          offset = pageOffset + pageLimit;
          void doLoad();
        });
        pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const page = Number(btn.dataset.pageJump || "1");
            if (!Number.isFinite(page) || page < 1) return;
            offset = (page - 1) * pageLimit;
            void doLoad();
          });
        });
        pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
          const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
          if (!Number.isFinite(nextSize) || nextSize < 1) return;
          pageSize = nextSize;
          offset = 0;
          void doLoad();
        });
      }
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
      if (pager) pager.innerHTML = "";
    }
  };

  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.regListWired) {
    bodyEl.dataset.regListWired = "1";
  }

  await doLoad();
}

async function doRunWaitlistPromotions(slug: string): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-run-waitlist-promotions="${slug}"]`);
  if (btn) setButtonLoading(btn);
  try {
    const result = await api<{ wholeRegistrationOffers: number; dayRegistrationOffers: number }>(
      `/api/v1/admin/events/${slug}/waitlist/promote`,
      { method: "POST", body: "{}" },
    );
    toast(`Waitlist promotions sent: ${result.wholeRegistrationOffers} registration offers, ${result.dayRegistrationOffers} day offers`, "success");
    await loadEventRegistrations(slug);
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (btn) resetButton(btn);
  }
}

function proposalsGroupTabHtml(): string {
  return (
    '<ul class="nav nav-tabs mb-3">' +
      '<li class="nav-item"><button class="nav-link active" data-prop-tab="proposals">Proposals</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-invlist">Invite List</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-invite">Send Invite</button></li>' +
      '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-email">Send Email</button></li>' +
    '</ul>' +
    `<div id="et-proposals">${proposalsTabHtml()}</div>` +
    `<div id="et-prop-invlist" class="d-none">${proposalInviteListHtml()}</div>` +
    `<div id="et-prop-invite" class="d-none">${proposalInviteFormHtml()}</div>` +
    `<div id="et-prop-email" class="d-none">${emailTabHtml("prop")}</div>`
  );
}

function wireProposalsGroupTabs(slug: string): void {
  const root = q("#et-proposals-group");
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("[data-prop-tab]").forEach((btn) => {
    btn.onclick = () => {
      root.querySelectorAll<HTMLButtonElement>("[data-prop-tab]").forEach((b) => b.classList.remove("active"));
      ["proposals", "prop-invlist", "prop-invite", "prop-email"].forEach((id) => hide(q(`#et-${id}`)));
      btn.classList.add("active");
      const tab = btn.dataset.propTab!;
      show(q(`#et-${tab}`));
      if (tab === "proposals") void loadEventProposals(slug);
      if (tab === "prop-invlist") void loadProposalInvites(slug);
      if (tab === "prop-invite") wireProposalInviteForm(slug);
      if (tab === "prop-email") void wireEmailTab(slug, "prop", "speakers");
    };
  });
}

function proposalInviteFormHtml(): string {
  return (
    '<div id="admin-proposal-invite-wrap">' +
    '<div class="mb-3">' +
      '<label class="form-label small fw-semibold">Paste emails &amp; names'
      + ' <span class="text-muted fw-normal">for proposal invites (one per line or CSV)</span></label>' +
      '<textarea class="form-control form-control-sm" id="pinv-paste" rows="4"'
      + ' placeholder="alice@example.com&#10;Bob Smith &lt;bob@example.com&gt;&#10;carol.jones@company.com"></textarea>' +
      '<div class="mt-1 d-flex gap-2 align-items-center flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="pinv-parse-btn">Parse &darr;</button>' +
        '<label class="btn btn-sm btn-outline-secondary mb-0" for="pinv-csv">Upload CSV</label>' +
        '<input type="file" id="pinv-csv" accept=".csv,text/csv" class="visually-hidden">' +
        '<span class="form-text ms-1">CSV columns: <code>email</code>, <code>firstName</code> (opt.), <code>lastName</code> (opt.)</span>' +
      '</div>' +
    '</div>' +
    '<div class="d-flex gap-1 mb-1 small text-muted text-uppercase" style="font-size:.68rem;font-weight:600;padding:0 .1rem">' +
      '<span style="flex:1.2">First name</span>' +
      '<span style="flex:1.2">Last name</span>' +
      '<span style="flex:2">Email *</span>' +
      '<span style="width:1.8rem"></span>' +
    '</div>' +
    '<div id="pinv-rows" class="mb-2"></div>' +
    '<div class="d-flex gap-2 align-items-center flex-wrap">' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" id="pinv-add-btn">+ Add row</button>' +
      '<button type="button" class="btn btn-sm btn-success" id="pinv-send-btn">Send Proposal Invites</button>' +
      '<span class="text-muted small" id="pinv-count-lbl"></span>' +
    '</div>' +
    '<div id="pinv-form-status" class="mt-2 small"></div>' +
    '</div>'
  );
}

function proposalInviteListHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<label class="form-label mb-0 small fw-semibold" for="pinv-filter">Filter status:</label>' +
      '<select class="form-select form-select-sm" id="pinv-filter" style="width:auto">' +
        '<option value="">All</option>' +
        '<option value="sent" selected>Pending (sent)</option>' +
        '<option value="accepted">Accepted</option>' +
        '<option value="declined">Declined</option>' +
        '<option value="expired">Expired</option>' +
        '<option value="revoked">Revoked</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline-secondary" id="pinv-list-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="pinv-list-body">' + spinner() + '</div>' +
    '<div id="pinv-list-pager" class="mt-2"></div>'
  );
}

function syncProposalInviteCount(): void {
  const rows = document.querySelectorAll("#pinv-rows .inv-row");
  const lbl = q("#pinv-count-lbl");
  if (lbl) lbl.textContent = rows.length > 0 ? `${rows.length} row${rows.length !== 1 ? "s" : ""}` : "";
}

function collectProposalInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
  const container = q("#pinv-rows");
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(".inv-row"))
    .map((row) => ({
      email: (row.querySelector<HTMLInputElement>("[data-pinv-email]")?.value ?? "").trim(),
      firstName: (row.querySelector<HTMLInputElement>("[data-pinv-first]")?.value ?? "").trim() || undefined,
      lastName: (row.querySelector<HTMLInputElement>("[data-pinv-last]")?.value ?? "").trim() || undefined,
    }))
    .filter((item) => item.email);
}

function makeProposalInviteRow(entry?: AdminInviteEntry): HTMLElement {
  const div = document.createElement("div");
  div.className = "inv-row d-flex gap-1 mb-1 align-items-center";
  div.innerHTML =
    `<input class="form-control form-control-sm" style="flex:1.2" type="text"
      placeholder="First (opt.)" data-pinv-first autocomplete="off"
      value="${esc(entry?.firstName ?? "")}">` +
    `<input class="form-control form-control-sm" style="flex:1.2" type="text"
      placeholder="Last (opt.)" data-pinv-last autocomplete="off"
      value="${esc(entry?.lastName ?? "")}">` +
    `<input class="form-control form-control-sm" style="flex:2" type="email"
      placeholder="email@example.com" data-pinv-email autocomplete="off"
      value="${esc(entry?.email ?? "")}">` +
    '<button type="button" class="btn btn-sm btn-outline-danger p-0 px-1 pinv-remove-btn"' +
    ' title="Remove row" style="flex:none;height:1.75rem;line-height:1">&times;</button>';
  div.querySelector<HTMLButtonElement>(".pinv-remove-btn")?.addEventListener("click", () => {
    div.remove();
    syncProposalInviteCount();
  });
  return div;
}

function addProposalInviteRow(entry?: AdminInviteEntry): void {
  const container = q("#pinv-rows");
  if (!container) return;
  if (container.querySelectorAll(".inv-row").length >= MAX_ADMIN_INVITES) return;
  container.appendChild(makeProposalInviteRow(entry));
  syncProposalInviteCount();
}

function addParsedProposalEntries(entries: AdminInviteEntry[]): void {
  const container = q("#pinv-rows");
  if (!container) return;
  const existingRows = Array.from(container.querySelectorAll<HTMLElement>(".inv-row"));
  let idx = 0;
  for (const row of existingRows) {
    if (idx >= entries.length) break;
    const emailEl = row.querySelector<HTMLInputElement>("[data-pinv-email]");
    if (emailEl && !emailEl.value.trim()) {
      const firstEl = row.querySelector<HTMLInputElement>("[data-pinv-first]");
      const lastEl = row.querySelector<HTMLInputElement>("[data-pinv-last]");
      if (firstEl) firstEl.value = entries[idx].firstName ?? "";
      if (lastEl) lastEl.value = entries[idx].lastName ?? "";
      emailEl.value = entries[idx].email;
      idx++;
    }
  }
  for (; idx < entries.length; idx++) addProposalInviteRow(entries[idx]);
  syncProposalInviteCount();
}

function wireProposalInviteForm(slug: string): void {
  const wrap = q<HTMLElement>("#admin-proposal-invite-wrap");
  if (!wrap || wrap.dataset.wiredProposalInvite === "1") return;
  wrap.dataset.wiredProposalInvite = "1";

  addProposalInviteRow();

  q("#pinv-parse-btn")?.addEventListener("click", () => {
    const text = q<HTMLTextAreaElement>("#pinv-paste")?.value ?? "";
    const entries = parseAdminInviteText(text);
    if (!entries.length) { toast("No valid email addresses found in the pasted text", "error"); return; }
    addParsedProposalEntries(entries);
    const ta = q<HTMLTextAreaElement>("#pinv-paste");
    if (ta) ta.value = "";
    toast(`Parsed ${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`, "success");
  });

  q<HTMLInputElement>("#pinv-csv")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string ?? "";
      const entries = parseAdminCsv(text);
      if (!entries.length) { toast("No valid rows found in CSV", "error"); return; }
      addParsedProposalEntries(entries);
      toast(`Imported ${entries.length} row${entries.length !== 1 ? "s" : ""} from CSV`, "success");
      (e.target as HTMLInputElement).value = "";
    };
    reader.readAsText(file);
  });

  q("#pinv-add-btn")?.addEventListener("click", () => addProposalInviteRow());
  q("#pinv-send-btn")?.addEventListener("click", () => void doAdminProposalInvite(slug));
}

async function doAdminProposalInvite(slug: string): Promise<void> {
  const container = q("#pinv-rows");
  const statusEl = q("#pinv-form-status");
  if (!container) return;

  const invites = collectProposalInvites();
  if (!invites.length) {
    if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
    return;
  }

  const sendBtn = q<HTMLButtonElement>("#pinv-send-btn");
  if (sendBtn) setButtonLoading(sendBtn);
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    const r = await api<{ created?: unknown[] }>(`/api/v1/admin/events/${slug}/invites/speakers/bulk`, {
      method: "POST",
      body: JSON.stringify({ invites }),
    });
    const count = r.created?.length ?? invites.length;
    toast(`Sent ${count} proposal invite${count !== 1 ? "s" : ""}`, "success");
    container.innerHTML = "";
    addProposalInviteRow();
    syncProposalInviteCount();
    if (statusEl) { statusEl.textContent = `✓ ${count} proposal invitation${count !== 1 ? "s" : ""} queued.`; statusEl.className = "mt-2 small text-success"; }
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
  } finally {
    if (sendBtn) resetButton(sendBtn);
  }
}

async function doResendEventInvite(slug: string, inviteId: string): Promise<void> {
  const statusEl = q(`#inv-resend-status-${inviteId}`);
  const resendBtn = document.querySelector<HTMLButtonElement>(`[data-resend-invite="${inviteId}"]`);

  if (resendBtn) setButtonLoading(resendBtn);

  try {
    await api(`/api/v1/admin/events/${slug}/invites/${inviteId}/resend`, { method: "POST", body: "{}" });
    if (statusEl) { statusEl.textContent = "Resent"; statusEl.className = "small text-success"; }
    toast("Invite resent", "success");
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    toast((err as Error).message, "error");
  } finally {
    if (resendBtn) resetButton(resendBtn);
  }
}

async function loadProposalInvites(slug: string, statusFilter?: string): Promise<void> {
  const body = q("#pinv-list-body");
  const pager = q("#pinv-list-pager");
  if (!body) return;
  body.innerHTML = spinner();
  if (pager) pager.innerHTML = "";

  const filterSel = q<HTMLSelectElement>("#pinv-filter");
  const refreshBtn = q<HTMLButtonElement>("#pinv-list-refresh");

  const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");
  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    const filter = getFilter();
    const query = new URLSearchParams();
    query.set("type", "speaker");
    query.set("limit", String(pageSize));
    query.set("offset", String(offset));
    if (filter) query.set("status", filter);
    const url = `/api/v1/admin/events/${slug}/invites?${query.toString()}`;

    try {
      const d = await api<{ invites: InviteRecord[]; page?: { limit: number; offset: number; hasMore: boolean; total: number } }>(url);
      const invites = d.invites ?? [];
      body.innerHTML = tbl(
        ["Invitee Email", "Invitee Name", "Status", "Sent", "Declined", "Source", "Actions"],
        invites.map((i) => {
          const name = [i.invitee_first_name, i.invitee_last_name].filter(Boolean).join(" ") || "—";
          const canResend = i.status !== "accepted" && i.status !== "revoked";
          const action = canResend
            ? `<button class="btn btn-sm btn-outline-primary" data-resend-invite="${esc(i.id)}">Resend</button><div id="inv-resend-status-${esc(i.id)}" class="small mt-1"></div>`
            : '<span class="text-muted small">—</span>';
          return (
            `<tr><td class="mono" style="font-size:.8rem">${esc(i.invitee_email)}</td>` +
            `<td>${esc(name)}</td>` +
            `<td>${inviteBadge(i.status)}</td>` +
            `<td class="mono">${fmt(i.created_at)}</td>` +
            `<td class="mono">${i.declined_at ? fmt(i.declined_at) : "—"}</td>` +
            `<td class="text-muted small">${esc(i.source_type ?? "—")}</td>` +
            `<td>${action}</td></tr>`
          );
        }),
        "No proposal invites found matching the current filter",
      );

      body.querySelectorAll<HTMLButtonElement>("[data-resend-invite]").forEach((btn) => {
        btn.onclick = () => {
          const inviteId = btn.dataset.resendInvite;
          if (!inviteId) return;
          void doResendEventInvite(slug, inviteId);
        };
      });

      const pageOffset = d.page?.offset ?? offset;
      const pageLimit = d.page?.limit ?? pageSize;
      const hasMore = d.page?.hasMore ?? false;
      const pageTotal = d.page?.total ?? 0;
      const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

      if (pager) {
        pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, invites.length, pageTotal);
        pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
          offset = Math.max(0, pageOffset - pageLimit);
          void doLoad();
        });
        pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
          offset = pageOffset + pageLimit;
          void doLoad();
        });
        pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const page = Number(btn.dataset.pageJump || "1");
            if (!Number.isFinite(page) || page < 1) return;
            offset = (page - 1) * pageLimit;
            void doLoad();
          });
        });
        pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
          const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
          if (!Number.isFinite(nextSize) || nextSize < 1) return;
          pageSize = nextSize;
          offset = 0;
          void doLoad();
        });
      }
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
      if (pager) pager.innerHTML = "";
    }
  };

  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.proposalInvListWired) {
    bodyEl.dataset.proposalInvListWired = "1";
    filterSel?.addEventListener("change", () => {
      offset = 0;
      void doLoad();
    });
    refreshBtn?.addEventListener("click", () => {
      offset = 0;
      void doLoad();
    });
  }

  await doLoad();
}

function eventSettingsTabHtml(): string {
  return (
    '<div class="card border-0 bg-light-subtle">' +
      '<div class="card-body">' +
        '<div class="mb-3">' +
          '<h6 class="mb-1">Event Settings</h6>' +
          '<div class="small text-muted">Configuration areas used during setup and occasional maintenance.</div>' +
        '</div>' +
        '<ul class="nav nav-tabs mb-3" id="event-settings-nav">' +
          '<li class="nav-item"><button class="nav-link active" data-settings-tab="general">General</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-settings-tab="days">Days</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-settings-tab="terms">Terms</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-settings-tab="forms">Forms</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-settings-tab="team">Team</button></li>' +
        '</ul>' +
        `<div id="ets-general">${detailsFormHtml(_currentEventDetail ?? {})}</div>` +
        `<div id="ets-days" class="d-none">${eventDaysTabHtml()}</div>` +
        `<div id="ets-terms" class="d-none">${eventTermsTabHtml()}</div>` +
        `<div id="ets-forms" class="d-none">${eventFormsTabHtml()}</div>` +
        `<div id="ets-team" class="d-none">${teamTabHtml()}</div>` +
      '</div>' +
    '</div>'
  );
}

function wireEventSettingsTabs(slug: string): void {
  const root = q("#et-settings");
  if (!root) return;

  root.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((btn) => {
    btn.onclick = () => {
      root.querySelectorAll<HTMLButtonElement>("[data-settings-tab]").forEach((b) => b.classList.remove("active"));
      ["general", "days", "terms", "forms", "team"].forEach((id) => hide(q(`#ets-${id}`)));
      btn.classList.add("active");
      const tab = btn.dataset.settingsTab!;
      show(q(`#ets-${tab}`));
      if (tab === "days") void loadEventDays(slug);
      if (tab === "terms") void loadEventTerms(slug);
      if (tab === "forms") void loadEventForms(slug);
      if (tab === "team") void loadEventPermissions(slug);
    };
  });
}

function regsTable(regs: Registration[]): string {
  const rows = regs.map((r) => {
    const name = r.display_name || r.user_email || r.user_id || "—";
    const sub =
      r.user_email && r.display_name && r.display_name !== r.user_email
        ? `<br><span class="mono text-muted">${esc(r.user_email)}</span>`
        : "";
    const hasDayWaitlist = Boolean(r.dayWaitlistCount && r.dayWaitlistCount > 0);
    const waitlistBadgeStatus = hasDayWaitlist && r.dayWaitlistSummary?.includes("(offered)") ? "offered" : "waiting";
    const waitlistCell = r.status === "waitlisted" && !hasDayWaitlist
      ? `<div class="d-flex flex-column gap-1"><span>${badge("waitlisted")}</span><span class="text-body-secondary small">Whole registration</span></div>`
      : hasDayWaitlist
        ? `<div class="d-flex flex-column gap-1">${badge(waitlistBadgeStatus)}${r.dayWaitlistSummary ? `<span class="text-body-secondary small">${esc(r.dayWaitlistSummary)}</span>` : ""}</div>`
        : `<span class="text-body-secondary small">None</span>`;
    return (
      `<tr data-reg-id="${esc(r.id)}">` +
      `<td>${esc(name)}${sub}</td>` +
      `<td>${badge(r.status)}</td>` +
      `<td>${esc(r.attendance_type ?? "—")}</td>` +
      `<td>${waitlistCell}</td>` +
      `<td class="text-muted small">${esc(r.source_type ?? "—")}</td>` +
      `<td class="mono">${fmt(r.created_at)}</td>` +
      `<td><button class="btn btn-sm btn-outline-secondary" data-manage-reg="${esc(r.id)}">Manage →</button></td>` +
      `</tr>` +
      `<tr id="reg-detail-${esc(r.id)}" class="d-none"><td colspan="7" class="p-0">` +
      `<div class="p-3 bg-light border-top"></div>` +
      `</td></tr>`
    );
  });

  if (!rows.length) {
    return `<p class="text-muted text-center py-3 fst-italic small">No registrations yet</p>`;
  }
  return (
    '<div class="tbl-wrap"><table class="table table-sm table-hover mb-0">' +
    '<thead class="table-light"><tr>' +
    ["Name / Email", "Status", "Attendance", "Day waitlist", "Source", "Registered", ""].map((h) => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function regDetailHtml(r: Registration, slug: string, eventDays: AdminRegistrationDay[]): string {
  const appBase = window.location.origin;
  const shareUrl = r.referral_code ? `${appBase}/r/${esc(r.referral_code)}` : null;
  const ogBadgeUrl = r.referral_code ? `${appBase}/api/v1/og/${esc(r.referral_code)}` : null;
  const waitlistEntries = (r.dayWaitlist ?? []).filter((entry) => entry.status === "waiting" || entry.status === "offered");
  const admitDays = waitlistEntries.length > 0
    ? waitlistEntries.map((entry) => ({ dayDate: entry.dayDate, label: entry.offerExpiresAt ? `${entry.status}, offer expires ${entry.offerExpiresAt}` : entry.status }))
    : r.status === "waitlisted"
      ? eventDays.map((day) => ({ dayDate: day.dayDate, label: day.label }))
      : [];
  const canAdmitDays = admitDays.length > 0;
  const waitlistAlert = r.status === "waitlisted"
    ? `<div class="alert alert-warning mb-0 mt-2"><strong>Waitlisted:</strong> this attendee does not yet have a confirmed in-person seat. The registration is active, but the seat is still pending availability.</div>`
    : "";

  const dayStatusMap = new Map<string, { attendanceType?: string; attendanceLabel?: string | null; waitlist?: { status: string; priorityLane: string; offerExpiresAt: string | null } }>();
  for (const entry of r.dayAttendance ?? []) {
    dayStatusMap.set(entry.dayDate, {
      attendanceType: entry.attendanceType,
      attendanceLabel: entry.label,
    });
  }
  for (const entry of r.dayWaitlist ?? []) {
    const current = dayStatusMap.get(entry.dayDate) ?? {};
    current.waitlist = {
      status: entry.status,
      priorityLane: entry.priorityLane,
      offerExpiresAt: entry.offerExpiresAt,
    };
    dayStatusMap.set(entry.dayDate, current);
  }

  const dayStatusRows = Array.from(dayStatusMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayDate, day]) => {
      const attendanceHtml = day.attendanceType
        ? `<div>${esc(attendanceTypeLabel(day.attendanceType))}</div>${day.attendanceLabel ? `<div class="text-body-secondary small">${esc(day.attendanceLabel)}</div>` : ""}`
        : `<span class="text-body-secondary">Not set</span>`;
      const waitlistHtml = day.waitlist
        ? `<div>${waitlistStatusBadge(day.waitlist.status)}</div><div class="text-body-secondary small">Lane: ${esc(day.waitlist.priorityLane)}</div>${day.waitlist.offerExpiresAt ? `<div class="text-body-secondary small">Offer expires ${esc(day.waitlist.offerExpiresAt)}</div>` : ""}`
        : `<span class="text-body-secondary">None</span>`;
      return `<tr><td>${esc(dayDate)}</td><td>${attendanceHtml}</td><td>${waitlistHtml}</td></tr>`;
    })
    .join("");
  const dayStatusBlock = dayStatusMap.size > 0
    ? `<div class="mt-3"><h6 class="small fw-semibold text-uppercase text-muted mb-2">Day status</h6><p class="small text-body-secondary mb-2">Per-day waitlist offers can be admitted directly here; the attendee does not need to claim them first.</p><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Day</th><th>Attendance</th><th>Waitlist</th></tr></thead><tbody>${dayStatusRows}</tbody></table></div></div>`
    : `<div class="mt-3"><h6 class="small fw-semibold text-uppercase text-muted mb-2">Day status</h6><p class="small text-body-secondary mb-0">No day-level attendance or waitlist records were returned for this registration.</p></div>`;

  void slug; // used by wiring functions via data-reg-id

  return (
    `<div class="row g-3">` +

    // ── Open manage page ──────────────────────────────────────────────────
    `<div class="col-md-6">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Manage Registration</h6>` +
    `<p class="small text-muted mb-2">Opens the registrant-facing manage page in a new tab. Requires your admin session — the link cannot be forwarded to or used by an attendee.</p>` +
    `<button class="btn btn-sm btn-primary" data-open-manage="${esc(r.id)}">Open Manage Page &#8599;</button>` +
    (canAdmitDays ? `<button class="btn btn-sm btn-outline-success ms-2" data-admit-selected-days="${esc(r.id)}">Admit Selected Days</button>` : "") +
    waitlistAlert +
    `</div>` +

    // ── Resend email ──────────────────────────────────────────────────────
    `<div class="col-md-3">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Confirmation Email</h6>` +
    `<p class="small text-muted mb-2">Rotates the token and re-queues the email (confirm link or manage link depending on status).</p>` +
    `<button class="btn btn-sm btn-outline-primary" data-resend-reg="${esc(r.id)}">Resend Email</button>` +
    `<div class="mt-2 small" id="rd-resend-status-${esc(r.id)}"></div>` +
    `</div>` +

    // ── Social promo kit ──────────────────────────────────────────────────
    `<div class="col-md-3">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Social Promo Kit &#127881;</h6>` +
    (shareUrl
      ? `<div class="mb-2">` +
        `<label class="form-label small fw-semibold mb-1">Referral Link</label>` +
        `<div class="input-group input-group-sm">` +
        `<input type="text" class="form-control form-control-sm mono" value="${esc(shareUrl)}" readonly id="rd-reflink-${esc(r.id)}">` +
        `<button class="btn btn-outline-secondary" data-copy-ref="${esc(r.id)}" title="Copy link">&#128203;</button>` +
        `</div>` +
        `</div>` +
        `<div class="mb-2 d-flex flex-wrap gap-1">` +
        `<a href="${esc(ogBadgeUrl!)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">View Badge &#128247;</a>` +
        `<a href="${esc(ogBadgeUrl!)}?download=1" download="promo-badge.png" class="btn btn-sm btn-outline-secondary">Download &#11015;</a>` +
        `<button class="btn btn-sm btn-outline-warning" data-regen-badge="${esc(r.id)}">&#8635; Regenerate</button>` +
        `</div>`
      : `<p class="small text-muted fst-italic">No referral code — person may not have completed registration share.</p>`
    ) +
    `</div>` +

    `</div>` +

    // ── Badge role override ───────────────────────────────────────────────
    `<div class="row g-3 mt-0 border-top pt-3">` +
    `<div class="col-12">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Badge Role</h6>` +
    `<p class="small text-muted mb-2">Set the role shown on the attendee's promotional badge. ` +
    `Auto-detection picks the highest-priority active participant role (speaker &gt; moderator &gt; panelist &gt; organizer). ` +
    `Selecting a role adds an admin participant entry; <em>Auto</em> removes it.</p>` +
    `<div id="rd-badge-role-${esc(r.id)}" class="d-flex align-items-center gap-2 flex-wrap">` +
    `<span class="text-muted small fst-italic">Loading…</span>` +
    `</div>` +
    `</div>` +
    `</div>` +

    (canAdmitDays
      ? `<div class="row g-3 mt-0 border-top pt-3"><div class="col-12"><h6 class="small fw-semibold text-uppercase text-muted mb-2">Admit selected days</h6><p class="small text-body-secondary mb-2">Tick the days to convert to in-person attendance. The attendee does not need to claim an offer first.</p><div class="admit-days-list d-flex flex-column gap-2">${admitDays.map((entry, index) => {
          const checked = index === 0 || admitDays.length === 1 ? "checked" : "";
          const suffix = entry.label ? ` - ${entry.label}` : "";
          return `<label class="form-check border rounded px-3 py-2 mb-0 bg-white"><input class="form-check-input me-2" type="checkbox" data-admit-day-checkbox="${esc(r.id)}" value="${esc(entry.dayDate)}" ${checked}><span class="form-check-label">${esc(entry.dayDate)}${esc(suffix)}</span></label>`;
        }).join("")}</div><div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-success" data-admit-selected-days="${esc(r.id)}">Admit Selected Days</button><button class="btn btn-sm btn-outline-secondary" data-select-all-admit-days="${esc(r.id)}">Select All</button><button class="btn btn-sm btn-outline-secondary" data-clear-admit-days="${esc(r.id)}">Clear</button></div></div></div>`
      : "") +

    dayStatusBlock
  );
}

function wireRegsTable(slug: string, regs: Registration[]): void {
  const regMap = new Map(regs.map((r) => [r.id, r]));

  document.querySelectorAll<HTMLButtonElement>("[data-manage-reg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const regId = btn.dataset.manageReg!;
      const detailRow = document.getElementById(`reg-detail-${regId}`);
      if (!detailRow) return;

      const isOpen = !detailRow.classList.contains("d-none");
      // Close all open detail rows first
      document.querySelectorAll<HTMLTableRowElement>("[id^='reg-detail-']").forEach((row) => {
        row.classList.add("d-none");
      });
      document.querySelectorAll<HTMLButtonElement>("[data-manage-reg]").forEach((b) => {
        b.textContent = "Manage →";
      });

      if (!isOpen) {
        const container = detailRow.querySelector("div");
        if (container) container.innerHTML = spinner();
        detailRow.classList.remove("d-none");
        btn.textContent = "Close ↑";

        void (async () => {
          try {
            const reg = regMap.get(regId);
            if (!reg) return;

            const detail = await api<{
              registration: Registration;
              dayAttendance?: Registration["dayAttendance"];
              dayWaitlist?: Registration["dayWaitlist"];
              eventDays?: AdminRegistrationDay[];
            }>(`/api/v1/admin/events/${slug}/registrations/${regId}`);

            const detailedReg: Registration = {
              ...reg,
              ...detail.registration,
              dayAttendance: detail.dayAttendance ?? reg.dayAttendance,
              dayWaitlist: detail.dayWaitlist ?? reg.dayWaitlist,
            };
            regMap.set(regId, detailedReg);

            if (container) container.innerHTML = regDetailHtml(detailedReg, slug, detail.eventDays ?? []);

            // Wire open manage page
            document.querySelector<HTMLButtonElement>(`[data-open-manage="${regId}"]`)?.addEventListener("click", () =>
              void doOpenManagePage(slug, regId),
            );
            // Wire resend
            document.querySelector<HTMLButtonElement>(`[data-resend-reg="${regId}"]`)?.addEventListener("click", () =>
              void doResendConfirmation(slug, regId),
            );
            // Wire badge regeneration
            document.querySelector<HTMLButtonElement>(`[data-regen-badge="${regId}"]`)?.addEventListener("click", () =>
              void doRegenerateBadge(slug, regId),
            );
            // Wire admit
            document.querySelector<HTMLButtonElement>(`[data-admit-selected-days="${regId}"]`)?.addEventListener("click", () =>
              void doAdmitRegistration(slug, regId, detailedReg),
            );
            document.querySelector<HTMLButtonElement>(`[data-select-all-admit-days="${regId}"]`)?.addEventListener("click", () => {
              document.querySelectorAll<HTMLInputElement>(`[data-admit-day-checkbox="${regId}"]`).forEach((checkbox) => {
                checkbox.checked = true;
              });
            });
            document.querySelector<HTMLButtonElement>(`[data-clear-admit-days="${regId}"]`)?.addEventListener("click", () => {
              document.querySelectorAll<HTMLInputElement>(`[data-admit-day-checkbox="${regId}"]`).forEach((checkbox) => {
                checkbox.checked = false;
              });
            });
            // Wire copy
            document.querySelector<HTMLButtonElement>(`[data-copy-ref="${regId}"]`)?.addEventListener("click", () => {
              const inp = document.getElementById(`rd-reflink-${regId}`) as HTMLInputElement | null;
              if (inp) {
                void navigator.clipboard.writeText(inp.value);
                toast("Referral link copied!", "success");
              }
            });
            // Load badge role info
            void doLoadBadgeRoleInfo(slug, regId);
          } catch (err) {
            if (container) container.innerHTML = `<div class="alert alert-danger mb-0">${esc((err as Error).message)}</div>`;
          }
        })();
      }
    });
  });
}

async function doOpenManagePage(slug: string, regId: string): Promise<void> {
  const openBtn = document.querySelector<HTMLButtonElement>(`[data-open-manage="${regId}"]`);
  if (openBtn) setButtonLoading(openBtn);
  try {
    // POST with Bearer auth to issue a 15-minute manage token.
    // Returns { manageUrl } — the full registrant-facing manage page URL.
    const { manageUrl } = await api<{ manageUrl: string }>(
      `/api/v1/admin/events/${slug}/registrations/${regId}/open-manage`,
      { method: "POST", body: "{}" },
    );
    window.open(manageUrl, "_blank", "noopener");
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (openBtn) resetButton(openBtn);
  }
}

async function doRegenerateBadge(slug: string, regId: string): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-regen-badge="${regId}"]`);
  if (btn) setButtonLoading(btn);
  try {
    const res = await api<{ badgeUrl: string }>(`/api/v1/admin/events/${slug}/registrations/${regId}/regenerate-badge`, { method: "POST", body: "{}" });
    toast("Badge regenerated — opening…", "success");
    // Cache-bust the badge URL so the browser doesn't serve the old PNG (max-age=86400)
    window.open(`${res.badgeUrl}?v=${Date.now()}`, "_blank", "noopener");
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (btn) resetButton(btn);
  }
}

async function doResendConfirmation(slug: string, regId: string): Promise<void> {
  const statusEl = document.getElementById(`rd-resend-status-${regId}`);
  const resendBtn = document.querySelector<HTMLButtonElement>(`[data-resend-reg="${regId}"]`);

  if (resendBtn) setButtonLoading(resendBtn);
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    await api(`/api/v1/admin/events/${slug}/registrations/${regId}/resend-confirmation`, { method: "POST", body: "{}" });
    toast("Confirmation email queued", "success");
    if (statusEl) { statusEl.textContent = "✓ Email queued"; statusEl.className = "mt-2 small text-success"; }
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
  } finally {
    if (resendBtn) resetButton(resendBtn);
  }
}

async function doAdmitRegistration(slug: string, regId: string, reg: Registration): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-admit-selected-days="${regId}"]`);
  if (btn) setButtonLoading(btn);

  try {
    const reason = reg.status === "waitlisted"
      ? "Capacity exemption approved by admin"
      : "Admin approved in-person admission";
    const dayDates = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-admit-day-checkbox="${regId}"]:checked`)).map((checkbox) => checkbox.value);

    if (dayDates.length === 0) {
      toast("Select at least one day to admit", "error");
      return;
    }

    await api(`/api/v1/admin/events/${slug}/registrations/${regId}/admit`, {
      method: "POST",
      body: JSON.stringify({
        mode: "capacity_exempt",
        reason,
        ...(dayDates.length > 0 ? { dayDates } : {}),
      }),
    });

    toast("Registration admitted", "success");
    await loadEventRegistrations(slug);
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (btn) resetButton(btn);
  }
}

// ── Badge role helpers ────────────────────────────────────────────────────────

const ROLE_BADGE_COLOUR: Record<string, string> = {
  attendee:  "primary",
  speaker:   "success",
  moderator: "warning",
  panelist:  "warning",
  organizer: "info",
  staff:     "secondary",
};

function roleBadgeHtml(role: string, label?: string): string {
  const colour = ROLE_BADGE_COLOUR[role] ?? "secondary";
  return `<span class="badge text-bg-${colour}">${esc(label ?? role)}</span>`;
}

async function doLoadBadgeRoleInfo(slug: string, regId: string): Promise<void> {
  const container = document.getElementById(`rd-badge-role-${regId}`);
  if (!container) return;
  try {
    const info = await api<BadgeRoleInfo>(
      `/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`,
    );
    renderBadgeRolePanel(container, slug, regId, info);
  } catch (err) {
    container.innerHTML = `<span class="small text-danger">${esc((err as Error).message)}</span>`;
  }
}

function renderBadgeRolePanel(
  container: HTMLElement,
  slug: string,
  regId: string,
  info: BadgeRoleInfo,
): void {
  const roles = info.available_roles;
  const selectId = `rd-badge-role-select-${regId}`;

  const options = [`<option value=""${!info.admin_override ? " selected" : ""}>Auto (${esc(info.auto_detected)})</option>`]
    .concat(roles.map((r) =>
      `<option value="${esc(r)}"${info.admin_override === r ? " selected" : ""}>${esc(r.charAt(0).toUpperCase() + r.slice(1).replace("_", "-"))}</option>`,
    ))
    .join("");

  container.innerHTML =
    `<div class="d-flex align-items-center gap-2 flex-wrap">` +
    `<span class="small text-muted">Effective:</span>` +
    roleBadgeHtml(info.effective_role) +
    (info.admin_override
      ? `<span class="small text-muted ms-1">(forced by admin: ${roleBadgeHtml(info.admin_override)}; auto would be ${roleBadgeHtml(info.auto_detected)})</span>`
      : `<span class="small text-muted fst-italic ms-1">(auto-detected)</span>`
    ) +
    `</div>` +
    `<div class="d-flex align-items-center gap-2 mt-2">` +
    `<select class="form-select form-select-sm" id="${esc(selectId)}" style="width:auto">` +
    options +
    `</select>` +
    `<button class="btn btn-sm btn-primary" id="rd-badge-role-save-${esc(regId)}">Save</button>` +
    `<span id="rd-badge-role-status-${esc(regId)}" class="small"></span>` +
    `</div>`;

  document.getElementById(`rd-badge-role-save-${regId}`)?.addEventListener("click", () =>
    void doSetBadgeRoleOverride(slug, regId, container, selectId),
  );
}

async function doSetBadgeRoleOverride(
  slug: string,
  regId: string,
  container: HTMLElement,
  selectId: string,
): Promise<void> {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  const saveBtn = document.getElementById(`rd-badge-role-save-${regId}`) as HTMLButtonElement | null;
  const statusEl = document.getElementById(`rd-badge-role-status-${regId}`);

  const roleValue = select?.value || null; // empty string → null (revert to auto)

  if (saveBtn) setButtonLoading(saveBtn);
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "small"; }

  try {
    const result = await api<BadgeRoleInfo & { success: boolean }>(
      `/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: roleValue }),
      },
    );
    toast("Badge role updated", "success");
    // Re-fetch full info to refresh the panel
    const refreshed = await api<BadgeRoleInfo>(
      `/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`,
    );
    renderBadgeRolePanel(container, slug, regId, refreshed);
    void result; // consumed
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    if (saveBtn) resetButton(saveBtn);
  }
}

function inviteFormHtml(slug: string): string {
  void slug; // used by wireInviteForm
  return (
    '<div id="admin-invite-wrap">' +
    // ── Paste zone
    '<div class="mb-3">' +
      '<label class="form-label small fw-semibold">Paste emails &amp; names'
      + ' <span class="text-muted fw-normal">— one per line; supports <code>Name &lt;email&gt;</code>'
      + ', dotted addresses, or CSV (email, first, last)</span></label>' +
      '<textarea class="form-control form-control-sm" id="inv-paste" rows="4"'
      + ' placeholder="alice@example.com&#10;Bob Smith &lt;bob@example.com&gt;&#10;carol.jones@company.com"></textarea>' +
      '<div class="mt-1 d-flex gap-2 align-items-center flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="inv-parse-btn">Parse &darr;</button>' +
        '<label class="btn btn-sm btn-outline-secondary mb-0" for="inv-csv">Upload CSV</label>' +
        '<input type="file" id="inv-csv" accept=".csv,text/csv" class="visually-hidden">' +
        '<span class="form-text ms-1">CSV columns: <code>email</code>, <code>firstName</code> (opt.), <code>lastName</code> (opt.)</span>' +
      '</div>' +
    '</div>' +
    // ── Table header
    '<div class="d-flex gap-1 mb-1 small text-muted text-uppercase" style="font-size:.68rem;font-weight:600;padding:0 .1rem">' +
      '<span style="flex:1.2">First name</span>' +
      '<span style="flex:1.2">Last name</span>' +
      '<span style="flex:2">Email *</span>' +
      '<span style="width:1.8rem"></span>' +
    '</div>' +
    // ── Rows container
    '<div id="inv-rows" class="mb-2"></div>' +
    // ── Actions
    '<div class="d-flex gap-2 align-items-center flex-wrap">' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" id="inv-add-btn">+ Add row</button>' +
      '<button type="button" class="btn btn-sm btn-outline-primary" id="inv-preview-btn">Preview Email</button>' +
      '<button type="button" class="btn btn-sm btn-success" id="inv-send-btn">Send Invites</button>' +
      '<span class="text-muted small" id="inv-count-lbl"></span>' +
    '</div>' +
    '<div id="inv-preview-status" class="mt-1 small text-muted">Preview required before sending.</div>' +
    '<div id="inv-preview-panel" class="mt-2 d-none">' +
      '<div class="card border">' +
        '<div class="card-header bg-light small fw-semibold">Email Preview</div>' +
        '<div class="card-body">' +
          '<div class="small text-muted">Subject</div>' +
          '<div id="inv-preview-subject" class="fw-semibold mb-2"></div>' +
          '<ul class="nav nav-tabs mb-2" role="tablist">' +
            '<li class="nav-item"><button class="nav-link active" id="inv-prev-tab-html" type="button">HTML</button></li>' +
            '<li class="nav-item"><button class="nav-link" id="inv-prev-tab-text" type="button">Text</button></li>' +
          '</ul>' +
          '<div id="inv-prev-html-wrap"><iframe id="inv-preview-html" style="width:100%;height:300px;border:1px solid #dee2e6;border-radius:.375rem;background:#fff"></iframe></div>' +
          '<pre id="inv-preview-text" class="json-out d-none" style="height:300px"></pre>' +
          '<div class="form-check mt-2">' +
            '<input class="form-check-input" type="checkbox" id="inv-preview-confirm">' +
            '<label class="form-check-label small" for="inv-preview-confirm">I reviewed this preview and confirm sending this email.</label>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="inv-form-status" class="mt-2 small"></div>' +
    '</div>'
  );
}

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

function inviteListHtml(slug: string): string {
  void slug;
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<label class="form-label mb-0 small fw-semibold" for="inv-filter">Filter status:</label>' +
      '<select class="form-select form-select-sm" id="inv-filter" style="width:auto">' +
        '<option value="">All</option>' +
        '<option value="sent" selected>Pending (sent)</option>' +
        '<option value="accepted">Accepted</option>' +
        '<option value="declined">Declined</option>' +
        '<option value="expired">Expired</option>' +
        '<option value="revoked">Revoked</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline-secondary" id="inv-list-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="inv-list-body">' + spinner() + '</div>' +
    '<div id="inv-list-pager" class="mt-2"></div>'
  );
}

// ── Promoters tab ────────────────────────────────────────────────────────────

function promotersTabHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<span class="small text-muted">Ranked by impact score — invite acceptances &amp; referral conversions</span>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="promo-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="promo-body">' + spinner() + '</div>'
  );
}

async function loadEventPromoters(slug: string): Promise<void> {
  const body = q("#promo-body");
  if (!body) return;

  const refreshBtn = q<HTMLButtonElement>("#promo-refresh");

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    try {
      const d = await api<PromotersResponse>(`/api/v1/admin/events/${slug}/promoters`);

      // ── Promoter leaderboard table ──────────────────────────────────────
      const promoterRows = d.promoters.map((p, idx) => {
        const displayName = [p.first_name, p.last_name].filter(Boolean).join(" ");
        const nameCell = displayName
          ? `${esc(displayName)}<br><span class="mono text-muted" style="font-size:.75rem">${esc(p.email ?? "")}</span>`
          : `<span class="mono">${esc(p.email ?? p.user_id)}</span>`;
        const convRate = p.invite_conversion_rate !== null ? `${p.invite_conversion_rate}%` : "—";
        const medal = idx === 0 ? " \uD83E\uDD47" : idx === 1 ? " \uD83E\uDD48" : idx === 2 ? " \uD83E\uDD49" : "";
        return (
          `<tr>` +
          `<td class="text-center fw-bold mono">${medal || idx + 1}</td>` +
          `<td style="font-size:.85rem">${nameCell}</td>` +
          `<td class="text-center mono">${p.invites_sent}</td>` +
          `<td class="text-center"><span class="badge text-bg-success">${p.invites_accepted}</span></td>` +
          `<td class="text-center"><span class="badge text-bg-danger">${p.invites_declined}</span></td>` +
          `<td class="text-center mono">${convRate}</td>` +
          `<td class="text-center mono">${p.referral_clicks}</td>` +
          `<td class="text-center"><span class="badge text-bg-primary">${p.referral_conversions}</span></td>` +
          `<td class="text-center fw-semibold">${p.impact_score}</td>` +
          `<td class="mono small text-muted">${p.last_invite_at ? fmt(p.last_invite_at) : "—"}</td>` +
          `</tr>`
        );
      });

      // ── Referral code details table ─────────────────────────────────────
      const codeRows = d.referralCodes.map((rc) => {
        const ownerName = [rc.owner_first_name, rc.owner_last_name].filter(Boolean).join(" ");
        const ownerDisplay = rc.owner_email
          ? (ownerName
              ? `${esc(ownerName)}<br><span class="mono text-muted" style="font-size:.72rem">${esc(rc.owner_email)}</span>`
              : `<span class="mono">${esc(rc.owner_email)}</span>`)
          : `<span class="text-muted fst-italic">${esc(rc.owner_type)}:${esc(rc.owner_id.slice(0, 8))}</span>`;
        const clickBar = rc.clicks > 0
          ? `<div class="bar-track" style="display:inline-block;width:80px;vertical-align:middle"><div class="bar-fill" style="width:${Math.min(100, rc.clicks * 5)}%;background:#3b82f6"></div></div> ${rc.clicks}`
          : "0";
        return (
          `<tr>` +
          `<td class="mono fw-semibold">${esc(rc.code)}</td>` +
          `<td style="font-size:.82rem">${ownerDisplay}</td>` +
          `<td class="text-muted small">${esc(rc.channel_hint ?? "—")}</td>` +
          `<td>${clickBar}</td>` +
          `<td class="text-center"><span class="badge text-bg-primary">${rc.conversions}</span></td>` +
          `<td class="mono small">${fmt(rc.created_at)}</td>` +
          `</tr>`
        );
      });

      // ── Click timeline ──────────────────────────────────────────────────
      const timelineHtml = d.clickTimeline.length > 0
        ? tbl(
            ["Date", "Clicks"],
            d.clickTimeline.map((row) =>
              `<tr><td class="mono">${esc(row.date)}</td><td class="mono">${row.clicks}</td></tr>`,
            ),
            "No clicks yet",
          )
        : '<p class="text-muted fst-italic small">No referral link clicks recorded in the last 30 days.</p>';

      body.innerHTML =
        '<h6 class="text-uppercase small fw-bold text-muted mb-2">Top Promoters &amp; Inviters</h6>' +
        tbl(
          ["#", "Person", "Sent", "Accepted", "Declined", "Conv. Rate", "Link Clicks", "Link Conv.", "Impact", "Last Invite"],
          promoterRows,
          "No invite or referral activity yet — send invites or share referral links to see data here.",
        ) +
        '<hr class="my-3">' +
        '<h6 class="text-uppercase small fw-bold text-muted mb-2">Referral Links</h6>' +
        tbl(
          ["Code", "Owner", "Channel", "Clicks", "Registrations", "Created"],
          codeRows,
          "No referral codes generated for this event yet.",
        ) +
        '<hr class="my-3">' +
        '<h6 class="text-uppercase small fw-bold text-muted mb-2">Click Activity (last 30 days)</h6>' +
        timelineHtml;
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  };

  // Wire refresh button once
  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.promoWired) {
    bodyEl.dataset.promoWired = "1";
    refreshBtn?.addEventListener("click", () => void doLoad());
  }

  await doLoad();
}

// ── Proposals tab ───────────────────────────────────────────────────────────

function proposalsTabHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<label class="form-label mb-0 small fw-semibold" for="proposal-filter">Status</label>' +
      '<select class="form-select form-select-sm" id="proposal-filter" style="width:auto">' +
        '<option value="">All</option>' +
        '<option value="submitted">Submitted</option>' +
        '<option value="under_review">Under Review</option>' +
        '<option value="accepted">Accepted</option>' +
        '<option value="rejected">Rejected</option>' +
        '<option value="needs_work">Needs Work</option>' +
        '<option value="withdrawn">Withdrawn</option>' +
      '</select>' +
      '<input class="form-control form-control-sm" id="proposal-search" type="search" placeholder="Search title or proposer" style="max-width:300px">' +
      '<button class="btn btn-sm btn-outline-secondary" id="proposal-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="proposal-list-body">' + spinner() + '</div>' +
    '<div id="proposal-list-pager" class="mt-2"></div>' +
    '<div id="proposal-detail" class="mt-3"></div>'
  );
}

async function loadEventProposals(slug: string): Promise<void> {
  const body = q("#proposal-list-body");
  const pager = q("#proposal-list-pager");
  if (!body) return;
  if (pager) pager.innerHTML = "";

  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const fetchAndRender = async (): Promise<void> => {
    body.innerHTML = spinner();
    try {
      const filter = q<HTMLSelectElement>("#proposal-filter")?.value ?? "";
      const search = (q<HTMLInputElement>("#proposal-search")?.value ?? "").trim().toLowerCase();
      const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (filter) query.set("status", filter);
      if (search) query.set("search", search);

      const response = await api<{
        proposals: ProposalSummary[];
        permissions?: ProposalAccess;
        page?: { limit: number; offset: number; hasMore: boolean; total: number };
      }>(`/api/v1/admin/events/${slug}/proposals?${query.toString()}`);
      const access: ProposalAccess = response.permissions ?? { eventPermissions: [], canReview: true, canFinalize: true };
      _proposalAccessByEventSlug[slug] = access;
      const proposals = response.proposals ?? [];

      const rows = proposals.map((proposal) => {
        const proposerName = [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ");
        const proposerLabel = proposerName
          ? `${esc(proposerName)}<br><span class="mono text-muted" style="font-size:.72rem">${esc(proposal.proposer_email)}</span>`
          : `<span class="mono">${esc(proposal.proposer_email)}</span>`;
        const decisionLabel = proposal.decision_status
          ? `${badge(proposal.decision_status)}<div class="small text-muted">${fmt(proposal.decision_decided_at)}</div>`
          : '<span class="text-muted small">Not finalized</span>';
        return (
          `<tr>` +
          `<td><div class="fw-semibold">${esc(proposal.title)}</div><div class="small text-muted">${esc(proposal.proposal_type)}</div></td>` +
          `<td>${proposerLabel}</td>` +
          `<td>${badge(proposal.status)}</td>` +
          `<td class="mono text-center">${Number(proposal.review_count ?? 0)}</td>` +
          `<td>${decisionLabel}</td>` +
          `<td class="mono">${fmt(proposal.submitted_at)}</td>` +
          `<td><button class="btn btn-sm btn-outline-primary" data-open-proposal="${esc(proposal.id)}">${access.canReview ? "Review" : "View"}</button></td>` +
          `</tr>`
        );
      });

      body.innerHTML = tbl(
        ["Proposal", "Proposer", "Status", "Reviews", "Decision", "Submitted", ""],
        rows,
        "No proposals match the current filters",
      );

      const pageOffset = response.page?.offset ?? offset;
      const pageLimit = response.page?.limit ?? pageSize;
      const hasMore = response.page?.hasMore ?? false;
      const pageTotal = response.page?.total ?? 0;
      const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

      if (pager) {
        pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, proposals.length, pageTotal);
        pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
          offset = Math.max(0, pageOffset - pageLimit);
          void fetchAndRender();
        });
        pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
          offset = pageOffset + pageLimit;
          void fetchAndRender();
        });
        pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const page = Number(btn.dataset.pageJump || "1");
            if (!Number.isFinite(page) || page < 1) return;
            offset = (page - 1) * pageLimit;
            void fetchAndRender();
          });
        });
        pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
          const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
          if (!Number.isFinite(nextSize) || nextSize < 1) return;
          pageSize = nextSize;
          offset = 0;
          void fetchAndRender();
        });
      }

      body.querySelectorAll<HTMLButtonElement>("[data-open-proposal]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const proposal = (response.proposals ?? []).find((p) => p.id === btn.dataset.openProposal);
          if (!proposal) return;
          void loadProposalDetail(slug, proposal, access);
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
      if (pager) pager.innerHTML = "";
    }
  };

  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.proposalWired) {
    bodyEl.dataset.proposalWired = "1";
    q("#proposal-refresh")?.addEventListener("click", () => {
      offset = 0;
      void fetchAndRender();
    });
    q("#proposal-filter")?.addEventListener("change", () => {
      offset = 0;
      void fetchAndRender();
    });
    q("#proposal-search")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        event.preventDefault();
        offset = 0;
        void fetchAndRender();
      }
    });
  }

  await fetchAndRender();
}

async function loadProposalDetail(slug: string, proposal: ProposalSummary, access: ProposalAccess): Promise<void> {
  const detail = q("#proposal-detail");
  if (!detail) return;
  detail.innerHTML = spinner();

  try {
    const [reviewsResp, speakersResp] = await Promise.all([
      api<{ reviews: ProposalReview[] }>(`/api/v1/admin/proposals/${proposal.id}/reviews`),
      api<{ speakers: ProposalSpeaker[]; summary: { confirmed: number; total: number; profileComplete: number } }>(
        `/api/v1/admin/proposals/${proposal.id}/speakers`,
      ),
    ]);

    const reviews = reviewsResp.reviews ?? [];
    const speakers = speakersResp.speakers ?? [];
    const ownReview = reviews.find((r) => r.reviewer_email?.toLowerCase() === (_email ?? "").toLowerCase()) ?? null;

    const speakerRows = speakers.map((speaker) => {
      const displayName = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ");
      const roleLabel = speaker.role === "proposer" && speaker.hasBio ? "proposer / speaker" : speaker.role;
      return (
        `<tr>` +
        `<td>${displayName ? esc(displayName) : '<span class="text-muted">—</span>'}<br><span class="mono text-muted small">${esc(speaker.email)}</span></td>` +
        `<td>${badge(roleLabel)}</td>` +
        `<td>${badge(speaker.status)}</td>` +
        `<td>${speaker.hasBio ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'}</td>` +
        `<td>${speaker.hasHeadshot ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'}</td>` +
        `</tr>`
      );
    });

    const reviewRows = reviews.map((review) => {
      const reviewerName = [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ");
      const who = reviewerName || review.reviewer_email || review.reviewer_user_id;
      return (
        `<tr>` +
        `<td>${esc(who)}</td>` +
        `<td>${badge(review.recommendation)}</td>` +
        `<td class="mono">${review.score ?? "—"}</td>` +
        `<td class="small">${esc(review.reviewer_comment ?? "—")}</td>` +
        `<td class="mono">${fmt(review.updated_at)}</td>` +
        `</tr>`
      );
    });

    detail.innerHTML =
      '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
        `<div><div class="fw-semibold">${esc(proposal.title)}</div>` +
        `<div class="small text-muted">${esc(proposal.proposal_type)} · ${badge(proposal.status)}</div></div>` +
        '<button class="btn btn-sm btn-outline-secondary" id="btn-close-proposal-detail">Close</button>' +
      '</div>' +
      '<div class="card-body">' +
        `<p class="small mb-2"><strong>Abstract:</strong><br>${esc(proposal.abstract)}</p>` +
        '<div class="row g-3 mb-3">' +
          '<div class="col-md-6">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-2">Speakers</h6>' +
            `<div class="small text-muted mb-2">Confirmed ${speakersResp.summary?.confirmed ?? 0}/${speakersResp.summary?.total ?? speakers.length}, Profiles complete ${speakersResp.summary?.profileComplete ?? 0}</div>` +
            tbl(["Speaker", "Role", "Status", "Bio", "Headshot"], speakerRows, "No speakers linked") +
          '</div>' +
          '<div class="col-md-6">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-2">Committee Reviews</h6>' +
            tbl(["Reviewer", "Recommendation", "Score", "Comment", "Updated"], reviewRows, "No reviews submitted") +
          '</div>' +
        '</div>' +

        '<div class="row g-3">' +
          '<div class="col-md-6">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-2">My Review</h6>' +
            (access.canReview
              ? '<div class="card border"><div class="card-body">' +
                  `<div class="small text-muted mb-2">${ownReview ? `Review last updated ${esc(fmt(ownReview.updated_at))}.` : "No review submitted yet."}</div>` +
                  '<div class="d-flex align-items-center gap-2 mb-2">' +
                    `<button class="btn btn-sm btn-outline-primary" id="btn-proposal-toggle-review-form">${ownReview ? "Edit My Review" : "Add My Review"}</button>` +
                    '<span class="small" id="proposal-review-status"></span>' +
                  '</div>' +
                  '<div class="d-none" id="proposal-review-form-wrap">' +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Recommendation</label>' +
                      `<select class="form-select form-select-sm" id="proposal-review-recommendation">` +
                        `<option value="accept"${ownReview?.recommendation === "accept" ? " selected" : ""}>Accept</option>` +
                        `<option value="needs-work"${ownReview?.recommendation === "needs-work" ? " selected" : ""}>Needs Work</option>` +
                        `<option value="reject"${ownReview?.recommendation === "reject" ? " selected" : ""}>Reject</option>` +
                      '</select></div>' +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1" for="proposal-review-score">Score <span class="text-muted" id="proposal-review-score-value">' +
                      `${esc(ownReview?.score ?? 5)}/10` +
                    '</span></label>' +
                      `<input class="form-range" id="proposal-review-score" type="range" min="1" max="10" step="1" value="${esc(ownReview?.score ?? 5)}" aria-describedby="proposal-review-score-value"></div>` +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Committee Comment</label>' +
                      `<textarea class="form-control form-control-sm" id="proposal-review-comment" rows="4">${esc(ownReview?.reviewer_comment ?? "")}</textarea></div>` +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Applicant Note (optional)</label>' +
                      `<textarea class="form-control form-control-sm" id="proposal-review-applicant-note" rows="3">${esc(ownReview?.applicant_note ?? "")}</textarea></div>` +
                    '<div class="d-flex align-items-center gap-2">' +
                      '<button class="btn btn-sm btn-primary" id="btn-proposal-save-review">Save Review</button>' +
                      '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-cancel-review-form">Cancel</button>' +
                    '</div>' +
                  '</div>' +
                '</div></div>'
              : '<div class="card border"><div class="card-body small text-muted">You do not have permission to submit committee reviews for this event.</div></div>') +
          '</div>' +

          '<div class="col-md-6">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-2">Finalize Decision</h6>' +
            (access.canFinalize
              ? '<div class="card border"><div class="card-body">' +
                  '<div class="small text-muted mb-2">Use this when the committee reached final consensus. Policy review threshold is enforced automatically.</div>' +
                  '<div class="d-flex align-items-center gap-2 mb-2">' +
                    '<button class="btn btn-sm btn-outline-success" id="btn-proposal-toggle-finalize-form">Open Finalize Form</button>' +
                    '<span class="small" id="proposal-finalize-status"></span>' +
                  '</div>' +
                  '<div class="d-none" id="proposal-finalize-form-wrap">' +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Final status</label>' +
                      '<select class="form-select form-select-sm" id="proposal-final-status">' +
                        '<option value="accepted">Accepted</option>' +
                        '<option value="needs_work">Needs Work</option>' +
                        '<option value="rejected">Rejected</option>' +
                      '</select></div>' +
                    '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Decision note</label>' +
                      '<textarea class="form-control form-control-sm" id="proposal-final-note" rows="3" placeholder="Optional summary for proposer"></textarea></div>' +
                    '<div class="row g-2 mb-1">' +
                      '<div class="col-md-6 d-none" id="proposal-presentation-deadline-wrap"><label class="form-label small fw-semibold mb-1">Presentation deadline (accepted only)</label>' +
                        '<input class="form-control form-control-sm" id="proposal-presentation-deadline" type="datetime-local"></div>' +
                    '</div>' +
                    '<div class="small text-muted mb-2">Presentation deadline is optional and only used when status is Accepted.</div>' +
                    '<div class="form-check mb-2">' +
                      '<input class="form-check-input" type="checkbox" id="proposal-final-confirm">' +
                      '<label class="form-check-label small" for="proposal-final-confirm">I confirm this is the final committee decision for this proposal.</label>' +
                    '</div>' +
                    '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                      '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-preview-finalize">Preview</button>' +
                      '<button class="btn btn-sm btn-success" id="btn-proposal-finalize" disabled>Finalize Decision</button>' +
                      '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-cancel-finalize-form">Cancel</button>' +
                    '</div>' +
                  '</div>' +
                '</div></div>'
              : '<div class="card border"><div class="card-body small text-muted">Only organizers can finalize proposal decisions for this event.</div></div>') +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div>';

    q("#btn-close-proposal-detail")?.addEventListener("click", () => {
      const el = q("#proposal-detail");
      if (el) el.innerHTML = "";
    });

    const reviewFormWrap = q("#proposal-review-form-wrap");
    const toggleReviewFormBtn = q<HTMLButtonElement>("#btn-proposal-toggle-review-form");
    q("#btn-proposal-toggle-review-form")?.addEventListener("click", () => {
      const hidden = reviewFormWrap?.classList.contains("d-none") ?? true;
      if (hidden) {
        show(reviewFormWrap);
        if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = "Hide Review Form";
      } else {
        hide(reviewFormWrap);
        if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = ownReview ? "Edit My Review" : "Add My Review";
      }
    });

    q("#btn-proposal-cancel-review-form")?.addEventListener("click", () => {
      hide(reviewFormWrap);
      if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = ownReview ? "Edit My Review" : "Add My Review";
    });

    q("#btn-proposal-save-review")?.addEventListener("click", async () => {
      const statusEl = q("#proposal-review-status");
      const recommendation = q<HTMLSelectElement>("#proposal-review-recommendation")?.value ?? "accept";
      const scoreRaw = q<HTMLInputElement>("#proposal-review-score")?.value.trim() ?? "";
      const reviewerComment = q<HTMLTextAreaElement>("#proposal-review-comment")?.value.trim() ?? "";
      const applicantNote = q<HTMLTextAreaElement>("#proposal-review-applicant-note")?.value.trim() ?? "";
      try {
        if (statusEl) { statusEl.textContent = "Saving…"; statusEl.className = "small text-muted"; }
        await api(`/api/v1/admin/proposals/${proposal.id}/reviews`, {
          method: "POST",
          body: JSON.stringify({
            recommendation,
            score: scoreRaw ? Number(scoreRaw) : undefined,
            reviewerComment: reviewerComment || undefined,
            applicantNote: applicantNote || undefined,
          }),
        });
        if (statusEl) { statusEl.textContent = "Saved"; statusEl.className = "small text-success"; }
        toast("Proposal review saved", "success");
        await loadProposalDetail(slug, proposal, access);
        await loadEventProposals(slug);
      } catch (err) {
        if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
        toast((err as Error).message, "error");
      }
    });

    const reviewScoreEl = q<HTMLInputElement>("#proposal-review-score");
    const reviewScoreValueEl = q("#proposal-review-score-value");
    const syncReviewScoreValue = (): void => {
      const value = reviewScoreEl?.value ?? "5";
      if (reviewScoreValueEl) reviewScoreValueEl.textContent = `${value}/10`;
    };
    reviewScoreEl?.addEventListener("input", syncReviewScoreValue);
    syncReviewScoreValue();

    const finalStatusSelect = q<HTMLSelectElement>("#proposal-final-status");
    const finalizeFormWrap = q("#proposal-finalize-form-wrap");
    const toggleFinalizeFormBtn = q<HTMLButtonElement>("#btn-proposal-toggle-finalize-form");
    const deadlineWrap = q("#proposal-presentation-deadline-wrap");
    const finalConfirm = q<HTMLInputElement>("#proposal-final-confirm");
    const finalizeBtn = q<HTMLButtonElement>("#btn-proposal-finalize");
    const previewFinalizeBtn = q<HTMLButtonElement>("#btn-proposal-preview-finalize");
    const finalizeStatusEl = q("#proposal-finalize-status");

    q("#btn-proposal-toggle-finalize-form")?.addEventListener("click", () => {
      const hidden = finalizeFormWrap?.classList.contains("d-none") ?? true;
      if (hidden) {
        show(finalizeFormWrap);
        if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Hide Finalize Form";
      } else {
        hide(finalizeFormWrap);
        if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Open Finalize Form";
      }
    });

    q("#btn-proposal-cancel-finalize-form")?.addEventListener("click", () => {
      hide(finalizeFormWrap);
      if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Open Finalize Form";
    });

    const syncFinalizeVisibility = (): void => {
      const isAccepted = finalStatusSelect?.value === "accepted";
      if (isAccepted) show(deadlineWrap); else hide(deadlineWrap);
    };

    const syncFinalizeEnabled = (): void => {
      if (finalizeBtn) finalizeBtn.disabled = !(finalConfirm?.checked);
    };

    finalStatusSelect?.addEventListener("change", syncFinalizeVisibility);
    finalConfirm?.addEventListener("change", syncFinalizeEnabled);
    syncFinalizeVisibility();
    syncFinalizeEnabled();

    previewFinalizeBtn?.addEventListener("click", () => {
      const finalStatus = finalStatusSelect?.value ?? "accepted";
      const deadlineRaw = q<HTMLInputElement>("#proposal-presentation-deadline")?.value.trim() ?? "";
      const deadlineLabel = finalStatus === "accepted"
        ? (deadlineRaw ? new Date(deadlineRaw).toLocaleString("en-GB") : "event default / none")
        : "not applicable";
      if (finalizeStatusEl) {
        finalizeStatusEl.textContent = `Preview: status ${finalStatus}, policy reviews enforced, deadline ${deadlineLabel}.`;
        finalizeStatusEl.className = "small text-muted";
      }
    });

    q("#btn-proposal-finalize")?.addEventListener("click", async () => {
      const statusEl = q("#proposal-finalize-status");
      const finalStatus = q<HTMLSelectElement>("#proposal-final-status")?.value ?? "accepted";
      const decisionNote = q<HTMLTextAreaElement>("#proposal-final-note")?.value.trim() ?? "";
      const deadlineRaw = q<HTMLInputElement>("#proposal-presentation-deadline")?.value.trim() ?? "";
      try {
        if (!finalConfirm?.checked) {
          if (statusEl) {
            statusEl.textContent = "Please confirm the final decision checkbox first.";
            statusEl.className = "small text-danger";
          }
          return;
        }

        const ok = window.confirm(
          `Finalize proposal as "${finalStatus}"? This action records a final committee decision and sends decision emails.`,
        );
        if (!ok) return;

        if (statusEl) { statusEl.textContent = "Finalizing…"; statusEl.className = "small text-muted"; }
        await api(`/api/v1/admin/proposals/${proposal.id}/finalize`, {
          method: "POST",
          body: JSON.stringify({
            finalStatus,
            decisionNote: decisionNote || undefined,
            presentationDeadline: finalStatus === "accepted" && deadlineRaw
              ? new Date(deadlineRaw).toISOString()
              : undefined,
          }),
        });
        if (statusEl) { statusEl.textContent = "Finalized"; statusEl.className = "small text-success"; }
        toast("Proposal decision finalized", "success");
        await loadEventProposals(slug);
      } catch (err) {
        if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
        toast((err as Error).message, "error");
      }
    });
  } catch (err) {
    detail.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

// ── Admin invite parser (mirrors user-facing logic) ─────────────────────────

function adminCapWord(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function parseAdminInviteText(raw: string): AdminInviteEntry[] {
  const results: AdminInviteEntry[] = [];
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // "First Last" <email>  or  First Last <email>
    const angleBracket = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
    if (angleBracket) {
      const namePart = angleBracket[1].trim();
      const email = angleBracket[2].trim().toLowerCase();
      if (!email.includes("@")) continue;
      const entry: AdminInviteEntry = { email };
      if (namePart) {
        const parts = namePart.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) { entry.firstName = parts[0]; entry.lastName = parts.slice(1).join(" "); }
        else if (parts.length === 1) { entry.firstName = parts[0]; }
      }
      results.push(entry);
      continue;
    }
    // CSV: three comma-separated values where last looks like email
    const csv = line.split(",").map((s) => s.trim());
    if (csv.length === 3 && csv[2].includes("@") && !csv[2].includes(" ")) {
      results.push({ firstName: csv[0] || undefined, lastName: csv[1] || undefined, email: csv[2].toLowerCase() });
      continue;
    }
    // Plain email(s) separated by commas/semicolons
    for (const atom of line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
      if (!atom.includes("@")) continue;
      const entry: AdminInviteEntry = { email: atom.toLowerCase() };
      const local = atom.split("@")[0];
      const dotParts = local.split(".").filter(Boolean);
      if (dotParts.length >= 2) {
        entry.firstName = adminCapWord(dotParts[0]);
        entry.lastName = adminCapWord(dotParts.slice(1).join(" "));
      }
      results.push(entry);
    }
  }
  const seen = new Set<string>();
  return results.filter((e) => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });
}

function parseAdminCsv(text: string): AdminInviteEntry[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  // Detect header row: first line with no '@' and contains commas
  let dataStart = 0;
  const header = lines[0].toLowerCase();
  const colEmail = header.includes("email") ? header.split(",").findIndex((c) => c.includes("email")) : -1;
  const colFirst = header.split(",").findIndex((c) => c.includes("first"));
  const colLast  = header.split(",").findIndex((c) => c.includes("last"));
  if (colEmail !== -1) { dataStart = 1; } // has header
  const results: AdminInviteEntry[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (colEmail !== -1) {
      const email = parts[colEmail]?.toLowerCase();
      if (!email?.includes("@")) continue;
      results.push({
        email,
        firstName: colFirst !== -1 ? (parts[colFirst] || undefined) : undefined,
        lastName:  colLast  !== -1 ? (parts[colLast]  || undefined) : undefined,
      });
    } else {
      // No header: treat as plain text
      const parsed = parseAdminInviteText(lines[i]);
      results.push(...parsed);
    }
  }
  return results;
}

// ── Admin invite row management ──────────────────────────────────────────────

const MAX_ADMIN_INVITES = 500;
let _invitePreviewState: { token: string; digest: string; expiresAt: string } | null = null;
const _emailPreviewTokens = new Map<string, string | null>();

function syncInviteCount(): void {
  const rows = document.querySelectorAll("#inv-rows .inv-row");
  const lbl = q("#inv-count-lbl");
  if (lbl) lbl.textContent = rows.length > 0 ? `${rows.length} row${rows.length !== 1 ? "s" : ""}` : "";
}

function collectAdminInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
  const container = q("#inv-rows");
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(".inv-row"))
    .map((row) => ({
      email: (row.querySelector<HTMLInputElement>("[data-inv-email]")?.value ?? "").trim(),
      firstName: (row.querySelector<HTMLInputElement>("[data-inv-first]")?.value ?? "").trim() || undefined,
      lastName: (row.querySelector<HTMLInputElement>("[data-inv-last]")?.value ?? "").trim() || undefined,
    }))
    .filter((item) => item.email);
}

function invitePreviewDigest(invites: Array<{ email: string; firstName?: string; lastName?: string; sourceType?: string }>): string {
  const normalized = invites.map((item) => ({
    email: item.email.trim().toLowerCase(),
    firstName: (item.firstName ?? "").trim(),
    lastName: (item.lastName ?? "").trim(),
    sourceType: (item.sourceType ?? "").trim(),
  }));
  return JSON.stringify(normalized);
}

function setInvitePreviewTab(tab: "html" | "text"): void {
  const htmlBtn = q<HTMLButtonElement>("#inv-prev-tab-html");
  const textBtn = q<HTMLButtonElement>("#inv-prev-tab-text");
  const htmlWrap = q("#inv-prev-html-wrap");
  const textWrap = q("#inv-preview-text");
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

function invalidateInvitePreview(message = "Preview required before sending."): void {
  _invitePreviewState = null;
  const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
  if (sendBtn) sendBtn.disabled = true;

  const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");
  if (previewConfirm) previewConfirm.checked = false;

  const previewPanel = q("#inv-preview-panel");
  hide(previewPanel);

  const statusEl = q("#inv-preview-status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = "mt-1 small text-muted";
  }
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

function makeAdminInviteRow(entry?: AdminInviteEntry): HTMLElement {
  const div = document.createElement("div");
  div.className = "inv-row d-flex gap-1 mb-1 align-items-center";
  div.innerHTML =
    `<input class="form-control form-control-sm" style="flex:1.2" type="text"
      placeholder="First (opt.)" data-inv-first autocomplete="off"
      value="${esc(entry?.firstName ?? "")}">` +
    `<input class="form-control form-control-sm" style="flex:1.2" type="text"
      placeholder="Last (opt.)" data-inv-last autocomplete="off"
      value="${esc(entry?.lastName ?? "")}">` +
    `<input class="form-control form-control-sm" style="flex:2" type="email"
      placeholder="email@example.com" data-inv-email autocomplete="off"
      value="${esc(entry?.email ?? "")}">` +
    '<button type="button" class="btn btn-sm btn-outline-danger p-0 px-1 inv-remove-btn' +
    '" title="Remove row" style="flex:none;height:1.75rem;line-height:1">&times;</button>';
  div.querySelector<HTMLButtonElement>(".inv-remove-btn")?.addEventListener("click", () => {
    div.remove();
    syncInviteCount();
  });
  // Inline paste detection in the email field
  div.querySelector<HTMLInputElement>("[data-inv-email]")?.addEventListener("paste", (e) => {
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
    e.preventDefault();
    const entries = parseAdminInviteText(pasted);
    if (!entries.length) return;
    const firstEl = div.querySelector<HTMLInputElement>("[data-inv-first]");
    const lastEl  = div.querySelector<HTMLInputElement>("[data-inv-last]");
    const emailEl = div.querySelector<HTMLInputElement>("[data-inv-email]");
    if (firstEl) firstEl.value = entries[0].firstName ?? "";
    if (lastEl)  lastEl.value  = entries[0].lastName  ?? "";
    if (emailEl) emailEl.value = entries[0].email;
    for (const extra of entries.slice(1)) addAdminInviteRow(extra);
    syncInviteCount();
  });
  return div;
}

function addAdminInviteRow(entry?: AdminInviteEntry): void {
  const container = q("#inv-rows");
  if (!container) return;
  if (container.querySelectorAll(".inv-row").length >= MAX_ADMIN_INVITES) return;
  container.appendChild(makeAdminInviteRow(entry));
  syncInviteCount();
  invalidateInvitePreview();
}

function addParsedAdminEntries(entries: AdminInviteEntry[]): void {
  const container = q("#inv-rows");
  if (!container) return;
  // Fill existing empty rows first
  const existingRows = Array.from(container.querySelectorAll<HTMLElement>(".inv-row"));
  let idx = 0;
  for (const row of existingRows) {
    if (idx >= entries.length) break;
    const emailEl = row.querySelector<HTMLInputElement>("[data-inv-email]");
    if (emailEl && !emailEl.value.trim()) {
      const firstEl = row.querySelector<HTMLInputElement>("[data-inv-first]");
      const lastEl  = row.querySelector<HTMLInputElement>("[data-inv-last]");
      if (firstEl) firstEl.value = entries[idx].firstName ?? "";
      if (lastEl)  lastEl.value  = entries[idx].lastName  ?? "";
      emailEl.value = entries[idx].email;
      idx++;
    }
  }
  for (; idx < entries.length; idx++) addAdminInviteRow(entries[idx]);
  syncInviteCount();
}

function wireInviteForm(slug: string): void {
  _invitePreviewState = null;

  // Start with one empty row
  addAdminInviteRow();

  const rowContainer = q("#inv-rows");
  rowContainer?.addEventListener("input", () => invalidateInvitePreview());

  q("#inv-prev-tab-html")?.addEventListener("click", () => setInvitePreviewTab("html"));
  q("#inv-prev-tab-text")?.addEventListener("click", () => setInvitePreviewTab("text"));
  q<HTMLInputElement>("#inv-preview-confirm")?.addEventListener("change", (event) => {
    const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
    if (!sendBtn) return;
    const checked = (event.target as HTMLInputElement).checked;
    sendBtn.disabled = !checked || !_invitePreviewState;
  });

  // Parse button
  q("#inv-parse-btn")?.addEventListener("click", () => {
    const text = q<HTMLTextAreaElement>("#inv-paste")?.value ?? "";
    const entries = parseAdminInviteText(text);
    if (!entries.length) { toast("No valid email addresses found in the pasted text", "error"); return; }
    addParsedAdminEntries(entries);
    const ta = q<HTMLTextAreaElement>("#inv-paste");
    if (ta) ta.value = "";
    invalidateInvitePreview();
    toast(`Parsed ${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`, "success");
  });

  // Auto-parse on paste into the textarea
  q<HTMLTextAreaElement>("#inv-paste")?.addEventListener("paste", () => {
    setTimeout(() => {
      const ta = q<HTMLTextAreaElement>("#inv-paste");
      if (!ta?.value.trim()) return;
      const entries = parseAdminInviteText(ta.value);
      if (!entries.length) return;
      addParsedAdminEntries(entries);
      ta.value = "";
      syncInviteCount();
      invalidateInvitePreview();
    }, 0);
  });

  // CSV file upload
  q<HTMLInputElement>("#inv-csv")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string ?? "";
      const entries = parseAdminCsv(text);
      if (!entries.length) { toast("No valid rows found in CSV", "error"); return; }
      addParsedAdminEntries(entries);
      invalidateInvitePreview();
      toast(`Imported ${entries.length} row${entries.length !== 1 ? "s" : ""} from CSV`, "success");
      (e.target as HTMLInputElement).value = "";
    };
    reader.readAsText(file);
  });

  // Add row button
  q("#inv-add-btn")?.addEventListener("click", () => addAdminInviteRow());

  // Preview button
  q("#inv-preview-btn")?.addEventListener("click", () => void doAdminInvitePreview(slug));

  // Send button
  q("#inv-send-btn")?.addEventListener("click", () => void doAdminInvite(slug));
}

async function doAdminInvitePreview(slug: string): Promise<void> {
  const invites = collectAdminInvites();
  const statusEl = q("#inv-preview-status");
  const btn = q<HTMLButtonElement>("#inv-preview-btn");
  const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
  const previewPanel = q("#inv-preview-panel");
  const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");

  if (!invites.length) {
    if (statusEl) {
      statusEl.textContent = "Add at least one invitee before previewing.";
      statusEl.className = "mt-1 small text-danger";
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Rendering...";
  }
  if (sendBtn) sendBtn.disabled = true;
  if (previewConfirm) previewConfirm.checked = false;
  hide(previewPanel);
  if (statusEl) {
    statusEl.textContent = "Rendering preview...";
    statusEl.className = "mt-1 small text-muted";
  }

  try {
    const result = await api<{
      previewToken: string;
      previewExpiresAt: string;
      recipientCount: number;
      subject: string;
      html: string;
      text: string;
    }>(`/api/v1/admin/events/${slug}/invites/attendees/preview`, {
      method: "POST",
      body: JSON.stringify({ invites }),
    });

    _invitePreviewState = {
      token: result.previewToken,
      digest: invitePreviewDigest(invites),
      expiresAt: result.previewExpiresAt,
    };

    const previewSubject = q("#inv-preview-subject");
    const previewHtml = q<HTMLIFrameElement>("#inv-preview-html");
    const previewText = q<HTMLElement>("#inv-preview-text");
    if (previewSubject) previewSubject.textContent = result.subject;
    if (previewHtml) previewHtml.srcdoc = result.html;
    if (previewText) previewText.textContent = result.text;
    setInvitePreviewTab("html");
    show(previewPanel);

    // Explicit confirmation is required after preview is rendered.
    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) {
      const expiresAt = new Date(result.previewExpiresAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
      statusEl.textContent = `Preview ready for ${result.recipientCount} invitee(s). Review it and confirm before sending. Expires at ${expiresAt}.`;
      statusEl.className = "mt-1 small text-success";
    }
    toast("Invite preview rendered. Confirm after reviewing to enable send.", "success");
  } catch (err) {
    _invitePreviewState = null;
    hide(previewPanel);
    if (statusEl) {
      statusEl.textContent = (err as Error).message;
      statusEl.className = "mt-1 small text-danger";
    }
    toast((err as Error).message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Preview Email";
    }
  }
}

async function doAdminInvite(slug: string): Promise<void> {
  const container = q("#inv-rows");
  const statusEl = q("#inv-form-status");
  if (!container) return;

  const invites = collectAdminInvites();

  if (!invites.length) {
    if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
    return;
  }

  const currentDigest = invitePreviewDigest(invites);
  if (!_invitePreviewState || _invitePreviewState.digest !== currentDigest) {
    if (statusEl) {
      statusEl.textContent = "Preview required. Render a fresh preview before sending.";
      statusEl.className = "mt-2 small text-danger";
    }
    invalidateInvitePreview();
    return;
  }

  const previewConfirm = q<HTMLInputElement>("#inv-preview-confirm");
  if (!previewConfirm?.checked) {
    if (statusEl) {
      statusEl.textContent = "Review and confirm the preview before sending.";
      statusEl.className = "mt-2 small text-danger";
    }
    return;
  }

  const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending..."; }
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    const r = await api<{ created?: unknown[] }>(`/api/v1/admin/events/${slug}/invites/attendees/bulk`, {
      method: "POST",
      body: JSON.stringify({ invites, previewToken: _invitePreviewState.token }),
    });
    const count = r.created?.length ?? invites.length;
    toast(`Sent ${count} invite${count !== 1 ? "s" : ""}`, "success");
    _invitePreviewState = null;
    if (container) {
      container.innerHTML = "";
      addAdminInviteRow();
      syncInviteCount();
    }
    invalidateInvitePreview();
    if (statusEl) { statusEl.textContent = `✓ ${count} invitation${count !== 1 ? "s" : ""} queued.`; statusEl.className = "mt-2 small text-success"; }
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send Invites"; }
  }
}

// ── Invite badge (separate from email outbox badge colours) ─────────────────────

function inviteBadge(status: string): string {
  const map: Record<string, [string, string]> = {
    sent:     ["info",      "Pending"],
    accepted: ["success",   "Accepted"],
    declined: ["danger",    "Declined"],
    expired:  ["secondary", "Expired"],
    revoked:  ["warning",   "Revoked"],
  };
  const [color, label] = map[status] ?? ["secondary", status];
  return `<span class="badge text-bg-${color}">${esc(label)}</span>`;
}

const ADMIN_LIST_PAGE_SIZE_DEFAULT = 50;
const ADMIN_LIST_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
let _adminEmailOutboxState = {
  status: "",
  messageType: "",
  q: "",
  offset: 0,
  pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
};
const _adminEmailOutboxSelectedIds = new Set<string>();
let _adminJobsPreview: AdminJobsRunResponse | null = null;
let _adminJobsLastRun: AdminJobsRunResponse | null = null;
let _adminJobsState = {
  reminderLimit: 120,
  outboxLimit: 120,
  runRetention: false,
};
let _adminDueOutboxRows: AdminEmailOutboxRow[] = [];
let _adminDueWorkViewState: { tab: AdminDueWorkTab; pageSize: number; offset: number } = {
  tab: "all",
  pageSize: 25,
  offset: 0,
};

function pagerRangeText(offset: number, rowCount: number, total: number): string {
  if (total <= 0 || rowCount <= 0) {
    return "Records 0-0 of 0";
  }
  const start = offset + 1;
  const end = offset + rowCount;
  return `Records ${start}-${end} of ${total}`;
}

function visiblePagerItems(currentPage: number, maxPage: number): Array<number | "ellipsis"> {
  if (maxPage <= 7) {
    return Array.from({ length: maxPage }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, maxPage, currentPage - 1, currentPage, currentPage + 1]);

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (currentPage >= maxPage - 2) {
    pages.add(maxPage - 1);
    pages.add(maxPage - 2);
    pages.add(maxPage - 3);
  }

  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= maxPage)
    .sort((left, right) => left - right);

  const items: Array<number | "ellipsis"> = [];
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index];
    const previous = sortedPages[index - 1];
    if (previous && page - previous > 1) {
      items.push("ellipsis");
    }
    items.push(page);
  }

  return items;
}

function pagerHtml(currentPage: number, hasMore: boolean, pageSize: number, offset: number, rowCount: number, total: number): string {
  const maxPage = total > 0 ? Math.max(1, Math.ceil(total / Math.max(1, pageSize))) : 1;
  const pageButtons = visiblePagerItems(currentPage, maxPage)
    .map((item) => {
      if (item === "ellipsis") {
        return '<span class="btn btn-sm btn-link text-muted disabled" aria-hidden="true">...</span>';
      }

      const active = item === currentPage;
      return `<button type="button" class="btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}" data-page-jump="${item}"${active ? " disabled" : ""}>${item}</button>`;
    })
    .join("");

  const pageSizeOptions = ADMIN_LIST_PAGE_SIZE_OPTIONS
    .map((size) => `<option value="${size}"${size === pageSize ? " selected" : ""}>${size}</option>`)
    .join("");

  return (
    '<div class="d-flex flex-wrap gap-2 align-items-center justify-content-center">' +
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-page-prev${currentPage <= 1 ? " disabled" : ""}>Prev</button>` +
      pageButtons +
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-page-next${!hasMore ? " disabled" : ""}>Next</button>` +
      '<span class="small text-muted ms-1">Rows</span>' +
      `<select class="form-select form-select-sm" data-page-size style="width:auto">${pageSizeOptions}</select>` +
      `<span class="small text-muted ms-1">${pagerRangeText(offset, rowCount, total)}</span>` +
    '</div>'
  );
}

// ── Invite list (pending + all) ──────────────────────────────────────────────────

async function loadEventInvites(slug: string, statusFilter?: string): Promise<void> {
  const body = q("#inv-list-body");
  const pager = q("#inv-list-pager");
  if (!body) return;
  body.innerHTML = spinner();
  if (pager) pager.innerHTML = "";

  // Wire filter controls once
  const filterSel = q<HTMLSelectElement>("#inv-filter");
  const refreshBtn = q<HTMLButtonElement>("#inv-list-refresh");

  const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");
  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    const filter = getFilter();
    const query = new URLSearchParams({ type: "attendee", limit: String(pageSize), offset: String(offset) });
    if (filter) query.set("status", filter);
    const url = `/api/v1/admin/events/${slug}/invites?${query.toString()}`;
    try {
      const d = await api<{ invites: InviteRecord[]; page?: { limit: number; offset: number; hasMore: boolean; total: number } }>(url);
      const invites = d.invites ?? [];
      body.innerHTML = tbl(
        ["Invitee Email", "Invitee Name", "Invited By", "Type", "Status", "Source", "Sent", "Declined", "Decline Reason", "Note"],
        invites.map((i) => {
          const name = [i.invitee_first_name, i.invitee_last_name].filter(Boolean).join(" ") || "—";
          const inviterName = [i.inviter_first_name, i.inviter_last_name].filter(Boolean).join(" ");
          const inviterDisplay = i.inviter_email
            ? (inviterName
                ? `${esc(inviterName)}<br><span class="mono text-muted" style="font-size:.75rem">${esc(i.inviter_email)}</span>`
                : `<span class="mono">${esc(i.inviter_email)}</span>`)
            : '<span class="text-muted fst-italic">Admin</span>';
          const reasonCode = i.decline_reason_code ?? "";
          const reasonNote = i.decline_reason_note ?? "";
          const unsubIcon  = i.unsubscribe_future ? " \uD83D\uDEAB" : "";
          return (
            `<tr><td class="mono" style="font-size:.8rem">${esc(i.invitee_email)}</td>` +
            `<td>${esc(name)}</td>` +
            `<td style="font-size:.82rem">${inviterDisplay}</td>` +
            `<td class="text-muted small">${esc(i.invite_type)}</td>` +
            `<td>${inviteBadge(i.status)}</td>` +
            `<td class="text-muted small">${esc(i.source_type ?? "—")}</td>` +
            `<td class="mono">${fmt(i.created_at)}</td>` +
            `<td class="mono">${i.declined_at ? fmt(i.declined_at) : "—"}</td>` +
            `<td class="small">${reasonCode ? esc(reasonCode) + unsubIcon : "—"}</td>` +
            `<td class="small text-muted" style="max-width:200px;overflow-wrap:break-word">${reasonNote ? esc(reasonNote) : "—"}</td></tr>`
          );
        }),
        "No invites found matching the current filter",
      );

      const pageOffset = d.page?.offset ?? offset;
      const pageLimit = d.page?.limit ?? pageSize;
      const hasMore = d.page?.hasMore ?? false;
      const pageTotal = d.page?.total ?? 0;
      const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

      if (pager) {
        pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, invites.length, pageTotal);
        pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
          offset = Math.max(0, pageOffset - pageLimit);
          void doLoad();
        });
        pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
          offset = pageOffset + pageLimit;
          void doLoad();
        });
        pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const page = Number(btn.dataset.pageJump || "1");
            if (!Number.isFinite(page) || page < 1) return;
            offset = (page - 1) * pageLimit;
            void doLoad();
          });
        });
        pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
          const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
          if (!Number.isFinite(nextSize) || nextSize < 1) return;
          pageSize = nextSize;
          offset = 0;
          void doLoad();
        });
      }
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
      if (pager) pager.innerHTML = "";
    }
  };

  // Only wire once (check data attribute)
  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.invListWired) {
    bodyEl.dataset.invListWired = "1";
    filterSel?.addEventListener("change", () => {
      offset = 0;
      void doLoad();
    });
    refreshBtn?.addEventListener("click", () => {
      offset = 0;
      void doLoad();
    });
  }

  await doLoad();
}

// ── New Event form ─────────────────────────────────────────────────────────────

function newEventFormHtml(): string {
  const tzDefault = "UTC";
  return (
    `<form id="form-new-event">` +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Event Name *</label>' +
      '<input class="form-control form-control-sm" id="ne-name" type="text" placeholder="PKI Maturity Model Summit 2026" required></div>' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Slug *</label>' +
      '<input class="form-control form-control-sm" id="ne-slug" type="text" placeholder="pki-summit-2026" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" required></div>' +
    '</div>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-4"><label class="form-label small fw-semibold">Start date</label>' +
      '<input class="form-control form-control-sm" id="ne-starts" type="datetime-local"></div>' +
      '<div class="col-md-4"><label class="form-label small fw-semibold">End date</label>' +
      '<input class="form-control form-control-sm" id="ne-ends" type="datetime-local"></div>' +
      '<div class="col-md-4"><label class="form-label small fw-semibold">Timezone</label>' +
      `<input class="form-control form-control-sm" id="ne-tz" type="text" value="${esc(tzDefault)}" placeholder="UTC" required></div>` +
    '</div>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Registration Mode</label>' +
      '<select class="form-select form-select-sm" id="ne-mode">' +
        '<option value="invite_or_open">Invite or Open</option>' +
        '<option value="invite_only">Invite Only</option>' +
        '<option value="open">Open</option>' +
      '</select></div>' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Invite Limit</label>' +
      '<input class="form-control form-control-sm" id="ne-invlim" type="number" value="5" min="1" max="50"></div>' +
    '</div>' +
    '<div class="row g-2 mb-3">' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Venue</label>' +
      '<input class="form-control form-control-sm" id="ne-venue" type="text" placeholder="Amsterdam, Netherlands"></div>' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Virtual URL</label>' +
      '<input class="form-control form-control-sm" id="ne-vurl" type="url" placeholder="https://..."></div>' +
    '</div>' +
    '<div class="d-flex gap-2 align-items-center">' +
      '<button type="submit" class="btn btn-sm btn-success">Create Event</button>' +
      '<button type="button" class="btn btn-sm btn-secondary" id="btn-cancel-new-event">Cancel</button>' +
      '<span id="ne-status" class="small"></span>' +
    '</div>' +
    '</form>'
  );
}

function wireNewEventForm(): void {
  q("#btn-cancel-new-event")?.addEventListener("click", () => {
    q("#new-event-form")?.classList.add("d-none");
  });
  q<HTMLFormElement>("#form-new-event")?.addEventListener("submit", (evt) => {
    evt.preventDefault();
    void doCreateEvent();
  });
}

async function doCreateEvent(): Promise<void> {
  const nameEl   = q<HTMLInputElement>("#ne-name");
  const slugEl   = q<HTMLInputElement>("#ne-slug");
  const tzEl     = q<HTMLInputElement>("#ne-tz");
  const startsEl = q<HTMLInputElement>("#ne-starts");
  const endsEl   = q<HTMLInputElement>("#ne-ends");
  const modeEl   = q<HTMLSelectElement>("#ne-mode");
  const invlimEl = q<HTMLInputElement>("#ne-invlim");
  const venueEl  = q<HTMLInputElement>("#ne-venue");
  const vurlEl   = q<HTMLInputElement>("#ne-vurl");
  const statusEl = q("#ne-status");

  const body: Record<string, unknown> = {
    name: nameEl?.value.trim(),
    slug: slugEl?.value.trim(),
    timezone: tzEl?.value.trim() || "UTC",
    registrationMode: modeEl?.value ?? "invite_or_open",
    inviteLimitAttendee: parseInt(invlimEl?.value ?? "5") || 5,
  };
  if (startsEl?.value) body.startsAt = new Date(startsEl.value).toISOString();
  if (endsEl?.value)   body.endsAt   = new Date(endsEl.value).toISOString();
  if (venueEl?.value.trim())  body.venue = venueEl.value.trim();
  if (vurlEl?.value.trim())   body.virtualUrl = vurlEl.value.trim();

  const btn = q<HTMLButtonElement>("#form-new-event button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  if (statusEl) statusEl.textContent = "";

  try {
    await api(`/api/v1/admin/events`, { method: "POST", body: JSON.stringify(body) });
    toast(`Event '${String(body.slug)}' created`, "success");
    q("#new-event-form")?.classList.add("d-none");
    await loadEvents();
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    toast((err as Error).message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Create Event"; }
  }
}

// ── Event Details (full edit form) ─────────────────────────────────────────────

function detailsFormHtml(det: Partial<EventDetail>): string {
  const toLocalDt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    try { return new Date(iso).toISOString().slice(0, 16); } catch { return ""; }
  };
  const modeOpt = (val: string, label: string): string =>
    `<option value="${val}"${det.registration_mode === val ? " selected" : ""}>${label}</option>`;
  return (
    `<form id="form-details" data-slug="${esc(det.slug ?? "")}">` +

    // Core details
    '<h6 class="text-uppercase small fw-bold text-muted mb-2">Event Details</h6>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-8"><label class="form-label small fw-semibold">Event Name</label>' +
      `<input class="form-control form-control-sm" id="det-name" type="text" value="${esc(det.name ?? "")}" required></div>` +
      '<div class="col-md-4"><label class="form-label small fw-semibold">Slug (read-only)</label>' +
      `<input class="form-control form-control-sm mono" type="text" value="${esc(det.slug ?? "")}" disabled></div>` +
    '</div>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-4"><label class="form-label small fw-semibold">Start date</label>' +
      `<input class="form-control form-control-sm" id="det-starts" type="datetime-local" value="${esc(toLocalDt(det.starts_at))}"></div>` +
      '<div class="col-md-4"><label class="form-label small fw-semibold">End date</label>' +
      `<input class="form-control form-control-sm" id="det-ends" type="datetime-local" value="${esc(toLocalDt(det.ends_at))}"></div>` +
      '<div class="col-md-4"><label class="form-label small fw-semibold">Timezone</label>' +
      `<input class="form-control form-control-sm" id="det-tz" type="text" value="${esc(det.timezone ?? "UTC")}" required></div>` +
    '</div>' +
    '<div class="row g-2 mb-3">' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Venue</label>' +
      `<input class="form-control form-control-sm" id="det-venue" type="text" value="${esc(det.venue ?? "")}" placeholder="City, Country"></div>` +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Virtual URL</label>' +
      `<input class="form-control form-control-sm" id="det-vurl" type="url" value="${esc(det.virtual_url ?? "")}" placeholder="https://..."></div>` +
    '</div>' +
    '<div class="row g-2 mb-3">' +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Hero image URL</label>' +
      `<input class="form-control form-control-sm" id="det-hero" type="text" value="${esc(det.hero_image_url ?? "")}" placeholder="/events/2026/my-event/hero.png"></div>` +
      '<div class="col-md-6"><label class="form-label small fw-semibold">Location label</label>' +
      `<input class="form-control form-control-sm" id="det-location" type="text" value="${esc(det.location ?? "")}" placeholder="Amsterdam, The Netherlands"></div>` +
    '</div>' +
    '<div class="mb-3"><label class="form-label small fw-semibold">Session types</label>' +
    `<input class="form-control form-control-sm" id="det-session-types" type="text" value="${esc((det.session_types ?? []).join(", "))}" placeholder="talk, keynote, panel, tutorial">` +
    '<div class="form-text">Comma-separated; used by proposal submission forms.</div></div>' +

    // Registration settings
    '<h6 class="text-uppercase small fw-bold text-muted mb-2 mt-3">Registration Settings</h6>' +
    '<div class="mb-3"><label class="form-label fw-semibold">Registration Mode</label>' +
    '<select class="form-select" id="det-mode">' +
      modeOpt("open", "Open") +
      modeOpt("invite_or_open", "Invite or Open") +
      modeOpt("invite_only", "Invite Only") +
    "</select></div>" +
    '<div class="row g-2 mb-3">' +
      '<div class="col"><label class="form-label small fw-semibold">Invite Limit / Attendee</label>' +
      `<input class="form-control form-control-sm" type="number" id="det-invlim" value="${esc(det.invite_limit_attendee ?? 5)}"></div>` +
      '<div class="col"><label class="form-label small fw-semibold">User Retention (days)</label>' +
      `<input class="form-control form-control-sm" type="number" id="det-retention" value="${esc(det.user_retention_days ?? "")}" placeholder="No policy"></div>` +
    '</div>' +

    '<button type="submit" class="btn btn-success">Save Changes</button>' +
    '<span id="det-status" class="small ms-3"></span>' +
    '</form>'
  );
}

function wireDetailsForm(slug: string): void {
  q<HTMLFormElement>("#form-details")?.addEventListener("submit", (evt) => void doSaveDetails(evt, slug));
}

function eventDaysTabHtml(): string {
  const timezone = _currentEventDetail?.timezone ?? "UTC";
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      `<span class="small text-muted">Manage per-day attendance options and local event times (${esc(timezone)})</span>` +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="btn-days-refresh">&circlearrowright; Refresh</button>' +
      '<button class="btn btn-sm btn-success" id="btn-days-add">+ Add day</button>' +
      '<button class="btn btn-sm btn-primary" id="btn-days-save">Save Days</button>' +
    '</div>' +
    '<div id="days-status" class="small mb-2"></div>' +
    '<div id="days-body">' + spinner() + '</div>'
  );
}

function eventTermsTabHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<span class="small text-muted">Manage attendee and speaker consent terms</span>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="btn-terms-refresh">&circlearrowright; Refresh</button>' +
      '<button class="btn btn-sm btn-success" id="btn-terms-add-attendee">+ Attendee term</button>' +
      '<button class="btn btn-sm btn-success" id="btn-terms-add-speaker">+ Speaker term</button>' +
      '<button class="btn btn-sm btn-primary" id="btn-terms-save">Save Terms</button>' +
    '</div>' +
    '<div id="terms-status" class="small mb-2"></div>' +
    '<div class="row g-3">' +
      '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-header bg-white fw-semibold">Attendee terms</div><div class="card-body" id="terms-attendee-body"></div></div></div>' +
      '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-header bg-white fw-semibold">Speaker terms</div><div class="card-body" id="terms-speaker-body"></div></div></div>' +
    '</div>'
  );
}

function eventFormsTabHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<span class="small text-muted">Manage event forms and inspect all submissions</span>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="btn-forms-refresh">&circlearrowright; Refresh</button>' +
      '<button class="btn btn-sm btn-success" id="btn-forms-new">+ New form</button>' +
    '</div>' +
    '<div id="forms-status" class="small mb-2"></div>' +
    '<div id="forms-body">' + spinner() + '</div>' +
    '<div id="forms-detail" class="mt-3"></div>'
  );
}

function dayOptionEditorRow(opt?: AdminAttendanceOption): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-1 day-opt-row">' +
      `<input class="form-control form-control-sm" data-opt-value value="${esc(opt?.value ?? "")}" placeholder="value (e.g. in_person)">` +
      `<input class="form-control form-control-sm" data-opt-label value="${esc(opt?.label ?? "")}" placeholder="Label">` +
      `<input class="form-control form-control-sm" data-opt-capacity type="number" value="${esc(opt?.capacity ?? "")}" placeholder="Capacity (optional)">` +
      '<button type="button" class="btn btn-sm btn-outline-danger" data-remove-opt>&times;</button>' +
    '</div>'
  );
}

function dayEditorCard(day?: AdminEventDay): string {
  const opts = day?.attendanceOptions ?? [];
  const counts = day?.attendanceCounts ?? {};
  const timezone = _currentEventDetail?.timezone ?? "UTC";
  const dayStart = timeInZone(day?.startsAt, timezone);
  const dayEnd = timeInZone(day?.endsAt, timezone);
  const countSummary = Object.keys(counts).length
    ? Object.entries(counts).map(([k, v]) => `<span class="badge text-bg-light border me-1">${esc(k)}: ${v}</span>`).join("")
    : '<span class="text-muted small">No registered attendees yet for this day</span>';
  return (
    '<div class="card border mb-3 day-card">' +
      '<div class="card-body">' +
        '<div class="row g-2 mb-2">' +
          `<div class="col-md-3"><label class="form-label small mb-1">Date</label><input class="form-control form-control-sm" type="date" data-day-date value="${esc(day?.date ?? "")}"></div>` +
          `<div class="col-md-3"><label class="form-label small mb-1">Starts at</label><input class="form-control form-control-sm" type="time" step="60" data-day-starts value="${esc(dayStart)}"></div>` +
          `<div class="col-md-3"><label class="form-label small mb-1">Ends at</label><input class="form-control form-control-sm" type="time" step="60" data-day-ends value="${esc(dayEnd)}"></div>` +
          `<div class="col-md-3"><label class="form-label small mb-1">Sort</label><input class="form-control form-control-sm" data-day-sort type="number" value="${esc(day?.sortOrder ?? 0)}"></div>` +
        '</div>' +
        '<div class="row g-2 mb-2">' +
          `<div class="col-md-10"><label class="form-label small mb-1">Label</label><input class="form-control form-control-sm" data-day-label value="${esc(day?.label ?? "")}" placeholder="Thursday 3 December 2026"></div>` +
          '<div class="col-md-2 d-flex align-items-end"><button type="button" class="btn btn-sm btn-outline-danger w-100" data-remove-day>Remove</button></div>' +
        '</div>' +
        '<div class="small fw-semibold mb-1">Attendance options</div>' +
        '<div class="day-options">' +
          (opts.length ? opts.map((opt) => dayOptionEditorRow(opt)).join("") : dayOptionEditorRow()) +
        '</div>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary mt-1" data-add-opt>+ Option</button>' +
        `<div class="mt-2">${countSummary}</div>` +
      '</div>' +
    '</div>'
  );
}

async function loadEventDays(slug: string): Promise<void> {
  const body = q("#days-body");
  if (!body) return;
  body.innerHTML = spinner();
  try {
    const d = await api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`);
    const days = d.days ?? [];
    body.innerHTML = days.length ? days.map((day) => dayEditorCard(day)).join("") : '<p class="text-muted fst-italic small">No days configured yet.</p>';

    q("#btn-days-refresh")?.addEventListener("click", () => void loadEventDays(slug));
    q("#btn-days-add")?.addEventListener("click", () => {
      body.insertAdjacentHTML("beforeend", dayEditorCard());
      wireDayCards(body);
    });
    q("#btn-days-save")?.addEventListener("click", () => void saveEventDays(slug));
    wireDayCards(body);
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function wireDayCards(root: Element): void {
  root.querySelectorAll<HTMLButtonElement>("[data-remove-day]").forEach((btn) => {
    btn.onclick = () => btn.closest(".day-card")?.remove();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-add-opt]").forEach((btn) => {
    btn.onclick = () => {
      const wrap = btn.closest(".day-card")?.querySelector(".day-options");
      if (!wrap) return;
      wrap.insertAdjacentHTML("beforeend", dayOptionEditorRow());
      wireDayCards(root);
    };
  });
  root.querySelectorAll<HTMLButtonElement>("[data-remove-opt]").forEach((btn) => {
    btn.onclick = () => btn.closest(".day-opt-row")?.remove();
  });
}

async function saveEventDays(slug: string): Promise<void> {
  const statusEl = q("#days-status");
  const cards = Array.from(document.querySelectorAll("#days-body .day-card"));
  const days = cards.map((card, idx) => {
    const options = Array.from(card.querySelectorAll(".day-opt-row")).map((optRow) => {
      const value = (optRow.querySelector<HTMLInputElement>("[data-opt-value]")?.value ?? "").trim();
      const label = (optRow.querySelector<HTMLInputElement>("[data-opt-label]")?.value ?? "").trim();
      const capacityRaw = (optRow.querySelector<HTMLInputElement>("[data-opt-capacity]")?.value ?? "").trim();
      return {
        value,
        label,
        capacity: capacityRaw ? parseInt(capacityRaw, 10) : null,
      };
    }).filter((o) => o.value && o.label);
    return {
      date: (card.querySelector<HTMLInputElement>("[data-day-date]")?.value ?? "").trim(),
      label: (card.querySelector<HTMLInputElement>("[data-day-label]")?.value ?? "").trim() || undefined,
      startTime: (card.querySelector<HTMLInputElement>("[data-day-starts]")?.value ?? "").trim() || undefined,
      endTime: (card.querySelector<HTMLInputElement>("[data-day-ends]")?.value ?? "").trim() || undefined,
      sortOrder: parseInt(card.querySelector<HTMLInputElement>("[data-day-sort]")?.value ?? String((idx + 1) * 10), 10) || (idx + 1) * 10,
      attendanceOptions: options,
    };
  }).filter((d) => d.date);

  try {
    if (statusEl) { statusEl.textContent = "Saving..."; statusEl.className = "small text-muted mb-2"; }
    const res = await api<{ skipped?: string[] }>(`/api/v1/admin/events/${slug}/days`, {
      method: "PUT",
      body: JSON.stringify({ days }),
    });
    const skipped = res.skipped ?? [];
    if (statusEl) {
      statusEl.textContent = skipped.length
        ? `Saved with warnings. Could not remove days with registrations: ${skipped.join(", ")}`
        : "Saved";
      statusEl.className = skipped.length ? "small text-warning mb-2" : "small text-success mb-2";
    }
    toast("Event days updated", "success");
    await loadEventDays(slug);
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger mb-2"; }
    toast((err as Error).message, "error");
  }
}

function termEditorRow(term?: AdminEventTerm): string {
  return (
    '<div class="card border mb-2 term-row"><div class="card-body p-2">' +
    '<div class="row g-2 mb-2">' +
      `<div class="col-md-4"><input class="form-control form-control-sm" data-term-key value="${esc(term?.term_key ?? "")}" placeholder="term key"></div>` +
      `<div class="col-md-3"><input class="form-control form-control-sm" data-term-version value="${esc(term?.version ?? "v1")}" placeholder="version"></div>` +
      `<div class="col-md-3"><input class="form-control form-control-sm" data-term-content-ref value="${esc(term?.content_ref ?? "")}" placeholder="content ref (optional)"></div>` +
      `<div class="col-md-2 d-flex align-items-center"><div class="form-check"><input class="form-check-input" type="checkbox" data-term-required ${term?.required !== 0 ? "checked" : ""}><label class="form-check-label small">Required</label></div></div>` +
    '</div>' +
    `<textarea class="form-control form-control-sm mb-2" data-term-display rows="2" placeholder="Display text">${esc(term?.display_text ?? "")}</textarea>` +
    `<textarea class="form-control form-control-sm mb-2" data-term-help rows="2" placeholder="Help text (optional)">${esc(term?.help_text ?? "")}</textarea>` +
    '<button type="button" class="btn btn-sm btn-outline-danger" data-remove-term>Remove</button>' +
    '</div></div>'
  );
}

function wireTermRows(root: Element): void {
  root.querySelectorAll<HTMLButtonElement>("[data-remove-term]").forEach((btn) => {
    btn.onclick = () => btn.closest(".term-row")?.remove();
  });
}

async function loadEventTerms(slug: string): Promise<void> {
  const attendeeBody = q("#terms-attendee-body");
  const speakerBody = q("#terms-speaker-body");
  if (!attendeeBody || !speakerBody) return;

  attendeeBody.innerHTML = spinner();
  speakerBody.innerHTML = spinner();
  try {
    const d = await api<{ terms: { attendee: AdminEventTerm[]; speaker: AdminEventTerm[] } }>(`/api/v1/admin/events/${slug}/terms`);
    const attendee = d.terms?.attendee ?? [];
    const speaker = d.terms?.speaker ?? [];

    attendeeBody.innerHTML = attendee.length ? attendee.map((t) => termEditorRow(t)).join("") : '<p class="text-muted small fst-italic">No attendee terms.</p>';
    speakerBody.innerHTML = speaker.length ? speaker.map((t) => termEditorRow(t)).join("") : '<p class="text-muted small fst-italic">No speaker terms.</p>';

    q("#btn-terms-refresh")?.addEventListener("click", () => void loadEventTerms(slug));
    q("#btn-terms-add-attendee")?.addEventListener("click", () => {
      attendeeBody.insertAdjacentHTML("beforeend", termEditorRow());
      wireTermRows(attendeeBody);
    });
    q("#btn-terms-add-speaker")?.addEventListener("click", () => {
      speakerBody.insertAdjacentHTML("beforeend", termEditorRow());
      wireTermRows(speakerBody);
    });
    q("#btn-terms-save")?.addEventListener("click", () => void saveEventTerms(slug));

    wireTermRows(attendeeBody);
    wireTermRows(speakerBody);
  } catch (err) {
    const msg = esc((err as Error).message);
    attendeeBody.innerHTML = `<div class="alert alert-danger">${msg}</div>`;
    speakerBody.innerHTML = `<div class="alert alert-danger">${msg}</div>`;
  }
}

function collectTerms(selector: string): Array<{ termKey: string; version: string; required: boolean; contentRef?: string; displayText: string; helpText?: string }> {
  return Array.from(document.querySelectorAll(`${selector} .term-row`)).map((row) => {
    const termKey = (row.querySelector<HTMLInputElement>("[data-term-key]")?.value ?? "").trim();
    const version = (row.querySelector<HTMLInputElement>("[data-term-version]")?.value ?? "v1").trim();
    const contentRef = (row.querySelector<HTMLInputElement>("[data-term-content-ref]")?.value ?? "").trim();
    const displayText = (row.querySelector<HTMLTextAreaElement>("[data-term-display]")?.value ?? "").trim();
    const helpText = (row.querySelector<HTMLTextAreaElement>("[data-term-help]")?.value ?? "").trim();
    const required = Boolean(row.querySelector<HTMLInputElement>("[data-term-required]")?.checked);
    return {
      termKey,
      version,
      required,
      contentRef: contentRef || undefined,
      displayText,
      helpText: helpText || undefined,
    };
  }).filter((t) => t.termKey && t.version && t.displayText);
}

async function saveEventTerms(slug: string): Promise<void> {
  const statusEl = q("#terms-status");
  const attendee = collectTerms("#terms-attendee-body");
  const speaker = collectTerms("#terms-speaker-body");
  try {
    if (statusEl) { statusEl.textContent = "Saving..."; statusEl.className = "small text-muted mb-2"; }
    await api(`/api/v1/admin/events/${slug}/terms`, {
      method: "PUT",
      body: JSON.stringify({ attendee, speaker }),
    });
    if (statusEl) { statusEl.textContent = "Saved"; statusEl.className = "small text-success mb-2"; }
    toast("Terms updated", "success");
    await loadEventTerms(slug);
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger mb-2"; }
    toast((err as Error).message, "error");
  }
}

async function loadEventForms(slug: string): Promise<void> {
  const body = q("#forms-body");
  const detail = q("#forms-detail");
  if (!body || !detail) return;
  body.innerHTML = spinner();
  detail.innerHTML = "";

  try {
    const d = await api<{ forms: AdminEventFormSummary[] }>(`/api/v1/admin/events/${slug}/forms`);
    const forms = d.forms ?? [];

    body.innerHTML = tbl(
      ["Key", "Title", "Purpose", "Scope", "Status", "Fields", "Answers", "Updated", ""],
      forms.map((f) =>
        `<tr>` +
        `<td class="mono">${esc(f.key)}</td>` +
        `<td>${esc(f.title)}</td>` +
        `<td>${badge(f.purpose)}</td>` +
        `<td>${esc(f.scope_type)}</td>` +
        `<td>${badge(f.status)}</td>` +
        `<td class="mono">${f.field_count}</td>` +
        `<td class="mono">${f.submission_count}</td>` +
        `<td class="mono">${fmt(f.updated_at)}</td>` +
        `<td class="d-flex gap-1">` +
        `<button class="btn btn-sm btn-outline-primary" data-open-form="${esc(f.key)}">Manage</button>` +
        `<button class="btn btn-sm btn-outline-secondary" data-open-form-results="${esc(f.key)}">Results</button>` +
        `</td>` +
        `</tr>`,
      ),
      "No forms configured for this event",
    );

    q("#btn-forms-refresh")?.addEventListener("click", () => void loadEventForms(slug));
    q("#btn-forms-new")?.addEventListener("click", () => renderNewFormPanel(slug));

    body.querySelectorAll<HTMLButtonElement>("[data-open-form]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.openForm!;
        void openFormDetail(key, slug);
      });
    });
    body.querySelectorAll<HTMLButtonElement>("[data-open-form-results]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.openFormResults!;
        void openFormResults(key, slug);
      });
    });
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function openFormResults(formKey: string, slug?: string): Promise<void> {
  const detail = q("#forms-detail");
  if (!detail) return;
  detail.innerHTML = spinner();
  try {
    const submissionRes = await api<{ form: { id: string; key: string; title: string; purpose: string }; submissions: AdminFormSubmission[]; total: number }>(
      `/api/v1/admin/forms/${encodeURIComponent(formKey)}/submissions?limit=200`,
    );
    const form = submissionRes.form;
    const submissions = submissionRes.submissions ?? [];

    detail.innerHTML =
      '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex justify-content-between align-items-center">' +
      `<span class="fw-semibold">Results: <span class="mono">${esc(form.key)}</span></span>` +
      '<div class="d-flex gap-2">' +
      '<button class="btn btn-sm btn-outline-primary" id="form-results-manage">Open Editor</button>' +
      '<button class="btn btn-sm btn-outline-secondary" id="form-results-close">Close</button>' +
      '</div>' +
      '</div><div class="card-body">' +
      `<div class="small text-muted mb-2">${esc(form.title)} (${esc(form.purpose)})</div>` +
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Submissions (' + submissions.length + ')</h6>' +
      tbl(
        ["Submitted", "Status", "Submitter", "Context", "Answers", ""],
        submissions.map((s) =>
          `<tr>` +
          `<td class="mono">${fmt(s.submittedAt)}</td>` +
          `<td>${badge(s.status)}</td>` +
          `<td>${s.submitter ? esc([s.submitter.firstName, s.submitter.lastName].filter(Boolean).join(" ") || s.submitter.email || s.submitter.id) : "—"}</td>` +
          `<td class="small text-muted">${esc([s.contextType, s.contextRef].filter(Boolean).join(" / ") || "—")}</td>` +
          `<td class="mono small">${Object.keys(s.answers || {}).length}</td>` +
          `<td><button class="btn btn-sm btn-outline-secondary" data-open-answers="${esc(s.id)}">View</button></td>` +
          `</tr>` +
          `<tr class="d-none" id="answers-${esc(s.id)}"><td colspan="6"><pre class="json-out mb-0">${esc(JSON.stringify(s.answers, null, 2))}</pre></td></tr>`,
        ),
        "No submissions yet",
      ) +
      '</div></div>';

    q("#form-results-close")?.addEventListener("click", () => {
      if (detail) detail.innerHTML = "";
    });
    q("#form-results-manage")?.addEventListener("click", () => {
      void openFormDetail(formKey, slug);
    });

    detail.querySelectorAll<HTMLButtonElement>("[data-open-answers]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.openAnswers!;
        const row = q(`#answers-${id}`);
        if (!row) return;
        row.classList.toggle("d-none");
      });
    });
  } catch (err) {
    detail.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function formFieldEditorRow(field?: AdminFormDetailField): string {
  const optionsText = Array.isArray(field?.options) ? (field?.options as string[]).join(", ") : "";
  return (
    '<tr class="form-field-row">' +
    `<td><input class="form-control form-control-sm mono" data-f-key value="${esc(field?.key ?? "")}" placeholder="field_key"></td>` +
    `<td><input class="form-control form-control-sm" data-f-label value="${esc(field?.label ?? "")}" placeholder="Label"></td>` +
    '<td><select class="form-select form-select-sm" data-f-type>' +
      ["text", "textarea", "select", "multi_select", "boolean", "number", "date", "email", "url"].map((t) => `<option value="${t}"${field?.fieldType === t ? " selected" : ""}>${t}</option>`).join("") +
    '</select></td>' +
    `<td><input class="form-control form-control-sm" data-f-options value="${esc(optionsText)}" placeholder="a, b, c"></td>` +
    `<td><input class="form-control form-control-sm" data-f-sort type="number" value="${esc(field?.sortOrder ?? 0)}"></td>` +
    `<td class="text-center"><input class="form-check-input" data-f-required type="checkbox" ${field?.required ? "checked" : ""}></td>` +
    '<td><button class="btn btn-sm btn-outline-danger" data-f-remove>&times;</button></td>' +
    '</tr>'
  );
}

function renderNewFormPanel(slug: string): void {
  const detail = q("#forms-detail");
  if (!detail) return;
  detail.innerHTML =
    '<div class="card border-0 shadow-sm"><div class="card-header bg-white fw-semibold">New form</div><div class="card-body">' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-4"><label class="form-label small">Key</label><input class="form-control form-control-sm mono" id="new-form-key" placeholder="pqc-2026-registration"></div>' +
      '<div class="col-md-4"><label class="form-label small">Purpose</label><select class="form-select form-select-sm" id="new-form-purpose"><option value="event_registration">event_registration</option><option value="proposal_submission">proposal_submission</option><option value="survey">survey</option><option value="feedback">feedback</option><option value="application">application</option></select></div>' +
      '<div class="col-md-4"><label class="form-label small">Status</label><select class="form-select form-select-sm" id="new-form-status"><option value="active">active</option><option value="inactive">inactive</option></select></div>' +
    '</div>' +
    '<div class="row g-2 mb-2">' +
      '<div class="col-md-6"><label class="form-label small">Title</label><input class="form-control form-control-sm" id="new-form-title"></div>' +
      '<div class="col-md-6"><label class="form-label small">Description</label><input class="form-control form-control-sm" id="new-form-description"></div>' +
    '</div>' +
    '<div class="d-flex gap-2 mb-2"><button class="btn btn-sm btn-outline-secondary" id="new-form-add-field">+ Field</button></div>' +
    '<div class="tbl-wrap"><table class="table table-sm"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Options</th><th>Sort</th><th>Req.</th><th></th></tr></thead><tbody id="new-form-fields"></tbody></table></div>' +
    '<div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-success" id="new-form-save">Create form</button><button class="btn btn-sm btn-outline-secondary" id="new-form-cancel">Cancel</button><span id="new-form-status" class="small"></span></div>' +
    '</div></div>';

  const fieldsBody = q("#new-form-fields");
  fieldsBody?.insertAdjacentHTML("beforeend", formFieldEditorRow());

  q("#new-form-add-field")?.addEventListener("click", () => {
    fieldsBody?.insertAdjacentHTML("beforeend", formFieldEditorRow());
    wireFormFieldRows(fieldsBody);
  });
  q("#new-form-cancel")?.addEventListener("click", () => {
    if (detail) detail.innerHTML = "";
  });
  q("#new-form-save")?.addEventListener("click", () => void createForm(slug));
  wireFormFieldRows(fieldsBody);
}

function wireFormFieldRows(root: Element | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("[data-f-remove]").forEach((btn) => {
    btn.onclick = () => btn.closest(".form-field-row")?.remove();
  });
}

function collectFormFields(selector: string): Array<Record<string, unknown>> {
  return Array.from(document.querySelectorAll(`${selector} .form-field-row`)).map((row, idx) => {
    const optionsRaw = (row.querySelector<HTMLInputElement>("[data-f-options]")?.value ?? "").trim();
    const options = optionsRaw ? optionsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    return {
      key: (row.querySelector<HTMLInputElement>("[data-f-key]")?.value ?? "").trim(),
      label: (row.querySelector<HTMLInputElement>("[data-f-label]")?.value ?? "").trim(),
      fieldType: (row.querySelector<HTMLSelectElement>("[data-f-type]")?.value ?? "text").trim(),
      required: Boolean(row.querySelector<HTMLInputElement>("[data-f-required]")?.checked),
      sortOrder: parseInt(row.querySelector<HTMLInputElement>("[data-f-sort]")?.value ?? String((idx + 1) * 10), 10) || (idx + 1) * 10,
      options,
    };
  }).filter((f) => (f.key as string) && (f.label as string));
}

async function createForm(slug: string): Promise<void> {
  const statusEl = q("#new-form-status");
  const payload = {
    key: (q<HTMLInputElement>("#new-form-key")?.value ?? "").trim(),
    purpose: (q<HTMLSelectElement>("#new-form-purpose")?.value ?? "event_registration").trim(),
    status: (q<HTMLSelectElement>("#new-form-status")?.value ?? "active").trim(),
    title: (q<HTMLInputElement>("#new-form-title")?.value ?? "").trim(),
    description: (q<HTMLInputElement>("#new-form-description")?.value ?? "").trim() || undefined,
    fields: collectFormFields("#new-form-fields"),
  };
  try {
    if (statusEl) { statusEl.textContent = "Creating..."; statusEl.className = "small text-muted"; }
    await api(`/api/v1/admin/events/${slug}/forms`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (statusEl) { statusEl.textContent = "Created"; statusEl.className = "small text-success"; }
    toast("Form created", "success");
    await loadEventForms(slug);
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    toast((err as Error).message, "error");
  }
}

async function openFormDetail(formKey: string, slug?: string): Promise<void> {
  const detail = q("#forms-detail");
  if (!detail) return;
  detail.innerHTML = spinner();
  try {
    const [formRes, submissionRes] = await Promise.all([
      api<{ form: AdminEventFormSummary; fields: AdminFormDetailField[] }>(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`),
      api<{ submissions: AdminFormSubmission[]; total: number }>(`/api/v1/admin/forms/${encodeURIComponent(formKey)}/submissions?limit=200`),
    ]);

    const form = formRes.form;
    const fields = formRes.fields ?? [];
    const submissions = submissionRes.submissions ?? [];

    detail.innerHTML =
      '<div class="card border-0 shadow-sm"><div class="card-header bg-white d-flex justify-content-between align-items-center">' +
      `<span class="fw-semibold">Form: <span class="mono">${esc(form.key)}</span></span>` +
      '<div class="d-flex gap-2"><button class="btn btn-sm btn-outline-danger" id="form-delete">Archive/Delete</button></div>' +
      '</div><div class="card-body">' +
      '<div class="row g-2 mb-2">' +
        `<div class="col-md-6"><label class="form-label small">Title</label><input class="form-control form-control-sm" id="form-edit-title" value="${esc(form.title)}"></div>` +
        `<div class="col-md-3"><label class="form-label small">Status</label><select class="form-select form-select-sm" id="form-edit-status"><option value="active"${form.status === "active" ? " selected" : ""}>active</option><option value="inactive"${form.status === "inactive" ? " selected" : ""}>inactive</option><option value="archived"${form.status === "archived" ? " selected" : ""}>archived</option></select></div>` +
        `<div class="col-md-3"><label class="form-label small">Purpose</label><input class="form-control form-control-sm" value="${esc(form.purpose)}" disabled></div>` +
      '</div>' +
      `<div class="mb-2"><label class="form-label small">Description</label><input class="form-control form-control-sm" id="form-edit-description" value="${esc(form.description ?? "")}"></div>` +
      '<div class="d-flex gap-2 mb-2"><button class="btn btn-sm btn-outline-secondary" id="form-add-field">+ Field</button><button class="btn btn-sm btn-primary" id="form-save">Save form</button><span class="small" id="form-save-status"></span></div>' +
      '<div class="tbl-wrap mb-3"><table class="table table-sm"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Options</th><th>Sort</th><th>Req.</th><th></th></tr></thead><tbody id="form-edit-fields">' +
      fields.map((f) => formFieldEditorRow(f)).join("") +
      '</tbody></table></div>' +
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Submissions (' + submissions.length + ')</h6>' +
      tbl(
        ["Submitted", "Status", "Submitter", "Context", "Answers", ""],
        submissions.map((s) =>
          `<tr>` +
          `<td class="mono">${fmt(s.submittedAt)}</td>` +
          `<td>${badge(s.status)}</td>` +
          `<td>${s.submitter ? esc([s.submitter.firstName, s.submitter.lastName].filter(Boolean).join(" ") || s.submitter.email || s.submitter.id) : "—"}</td>` +
          `<td class="small text-muted">${esc([s.contextType, s.contextRef].filter(Boolean).join(" / ") || "—")}</td>` +
          `<td class="mono small">${Object.keys(s.answers || {}).length}</td>` +
          `<td><button class="btn btn-sm btn-outline-secondary" data-open-answers="${esc(s.id)}">View</button></td>` +
          `</tr>` +
          `<tr class="d-none" id="answers-${esc(s.id)}"><td colspan="6"><pre class="json-out mb-0">${esc(JSON.stringify(s.answers, null, 2))}</pre></td></tr>`,
        ),
        "No submissions yet",
      ) +
      '</div></div>';

    const fieldsRoot = q("#form-edit-fields");
    wireFormFieldRows(fieldsRoot);

    q("#form-add-field")?.addEventListener("click", () => {
      fieldsRoot?.insertAdjacentHTML("beforeend", formFieldEditorRow());
      wireFormFieldRows(fieldsRoot);
    });

    q("#form-save")?.addEventListener("click", async () => {
      const statusEl = q("#form-save-status");
      const payload = {
        title: (q<HTMLInputElement>("#form-edit-title")?.value ?? "").trim(),
        description: (q<HTMLInputElement>("#form-edit-description")?.value ?? "").trim() || null,
        status: (q<HTMLSelectElement>("#form-edit-status")?.value ?? "active").trim(),
        fields: collectFormFields("#form-edit-fields"),
      };
      try {
        if (statusEl) { statusEl.textContent = "Saving..."; statusEl.className = "small text-muted"; }
        await api(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (statusEl) { statusEl.textContent = "Saved"; statusEl.className = "small text-success"; }
        toast("Form updated", "success");
        await openFormDetail(formKey, slug);
      } catch (err) {
        if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
        toast((err as Error).message, "error");
      }
    });

    q("#form-delete")?.addEventListener("click", async () => {
      const ok = window.confirm("Archive/delete this form? Existing submissions are preserved and force archive mode.");
      if (!ok) return;
      try {
        await api(`/api/v1/admin/forms/${encodeURIComponent(formKey)}`, { method: "DELETE" });
        toast("Form archived/deleted", "success");
        detail.innerHTML = "";
        if (slug) await loadEventForms(slug);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

    detail.querySelectorAll<HTMLButtonElement>("[data-open-answers]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.openAnswers!;
        const row = q(`#answers-${id}`);
        if (!row) return;
        row.classList.toggle("d-none");
      });
    });
  } catch (err) {
    detail.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function doSaveDetails(evt: Event, slug: string): Promise<void> {
  evt.preventDefault();
  const startsRaw = q<HTMLInputElement>("#det-starts")?.value;
  const endsRaw   = q<HTMLInputElement>("#det-ends")?.value;
  const retStr    = q<HTMLInputElement>("#det-retention")?.value ?? "";
  const sessionTypesRaw = q<HTMLInputElement>("#det-session-types")?.value ?? "";

  const toIso = (v: string | undefined): string | null | undefined => {
    if (v === undefined) return undefined;
    if (!v.trim()) return null; // explicit clear
    try { return new Date(v).toISOString(); } catch { return undefined; }
  };

  const body: Record<string, unknown> = {
    name: q<HTMLInputElement>("#det-name")?.value.trim(),
    timezone: q<HTMLInputElement>("#det-tz")?.value.trim() || "UTC",
    registrationMode: q<HTMLSelectElement>("#det-mode")?.value,
    startsAt: toIso(startsRaw),
    endsAt:   toIso(endsRaw),
    inviteLimitAttendee: parseInt(q<HTMLInputElement>("#det-invlim")?.value ?? "") || undefined,
  };

  const venue = q<HTMLInputElement>("#det-venue")?.value.trim();
  const vurl  = q<HTMLInputElement>("#det-vurl")?.value.trim();
  const hero  = q<HTMLInputElement>("#det-hero")?.value.trim();
  const location = q<HTMLInputElement>("#det-location")?.value.trim();
  const sessionTypes = sessionTypesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  body.venue      = venue || null;
  body.virtualUrl = vurl  || null;
  body.heroImageUrl = hero || null;
  body.location = location || null;
  body.sessionTypes = sessionTypes.length ? sessionTypes : null;
  if (retStr) body.userRetentionDays = parseInt(retStr) || undefined;

  const statusEl = q("#det-status");
  const btn = q<HTMLButtonElement>("#form-details button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  if (statusEl) statusEl.textContent = "";

  try {
    const res = await api<{ success: boolean; event: EventDetail }>(
      `/api/v1/admin/events/${slug}/settings`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    _currentEventDetail = res.event;
    toast("Details saved", "success");
    if (statusEl) { statusEl.textContent = "✓ Saved"; statusEl.className = "small text-success ms-3"; }
    await loadEvents(); // refresh list
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger ms-3"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }
  }
}

// ── Team / Event permissions ───────────────────────────────────────────────────

function teamTabHtml(): string {
  return (
    '<div id="team-body">' + spinner() + '</div>'
  );
}

async function loadEventPermissions(slug: string): Promise<void> {
  const body = q("#team-body");
  if (!body) return;
  body.innerHTML = spinner();

  try {
    const d = await api<{ permissions: EventPermission[] }>(`/api/v1/admin/events/${slug}/permissions`);
    const perms = d.permissions ?? [];

    const permLabels: Record<string, string> = {
      organizer: "Organizer",
      program_committee: "Program Committee",
      moderator: "Moderator",
      volunteer: "Volunteer",
    };

    body.innerHTML =
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Event Team</h6>' +
      tbl(
        ["Email", "Role", "Granted by", "Date", ""],
        perms.map((p) =>
          `<tr>` +
          `<td class="mono" style="font-size:.8rem">${esc(p.user_email)}</td>` +
          `<td><span class="badge text-bg-info">${esc(permLabels[p.permission] ?? p.permission)}</span></td>` +
          `<td class="small text-muted">${esc(p.granter_email ?? "—")}</td>` +
          `<td class="mono">${fmt(p.created_at)}</td>` +
          `<td><button class="btn btn-sm btn-outline-danger p-0 px-1" style="font-size:.75rem" data-revoke-perm="${esc(p.id)}" title="Revoke">✕</button></td>` +
          `</tr>`
        ),
        "No team members assigned",
      ) +
      // Add member form
      '<div class="mt-3 card border-0 bg-light p-3">' +
        '<h6 class="small fw-semibold mb-2">Add team member</h6>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-md-5"><label class="form-label small mb-1">Email</label>' +
          '<input class="form-control form-control-sm" id="perm-email" type="email" placeholder="alice@example.com"></div>' +
          '<div class="col-md-4"><label class="form-label small mb-1">Role</label>' +
          '<select class="form-select form-select-sm" id="perm-role">' +
            '<option value="organizer">Organizer</option>' +
            '<option value="program_committee">Program Committee</option>' +
            '<option value="moderator">Moderator</option>' +
            '<option value="volunteer">Volunteer</option>' +
          '</select></div>' +
          '<div class="col-md-3">' +
          '<button class="btn btn-sm btn-success w-100" id="btn-add-perm">Add →</button>' +
          '</div>' +
        '</div>' +
        '<div id="perm-status" class="small mt-2"></div>' +
      '</div>';

    // Wire revoke buttons
    body.querySelectorAll<HTMLButtonElement>("[data-revoke-perm]").forEach((btn) => {
      btn.addEventListener("click", () => void revokePermission(slug, btn.dataset.revokePerm!, body));
    });

    // Wire add button
    q("#btn-add-perm")?.addEventListener("click", () => void addPermission(slug, body));
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function addPermission(slug: string, container: Element): Promise<void> {
  const emailEl = q<HTMLInputElement>("#perm-email");
  const roleEl  = q<HTMLSelectElement>("#perm-role");
  const statusEl = q("#perm-status");
  const email = emailEl?.value.trim() ?? "";
  const permission = roleEl?.value ?? "organizer";

  if (!email) { toast("Enter an email address", "error"); return; }

  const btn = q<HTMLButtonElement>("#btn-add-perm");
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  if (statusEl) statusEl.textContent = "";

  try {
    await api(`/api/v1/admin/events/${slug}/permissions`, {
      method: "POST",
      body: JSON.stringify({ userEmail: email, permission }),
    });
    toast("Team member added", "success");
    void loadEventPermissions(slug);
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "text-danger"; }
    if (btn) { btn.disabled = false; btn.textContent = "Add →"; }
  }
}

async function revokePermission(slug: string, permId: string, container: Element): Promise<void> {
  try {
    await api(`/api/v1/admin/events/${slug}/permissions/${permId}`, { method: "DELETE" });
    toast("Permission revoked", "success");
    void loadEventPermissions(slug);
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

// ── Users section ─────────────────────────────────────────────────────────────

async function loadUsers(): Promise<void> {
  const el = q("#u-body");
  if (!el) return;
  el.innerHTML = spinner();
  hide(q("#u-detail"));
  show(el);

  try {
    const d = await api<{ users: AdminUser[] }>("/api/v1/admin/users");
    const users = d.users ?? [];

    const roleColor: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };
    const roleBadge = (r: string) =>
      `<span class="badge text-bg-${roleColor[r] ?? "secondary"}">${esc(r)}</span>`;

    el.innerHTML =
      '<div class="mb-3 d-flex gap-2 flex-wrap align-items-end">' +
        '<div><label class="form-label small fw-semibold mb-1">Filter by role</label>' +
        '<select class="form-select form-select-sm" id="u-role-filter" style="width:auto">' +
          '<option value="">All</option>' +
          '<option value="admin">Admin</option>' +
          '<option value="user">User</option>' +
          '<option value="guest">Guest</option>' +
        '</select></div>' +
        '<div><label class="form-label small fw-semibold mb-1">Search</label>' +
        '<input class="form-control form-control-sm" id="u-search" type="search" placeholder="email or name" style="width:220px"></div>' +
        '<button class="btn btn-sm btn-outline-secondary" id="btn-u-search">Search</button>' +
      '</div>' +
      '<div id="u-table">' +
      renderUserTable(users, roleColor, roleBadge) +
      '</div>';

    wireUserTable(el);

    // Wire search
    const doSearch = async () => {
      const role   = q<HTMLSelectElement>("#u-role-filter")?.value ?? "";
      const search = q<HTMLInputElement>("#u-search")?.value.trim() ?? "";
      const params = new URLSearchParams();
      if (role)   params.set("role", role);
      if (search) params.set("search", search);
      const d2 = await api<{ users: AdminUser[] }>(`/api/v1/admin/users?${params}`);
      const tblEl = q("#u-table");
      if (tblEl) {
        tblEl.innerHTML = renderUserTable(d2.users ?? [], roleColor, roleBadge);
        wireUserTable(el);
      }
    };
    q("#btn-u-search")?.addEventListener("click", () => void doSearch());
    q("#u-search")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void doSearch(); });

  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function renderUserTable(
  users: AdminUser[],
  roleColor: Record<string, string>,
  roleBadge: (r: string) => string,
): string {
  return tbl(
    ["Email", "Name", "Organisation", "Role", "Since", ""],
    users.map((u) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
      return (
        `<tr style="cursor:pointer" data-view-user="${esc(u.id)}">` +
        `<td class="mono" style="font-size:.8rem"><a href="mailto:${esc(u.email)}" onclick="event.stopPropagation()" class="text-decoration-none">${esc(u.email)}</a></td>` +
        `<td class="fw-semibold">${esc(name)}</td>` +
        `<td class="small text-muted">${esc(u.organization_name ?? "—")}</td>` +
        `<td>${roleBadge(u.role)}</td>` +
        `<td class="mono">${fmt(u.created_at)}</td>` +
        `<td>` +
          `<select class="form-select form-select-sm d-inline-block" style="width:auto;font-size:.75rem" data-user-id="${esc(u.id)}" data-current-role="${esc(u.role)}">` +
            `<option value="admin"${u.role === "admin" ? " selected" : ""}>admin</option>` +
            `<option value="user"${u.role === "user"  ? " selected" : ""}>user</option>` +
            `<option value="guest"${u.role === "guest" ? " selected" : ""}>guest</option>` +
          `</select>` +
        `</td>` +
        `</tr>`
      );
    }),
    "No users found",
  );
}

function wireUserTable(container: Element): void {
  // Wire role selects
  container.querySelectorAll<HTMLSelectElement>("[data-user-id]").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => { e.stopPropagation(); void doUpdateUserRole(sel.dataset.userId!, sel.value, sel); });
  });
  // Wire row clicks to open user detail
  container.querySelectorAll<HTMLTableRowElement>("tr[data-view-user]").forEach((row) => {
    row.addEventListener("click", () => void openUserDetail(row.dataset.viewUser!));
  });
}

async function doUpdateUserRole(userId: string, newRole: string, sel: HTMLSelectElement): Promise<void> {
  const prevRole = sel.dataset.currentRole ?? sel.value;
  try {
    await api(`/api/v1/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
    sel.dataset.currentRole = newRole;
    toast(`Role updated to '${newRole}'`, "success");
  } catch (err) {
    toast((err as Error).message, "error");
    // Revert
    sel.value = prevRole;
  }
}

// ── User Detail View ────────────────────────────────────────────────────────

interface UserDetail {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  role: string;
  active: boolean;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshotUrl: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

async function openUserDetail(userId: string): Promise<void> {
  const body = q("#u-body");
  const detail = q("#u-detail");
  if (!body || !detail) return;

  hide(body);
  show(detail);
  const infoEl = q("#u-detail-info");
  const previewEl = q("#u-headshot-preview");
  const titleEl = q("#u-detail-title");
  const statusEl = q("#u-headshot-status");
  if (infoEl) infoEl.innerHTML = spinner();
  if (previewEl) previewEl.innerHTML = "";
  if (statusEl) statusEl.innerHTML = "";

  // Wire back button
  const backBtn = q("#btn-u-back");
  if (backBtn) {
    const newBack = backBtn.cloneNode(true) as HTMLElement;
    backBtn.replaceWith(newBack);
    newBack.addEventListener("click", () => {
      hide(detail);
      show(body);
    });
  }

  try {
    const d = await api<{ user: UserDetail }>(`/api/v1/admin/users/${userId}`);
    const u = d.user;

    if (titleEl) titleEl.textContent = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;

    renderUserInfo(u, infoEl);
    renderHeadshotPreview(u, previewEl);
    wireHeadshotControls(u);
  } catch (err) {
    if (infoEl) infoEl.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function renderUserInfo(u: UserDetail, el: Element | null): void {
  if (!el) return;

  const row = (label: string, value: string | null | undefined) =>
    `<tr><th class="text-muted small" style="width:140px">${esc(label)}</th><td>${esc(value || "—")}</td></tr>`;

  const roleColor: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };

  el.innerHTML =
    '<div class="card border-0 shadow-sm"><div class="card-body p-3">' +
    '<table class="table table-sm table-borderless mb-0">' +
    '<tbody>' +
    row("Email", u.email) +
    row("First name", u.first_name) +
    row("Last name", u.last_name) +
    row("Preferred name", u.preferred_name) +
    row("Organisation", u.organization_name) +
    row("Job title", u.job_title) +
    `<tr><th class="text-muted small" style="width:140px">Role</th><td><span class="badge text-bg-${roleColor[u.role] ?? "secondary"}">${esc(u.role)}</span></td></tr>` +
    `<tr><th class="text-muted small" style="width:140px">Active</th><td>${u.active ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-danger">No</span>'}</td></tr>` +
    row("Created", u.created_at ? new Date(u.created_at).toLocaleString("en-GB") : null) +
    row("Updated", u.updated_at ? new Date(u.updated_at).toLocaleString("en-GB") : null) +
    (u.biography ? `<tr><th class="text-muted small" style="width:140px">Biography</th><td class="small">${esc(u.biography)}</td></tr>` : "") +
    (u.pii_redacted_at ? `<tr><th class="text-muted small" style="width:140px">PII redacted</th><td class="text-danger">${esc(new Date(u.pii_redacted_at).toLocaleString("en-GB"))}</td></tr>` : "") +
    '</tbody></table></div></div>';
}

function renderHeadshotPreview(u: UserDetail, el: Element | null): void {
  if (!el) return;

  const placeholder =
    '<div class="rounded-circle border bg-light d-flex align-items-center justify-content-center mx-auto" ' +
    'style="width:150px;height:150px">' +
    '<span class="text-muted" style="font-size:2.5rem">👤</span></div>';

  if (u.headshotUrl) {
    el.innerHTML =
      `<img src="${esc(u.headshotUrl)}" alt="Headshot" ` +
      `class="rounded-circle border shadow-sm" ` +
      `style="width:150px;height:150px;object-fit:cover">`;
    
    showEl(q("#btn-u-headshot-delete"));
  } else {
    el.innerHTML = placeholder;
    hideEl(q("#btn-u-headshot-delete"));
  }

  if (u.headshot_updated_at) {
    const statusEl = q("#u-headshot-status");
    if (statusEl) statusEl.innerHTML = `<span class="text-muted">Updated: ${esc(new Date(u.headshot_updated_at).toLocaleString("en-GB"))}</span>`;
  }
}

function showEl(el: Element | null): void { if (el instanceof HTMLElement) el.style.display = ""; }
function hideEl(el: Element | null): void { if (el instanceof HTMLElement) el.style.display = "none"; }

// ── Headshot disclaimer ───────────────────────────────────────────────────────

const ADMIN_HEADSHOT_DISCLAIMER_TEXT = [
  "This is a photograph of the named individual.",
  "PKI Consortium holds the copyright, or has an unrestricted, royalty-free licence to use and publish this image.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "PKI Consortium may display this image alongside the individual's name and professional details on the website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

function showAdminHeadshotDisclaimer(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem";
    const card = document.createElement("div");
    card.style.cssText =
      "background:#fff;border-radius:.5rem;max-width:520px;width:100%;padding:1.5rem;box-shadow:0 8px 32px rgba(0,0,0,.25)";
    card.innerHTML = `
      <h4 style="margin:0 0 .75rem;font-size:1.1rem">Before uploading a photo</h4>
      <p style="font-size:.875rem;margin:0 0 1rem">Please confirm all of the following:</p>
      <form>
        ${ADMIN_HEADSHOT_DISCLAIMER_TEXT.map((text, i) => `
          <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:flex-start">
            <input type="checkbox" id="ahsd-${i}" style="margin-top:.2rem;flex-shrink:0">
            <label for="ahsd-${i}" style="font-size:.875rem">${text}</label>
          </div>`).join("")}
        <div style="display:flex;gap:.5rem;margin-top:1rem">
          <button type="submit" id="ahsd-confirm" class="btn btn-success btn-sm" disabled>Proceed</button>
          <button type="button" id="ahsd-cancel" class="btn btn-outline-secondary btn-sm">Cancel</button>
        </div>
      </form>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const confirmBtn = card.querySelector<HTMLButtonElement>("#ahsd-confirm")!;
    const cancelBtn = card.querySelector<HTMLButtonElement>("#ahsd-cancel")!;
    const checkboxes = Array.from(card.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));

    function updateConfirm(): void {
      confirmBtn.disabled = !checkboxes.every((cb) => cb.checked);
    }
    for (const cb of checkboxes) cb.addEventListener("change", updateConfirm);

    card.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (checkboxes.every((cb) => cb.checked)) { overlay.remove(); resolve(true); }
    });
    cancelBtn.addEventListener("click", () => { overlay.remove(); resolve(false); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

function wireHeadshotControls(u: UserDetail): void {
  // File upload — opens crop UI before uploading
  const fileInput = q<HTMLInputElement>("#u-headshot-file");
  if (fileInput) {
    const newInput = fileInput.cloneNode(true) as HTMLInputElement;
    fileInput.replaceWith(newInput);
    newInput.addEventListener("change", () => {
      const file = newInput.files?.[0];
      newInput.value = "";
      if (!file) return;
      const MAX_RAW_MB = 5;
      if (file.size > MAX_RAW_MB * 1024 * 1024) {
        toast(`Please choose an image under ${MAX_RAW_MB} MB.`, "error");
        return;
      }
      void (async () => {
        const accepted = await showAdminHeadshotDisclaimer();
        if (accepted) void openCropUI(file, u.id);
      })();
    });
  }

  // Gravatar fetch
  const gravBtn = q("#btn-u-gravatar");
  if (gravBtn) {
    const newBtn = gravBtn.cloneNode(true) as HTMLElement;
    gravBtn.replaceWith(newBtn);
    newBtn.addEventListener("click", () => {
      void (async () => {
        const accepted = await showAdminHeadshotDisclaimer();
        if (accepted) void fetchGravatar(u.id);
      })();
    });
  }

  // Delete headshot
  const delBtn = q("#btn-u-headshot-delete");
  if (delBtn) {
    const newDel = delBtn.cloneNode(true) as HTMLElement;
    delBtn.replaceWith(newDel);
    if (u.headshotUrl) showEl(newDel); else hideEl(newDel);
    newDel.addEventListener("click", () => void deleteHeadshot(u.id));
  }
}

// ── Headshot Crop UI ──────────────────────────────────────────────────────────

const CROP_OUTPUT_SIZE = 512; // px — square output

function openCropUI(file: File, userId: string): Promise<void> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        showCropModal(img, userId, resolve);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function showCropModal(img: HTMLImageElement, userId: string, done: () => void): void {
  // Create modal overlay
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);" +
    "display:flex;align-items:center;justify-content:center;flex-direction:column";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff;border-radius:12px;padding:24px;max-width:480px;width:90vw;" +
    "box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:16px";

  card.innerHTML = '<h6 class="mb-0">Crop headshot</h6>';

  // Viewport — circular mask over the image
  const viewportSize = 300;
  const viewport = document.createElement("div");
  viewport.style.cssText =
    `width:${viewportSize}px;height:${viewportSize}px;border-radius:50%;overflow:hidden;` +
    "position:relative;cursor:grab;border:3px solid #198754;background:#eee;touch-action:none;flex-shrink:0";

  const imgEl = document.createElement("img");
  imgEl.src = img.src;
  imgEl.draggable = false;
  imgEl.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;pointer-events:none";

  viewport.appendChild(imgEl);
  card.appendChild(viewport);

  // Compute initial scale so the image fits the viewport (cover)
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const minDim = Math.min(naturalW, naturalH);
  const fitScale = viewportSize / minDim;
  const minScale = fitScale * 0.5;
  const maxScale = fitScale * 4;

  let scale = fitScale;
  let panX = -(naturalW * scale - viewportSize) / 2;
  let panY = -(naturalH * scale - viewportSize) / 2;

  function clampPan(): void {
    const imgW = naturalW * scale;
    const imgH = naturalH * scale;
    panX = Math.min(0, Math.max(viewportSize - imgW, panX));
    panY = Math.min(0, Math.max(viewportSize - imgH, panY));
  }

  function applyTransform(): void {
    imgEl.style.width = `${naturalW * scale}px`;
    imgEl.style.height = `${naturalH * scale}px`;
    imgEl.style.left = `${panX}px`;
    imgEl.style.top = `${panY}px`;
  }

  clampPan();
  applyTransform();

  // Drag to pan
  let dragging = false;
  let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panStartX = panX; panStartY = panY;
    viewport.style.cursor = "grabbing";
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    clampPan();
    applyTransform();
  });
  viewport.addEventListener("pointerup", () => { dragging = false; viewport.style.cursor = "grab"; });

  // Zoom slider
  const zoomRow = document.createElement("div");
  zoomRow.style.cssText = "display:flex;align-items:center;gap:8px;width:100%";
  zoomRow.innerHTML = '<span class="small text-muted">−</span>';
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(((fitScale - minScale) / (maxScale - minScale)) * 100);
  slider.className = "form-range";
  slider.style.flex = "1";
  zoomRow.appendChild(slider);
  const plusLabel = document.createElement("span");
  plusLabel.className = "small text-muted";
  plusLabel.textContent = "+";
  zoomRow.appendChild(plusLabel);
  card.appendChild(zoomRow);

  slider.addEventListener("input", () => {
    const newScale = minScale + (parseFloat(slider.value) / 100) * (maxScale - minScale);
    // Zoom towards centre of viewport
    const cx = viewportSize / 2;
    const cy = viewportSize / 2;
    panX = cx - ((cx - panX) / scale) * newScale;
    panY = cy - ((cy - panY) / scale) * newScale;
    scale = newScale;
    clampPan();
    applyTransform();
  });

  // Mouse wheel zoom
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const newScale = Math.min(maxScale, Math.max(minScale, scale * (1 + delta)));
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    panX = cx - ((cx - panX) / scale) * newScale;
    panY = cy - ((cy - panY) / scale) * newScale;
    scale = newScale;
    clampPan();
    applyTransform();
    slider.value = String(((scale - minScale) / (maxScale - minScale)) * 100);
  }, { passive: false });

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm btn-outline-secondary";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-sm btn-success";
  confirmBtn.textContent = "Crop & Upload";
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  cancelBtn.addEventListener("click", () => {
    overlay.remove();
    done();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { overlay.remove(); done(); }
  });

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Uploading…";

    // Render cropped image via canvas
    const canvas = document.createElement("canvas");
    canvas.width = CROP_OUTPUT_SIZE;
    canvas.height = CROP_OUTPUT_SIZE;
    const ctx = canvas.getContext("2d")!;

    // Map viewport coords back to source image coords
    const srcX = -panX / scale;
    const srcY = -panY / scale;
    const srcSize = viewportSize / scale;

    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);

    canvas.toBlob(async (blob) => {
      if (!blob) { overlay.remove(); done(); return; }
      try {
        await uploadCroppedHeadshot(userId, blob);
        toast("Headshot uploaded", "success");
      } catch (err) {
        toast((err as Error).message, "error");
      }
      overlay.remove();
      await openUserDetail(userId);
      done();
    }, "image/jpeg", 0.92);
  });
}

async function uploadCroppedHeadshot(userId: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", blob, "headshot.jpg");

  const headers: Record<string, string> = {};
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(`/api/v1/admin/users/${userId}/headshot`, {
    method: "PUT",
    headers,
    body: form,
  });
  const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
}

async function fetchGravatar(userId: string): Promise<void> {
  const statusEl = q("#u-headshot-status");
  if (statusEl) statusEl.innerHTML = '<span class="text-info">Looking up Gravatar…</span>';

  try {
    await api(`/api/v1/admin/users/${userId}/gravatar`, { method: "POST" });
    toast("Gravatar imported successfully", "success");
    await openUserDetail(userId);
  } catch (err) {
    const msg = (err as Error).message;
    toast(msg, "error");
    if (statusEl) statusEl.innerHTML = `<span class="text-danger">${esc(msg)}</span>`;
  }
}

async function deleteHeadshot(userId: string): Promise<void> {
  if (!confirm("Remove this user's headshot?")) return;

  try {
    await api(`/api/v1/admin/users/${userId}/headshot`, { method: "DELETE" });
    toast("Headshot removed", "success");
    await openUserDetail(userId);
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

// ── Email Templates ────────────────────────────────────────────────────────────

async function loadTemplates(): Promise<void> {
  const el = q("#t-body");
  if (!el) return;
  el.innerHTML = spinner();
  hide(q("#t-editor"));
  show(el);
  try {
    const d = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
    const all = d.templates ?? [];

    // Group by template_key (already ordered key ASC, version DESC from the API)
    const grouped = new Map<string, EmailTemplateVersion[]>();
    for (const t of all) {
      const list = grouped.get(t.template_key) ?? [];
      list.push(t);
      grouped.set(t.template_key, list);
    }

    if (!grouped.size) {
      el.innerHTML =
        '<p class="text-muted text-center py-3 fst-italic small">No email templates found. ' +
        "Use the seed script to populate initial templates.</p>";
      return;
    }

    const rows: string[] = [];
    grouped.forEach((versions, key) => {
      const active = versions.find((v) => v.status === "active");
      const hasDraft = versions.some((v) => v.status === "draft");
      rows.push(
        `<tr>` +
          `<td class="mono" style="font-size:.85rem">${esc(key)}</td>` +
          `<td class="mono">${active ? `v${active.version}` : "—"}</td>` +
          `<td>${badge(active ? "active" : "draft")}${hasDraft && active ? ' <span class="badge text-bg-warning">draft pending</span>' : ""}</td>` +
          `<td class="mono">${versions.length}</td>` +
          `<td><button class="btn btn-sm btn-outline-success" data-edit-key="${esc(key)}">Edit →</button></td>` +
          `</tr>`,
      );
    });

    el.innerHTML = tbl(["Template Key", "Active", "Status", "Versions", ""], rows, "No templates found");

    el.querySelectorAll<HTMLButtonElement>("[data-edit-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.editKey!;
        openTemplate(key, grouped.get(key) ?? []);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function openTemplate(key: string, versions: EmailTemplateVersion[]): void {
  const listEl = q("#t-body");
  const editorEl = q("#t-editor");
  if (!editorEl) return;
  _templateEditorKey = key;
  hide(listEl);
  show(editorEl);

  // Prefer active version for pre-fill; fall back to latest draft
  const active = versions.find((v) => v.status === "active");
  const current = active ?? versions[0];
  const isLayoutTemplate = key === EMAIL_LAYOUT_TEMPLATE_KEY;

  editorEl.innerHTML =
    '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
        `<span class="fw-semibold">Edit: <span class="mono">${esc(key)}</span>${isLayoutTemplate ? ' <span class="badge text-bg-info ms-2">shared shell</span>' : ''}</span>` +
        '<button class="btn btn-sm btn-secondary" id="btn-close-template">&larr; Back to list</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="row g-3">' +
          '<div class="col-lg-7">' +
            (isLayoutTemplate
              ? '<div class="alert alert-info small py-2 mb-3">This template controls the outer email shell used for all emails.</div>'
              : '') +
            '<div class="mb-2">' +
              '<label class="form-label small fw-semibold mb-1" for="t-content-type">Content type</label>' +
              '<select class="form-select form-select-sm" id="t-content-type" style="max-width:180px">' +
                `<option value="markdown"${(current?.content_type ?? "markdown") === "markdown" ? " selected" : ""}>Markdown</option>` +
                `<option value="html"${(current?.content_type ?? "markdown") === "html" ? " selected" : ""}>HTML</option>` +
                `<option value="text"${(current?.content_type ?? "markdown") === "text" ? " selected" : ""}>Plain text</option>` +
              '</select>' +
            '</div>' +
            '<div class="mb-3">' +
              '<label class="form-label small fw-semibold mb-1" for="t-subject">' +
                'Subject template <span class="text-muted fw-normal">(supports conditions and variables)</span>' +
              '</label>' +
              '<div style="position:relative">' +
                '<pre id="t-subject-src" aria-hidden="true" style="position:absolute;inset:0;margin:0;padding:.25rem .5rem;font-size:.875rem;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace;line-height:1.5;white-space:pre;overflow:hidden;border:none;border-radius:.375rem;background:#fff;pointer-events:none;color:#212529"></pre>' +
                `<input type="text" class="form-control form-control-sm font-monospace" id="t-subject" ` +
                  `value="${esc(current?.subject_template ?? "")}" placeholder="e.g. Your invitation to {{eventName}}" style="position:relative;z-index:1;background:transparent;caret-color:#212529">` +
              '</div>' +
            '</div>' +
            '<div class="mb-3">' +
              '<label class="form-label small fw-semibold mb-1" for="t-content">' +
                'Body <span class="text-muted fw-normal">(supports {{variables}}, {{#if}}\u2026{{/if}}, {{#each}}\u2026{{/each}})</span>' +
              '</label>' +
              '<div style="position:relative">' +
                '<pre id="t-content-src" aria-hidden="true" style="position:absolute;inset:0;margin:0;padding:.375rem .75rem;font-size:.8rem;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace;line-height:1.5;white-space:pre-wrap;word-break:break-all;overflow:hidden;border:none;border-radius:.375rem;background:#fff;pointer-events:none;color:#212529"></pre>' +
                `<textarea class="form-control font-monospace" id="t-content" rows="16" style="position:relative;z-index:1;background:transparent;color:transparent;caret-color:#212529;font-size:.8rem;resize:vertical">${esc(current?.body ?? "")}</textarea>` +
              '</div>' +
            '</div>' +
            '<div class="mb-3">' +
              '<label class="form-label small fw-semibold mb-1">Template helpers</label>' +
              '<div class="small text-muted mb-2">Click to insert into the active field. If nothing is focused, helpers go into the body editor.</div>' +
              `<div id="t-helper-panel" class="d-flex gap-2 flex-wrap">${templateHelpersHtml()}</div>` +
            '</div>' +
            '<div class="mb-3">' +
              '<label class="form-label small fw-semibold mb-1" for="t-preview-data">Preview data (JSON)</label>' +
              '<textarea class="form-control font-monospace" id="t-preview-data" rows="6" style="font-size:.78rem;resize:vertical" placeholder="Optional: provide sample variables as JSON"></textarea>' +
            '</div>' +
            '<div class="d-flex gap-2 align-items-center flex-wrap">' +
              '<button class="btn btn-outline-primary" id="btn-t-preview">Render Preview</button>' +
              '<button class="btn btn-success" id="btn-t-save">Save as Draft</button>' +
              '<span class="text-muted small">Saving creates a new draft version. Activate it below to put it in use.</span>' +
            '</div>' +
          '</div>' +
          '<div class="col-lg-5">' +
            '<div class="card border"><div class="card-header bg-light small fw-semibold">Rendered Preview</div>' +
              '<div class="card-body">' +
                '<div class="mb-2"><div class="small text-muted">Subject</div><div id="t-preview-subject" class="fw-semibold"></div></div>' +
                '<ul class="nav nav-tabs mb-2" role="tablist">' +
                  '<li class="nav-item"><button class="nav-link active" id="t-prev-tab-html" type="button">HTML</button></li>' +
                  '<li class="nav-item"><button class="nav-link" id="t-prev-tab-text" type="button">Text</button></li>' +
                '</ul>' +
                '<div id="t-prev-html-wrap"><iframe id="t-preview-html" style="width:100%;height:360px;border:1px solid #dee2e6;border-radius:.375rem;background:#fff"></iframe></div>' +
                '<pre id="t-preview-text" class="json-out d-none" style="height:360px"></pre>' +
                '<div id="t-preview-status" class="small text-muted mt-2">Preview not rendered yet.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Version history table
    '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Version History</h6>' +
      tbl(
        ["Version", "Status", "Checksum (prefix)", "Created", ""],
        versions.map((v) =>
          `<tr>` +
            `<td class="mono">v${v.version}</td>` +
            `<td>${badge(v.status)}</td>` +
            `<td class="mono" style="font-size:.7rem">${esc(v.checksum_sha256.substring(0, 12))}&hellip;</td>` +
            `<td class="mono">${fmt(v.created_at)}</td>` +
            `<td class="text-nowrap">` +
              (v.status !== "active"
                ? `<button class="btn btn-sm btn-outline-success me-1" style="font-size:.75rem;padding:.15rem .5rem" ` +
                    `data-activate-version="${v.version}">Activate</button>`
                : `<span class="badge text-bg-success me-1">In use</span>`) +
              `<button class="btn btn-sm btn-outline-secondary" style="font-size:.75rem;padding:.15rem .5rem" ` +
                `data-load-version="${v.version}">Load into editor</button>` +
            `</td>` +
          `</tr>`,
        ),
        "No versions yet",
      ) +
    '</div></div>';

  q("#btn-close-template")?.addEventListener("click", () => {
    hide(editorEl);
    show(listEl);
  });

  q("#btn-t-save")?.addEventListener("click", () => void doSaveTemplateVersion(key));
  q("#btn-t-preview")?.addEventListener("click", () => void doRenderTemplatePreview());

  q("#t-subject")?.addEventListener("input", syncTemplateSourcePreview);
  q("#t-content")?.addEventListener("input", syncTemplateSourcePreview);
  q("#t-subject")?.addEventListener("focus", () => { _templateEditorFocus = "subject"; });
  q("#t-content")?.addEventListener("focus", () => { _templateEditorFocus = "body"; });
  editorEl.querySelectorAll<HTMLButtonElement>("[data-template-helper]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const snippet = btn.dataset.templateHelper ?? "";
      const preferredTarget = btn.dataset.templateTarget === "subject" ? "subject" : btn.dataset.templateTarget === "body" ? "body" : null;
      insertTemplateSnippet(snippet, preferredTarget);
    });
  });
  syncTemplateSourcePreview();

  q("#t-content")?.addEventListener("scroll", () => {
    const pre = q<HTMLElement>("#t-content-src");
    const ta = q<HTMLTextAreaElement>("#t-content");
    if (pre && ta) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
  });

  q("#t-prev-tab-html")?.addEventListener("click", () => setTemplatePreviewTab("html"));
  q("#t-prev-tab-text")?.addEventListener("click", () => setTemplatePreviewTab("text"));

  editorEl.querySelectorAll<HTMLButtonElement>("[data-activate-version]").forEach((btn) => {
    btn.addEventListener("click", () =>
      void doActivateTemplateVersion(key, parseInt(btn.dataset.activateVersion!)),
    );
  });

  editorEl.querySelectorAll<HTMLButtonElement>("[data-load-version]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ver = parseInt(btn.dataset.loadVersion!);
      const v = versions.find((vv) => vv.version === ver);
      if (v) {
        const subj = q<HTMLInputElement>("#t-subject");
        const cont = q<HTMLTextAreaElement>("#t-content");
        if (subj) subj.value = v.subject_template ?? "";
        if (cont) cont.value = v.body ?? "";
        toast(`Loaded v${ver} into editor`, "info");
      }
    });
  });
}

function templateHelpersHtml(): string {
  const categories: Array<TemplateHelperItem["category"]> = ["Variables", "Conditions", "CTAs"];
  return categories.map((category) => {
    const items = TEMPLATE_HELPERS.filter((item) => item.category === category);
    return (
      '<div class="w-100">' +
        `<div class="small text-muted fw-semibold mb-1">${esc(category)}</div>` +
        '<div class="d-flex gap-2 flex-wrap">' +
          items.map((item) => {
            const targetAttr = item.target ? ` data-template-target="${item.target}"` : "";
            return `<button type="button" class="btn btn-sm btn-outline-secondary" data-template-helper="${esc(item.snippet)}"${targetAttr}>${esc(item.label)}</button>`;
          }).join("") +
        '</div>' +
      '</div>'
    );
  }).join("");
}

function insertTemplateSnippet(snippet: string, preferredTarget?: "subject" | "body" | null): void {
  const target = preferredTarget ?? _templateEditorFocus;
  const subjectEl = q<HTMLInputElement>("#t-subject");
  const bodyEl = q<HTMLTextAreaElement>("#t-content");
  const field = target === "subject" ? subjectEl : bodyEl;
  if (!field) return;

  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = `${field.value.slice(0, start)}${snippet}${field.value.slice(end)}`;
  const nextPos = start + snippet.length;
  field.focus();
  if (typeof field.setSelectionRange === "function") {
    field.setSelectionRange(nextPos, nextPos);
  }
  if (field === subjectEl) {
    _templateEditorFocus = "subject";
  } else {
    _templateEditorFocus = "body";
  }
  syncTemplateSourcePreview();
}

// ── Template syntax highlighting ─────────────────────────────────────────────
// Purely iterative, stack-based scanner — guaranteed termination.
// A depth stack tracks which color each open block was assigned so that the
// matching {{else}} and {{/if}} always share the same color as their opener.

const _HL_COLORS = [
  "#0d6efd", // blue
  "#198754", // green
  "#fd7e14", // orange
  "#6f42c1", // purple
  "#d63384", // pink
  "#20c997", // teal
  "#dc3545", // red
  "#0dcaf0", // cyan
];
const _HL_BG = [
  "rgba(13,110,253,0.12)", "rgba(25,135,84,0.12)",
  "rgba(253,126,20,0.12)", "rgba(111,66,193,0.12)",
  "rgba(214,51,132,0.12)", "rgba(32,201,151,0.12)",
  "rgba(220,53,69,0.12)",  "rgba(13,202,240,0.12)",
];
const _HL_VAR_COLOR = "#0891b2";

function highlightTemplateSyntax(source: string): string {
  const out: string[] = [];
  // Stack of depth-indices for currently open blocks.
  const stack: number[] = [];
  let pos = 0;

  while (pos < source.length) {
    const start = source.indexOf("{{", pos);
    if (start === -1) { out.push(esc(source.slice(pos))); break; }
    if (start > pos) out.push(esc(source.slice(pos, start)));

    const end = source.indexOf("}}", start + 2);
    if (end === -1) { out.push(esc(source.slice(start))); break; }

    const token = source.slice(start, end + 2);
    const inner = source.slice(start + 2, end).trim();

    let color: string;
    let bg: string | null = null;

    if (inner.startsWith("#")) {
      // Opening block — color at current depth, then push.
      const d = stack.length % _HL_COLORS.length;
      color = _HL_COLORS[d];
      bg    = _HL_BG[d];
      stack.push(d);
    } else if (inner.startsWith("/")) {
      // Closing block — pop and use the same slot as the opener.
      const d = stack.length > 0 ? stack.pop()! : 0;
      color = _HL_COLORS[d % _HL_COLORS.length];
      bg    = _HL_BG[d % _HL_BG.length];
    } else if (inner === "else") {
      // {{else}} — belongs to the innermost open block.
      const d = stack.length > 0 ? stack[stack.length - 1] : 0;
      color = _HL_COLORS[d % _HL_COLORS.length];
      bg    = _HL_BG[d % _HL_BG.length];
    } else {
      color = _HL_VAR_COLOR;
    }

    const style = bg
      ? `color:${color};font-weight:600;background:${bg};border-radius:3px;padding:0 2px`
      : `color:${color};font-weight:600`;
    out.push(`<span style="${style}">${esc(token)}</span>`);
    pos = end + 2;
  }

  return out.join("");
}


function syncTemplateSourcePreview(): void {
  const subjectEl = q<HTMLInputElement>("#t-subject");
  const contentEl = q<HTMLTextAreaElement>("#t-content");
  const subject = subjectEl?.value ?? "";
  const content = contentEl?.value ?? "";
  const subjOut = q<HTMLElement>("#t-subject-src");
  const contentOut = q<HTMLElement>("#t-content-src");
  // Keep the native placeholder visible when the subject field is empty.
  if (subjectEl) subjectEl.style.color = subject ? "transparent" : "";
  if (subjOut) subjOut.innerHTML = subject ? highlightTemplateSyntax(subject) + "&nbsp;" : "";
  if (contentOut) contentOut.innerHTML = highlightTemplateSyntax(content) + "\n";
  // Mirror textarea scroll position into the backdrop pre.
  if (contentEl && contentOut) {
    contentOut.scrollTop = contentEl.scrollTop;
    contentOut.scrollLeft = contentEl.scrollLeft;
  }
}

function setTemplatePreviewTab(tab: "html" | "text"): void {
  const htmlBtn = q<HTMLButtonElement>("#t-prev-tab-html");
  const textBtn = q<HTMLButtonElement>("#t-prev-tab-text");
  const htmlWrap = q("#t-prev-html-wrap");
  const textWrap = q("#t-preview-text");
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

async function doRenderTemplatePreview(): Promise<void> {
  const subjectTemplate = q<HTMLInputElement>("#t-subject")?.value.trim() ?? "";
  const content = q<HTMLTextAreaElement>("#t-content")?.value ?? "";
  const contentType = (q<HTMLSelectElement>("#t-content-type")?.value ?? "markdown") as "markdown" | "html" | "text";
  const dataRaw = q<HTMLTextAreaElement>("#t-preview-data")?.value.trim() ?? "";
  const statusEl = q("#t-preview-status");
  const isLayoutTemplate = _templateEditorKey === EMAIL_LAYOUT_TEMPLATE_KEY;

  if (!content.trim()) {
    toast("Body cannot be empty", "error");
    return;
  }

  let data: Record<string, unknown> | undefined;
  if (dataRaw) {
    try {
      const parsed = JSON.parse(dataRaw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Preview data must be a JSON object");
      }
      data = parsed as Record<string, unknown>;
    } catch (err) {
      const msg = `Invalid preview data JSON: ${(err as Error).message}`;
      toast(msg, "error");
      if (statusEl) statusEl.textContent = msg;
      return;
    }
  }

  if (statusEl) statusEl.textContent = "Rendering preview...";

  try {
    const layoutHtml = isLayoutTemplate ? content : undefined;
    const previewContent = isLayoutTemplate
      ? "<h2>Layout preview</h2><p>This is how body content will appear inside the shared email shell.</p>"
      : content;
    const previewContentType = isLayoutTemplate ? "html" : contentType;
    const result = await api<{ subject: string; html: string; text: string }>(
      "/api/v1/admin/email-templates/preview",
      {
        method: "POST",
        body: JSON.stringify({
          subjectTemplate: subjectTemplate || undefined,
          content: previewContent,
          contentType: previewContentType,
          layoutHtml,
          data,
        }),
      },
    );

    const subjectEl = q("#t-preview-subject");
    const iframe = q<HTMLIFrameElement>("#t-preview-html");
    const textEl = q<HTMLElement>("#t-preview-text");

    if (subjectEl) subjectEl.textContent = result.subject;
    if (iframe) iframe.srcdoc = result.html;
    if (textEl) textEl.textContent = result.text;
    if (statusEl) statusEl.textContent = "Preview rendered.";
  } catch (err) {
    const msg = (err as Error).message;
    toast(msg, "error");
    if (statusEl) statusEl.textContent = msg;
  }
}

async function doSaveTemplateVersion(key: string): Promise<void> {
  const subject = q<HTMLInputElement>("#t-subject")?.value.trim() ?? "";
  const content = q<HTMLTextAreaElement>("#t-content")?.value ?? "";
  const contentType = _templateEditorKey === EMAIL_LAYOUT_TEMPLATE_KEY
    ? "html"
    : (q<HTMLSelectElement>("#t-content-type")?.value ?? "markdown") as "markdown" | "html" | "text";
  const btn = q<HTMLButtonElement>("#btn-t-save");
  if (!content.trim()) { toast("Body cannot be empty", "error"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const r = await api<{ success: boolean; version: number }>(
      `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
      { method: "POST", body: JSON.stringify({ content, subjectTemplate: subject || undefined, contentType }) },
    );
    toast(`Saved as draft v${r.version}`, "success");
    const d = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
    const grouped = groupTemplates(d.templates ?? []);
    openTemplate(key, grouped.get(key) ?? []);
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save as Draft"; }
  }
}

async function doActivateTemplateVersion(key: string, version: number): Promise<void> {
  try {
    await api(`/api/v1/admin/email-templates/${encodeURIComponent(key)}/activate`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
    toast(`v${version} is now active`, "success");
    const d = await api<{ templates: EmailTemplateVersion[] }>("/api/v1/admin/email-templates");
    const grouped = groupTemplates(d.templates ?? []);
    openTemplate(key, grouped.get(key) ?? []);
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

function groupTemplates(templates: EmailTemplateVersion[]): Map<string, EmailTemplateVersion[]> {
  const grouped = new Map<string, EmailTemplateVersion[]>();
  for (const t of templates) {
    const list = grouped.get(t.template_key) ?? [];
    list.push(t);
    grouped.set(t.template_key, list);
  }
  return grouped;
}

// ── Email ──────────────────────────────────────────────────────────────────────

function emailOutboxSummaryBadges(items: Record<string, number>): string {
  const order = ["failed", "retrying", "queued", "sending", "sent", "transactional", "promotional"];
  const ordered = Object.entries(items).sort(([left], [right]) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    const leftRank = leftIndex === -1 ? order.length : leftIndex;
    const rightRank = rightIndex === -1 ? order.length : rightIndex;
    return leftRank - rightRank || left.localeCompare(right);
  });

  if (!ordered.length) {
    return '<span class="text-muted small">No matching rows</span>';
  }

  return ordered
    .map(([key, value]) => `${badge(key)} <span class="small text-muted me-3">${value}</span>`)
    .join("");
}

function isOutboxDueNow(row: AdminEmailOutboxRow): boolean {
  if (row.status !== "queued" && row.status !== "retrying") {
    return false;
  }
  return new Date(row.sendAfter).getTime() <= Date.now();
}

function renderJobsRunSummary(title: string, result: AdminJobsRunResponse | null, empty: string): string {
  if (!result) {
    return `<div class="small text-muted">${esc(empty)}</div>`;
  }

  const reminderVerb = result.dryRun ? "Queue" : "Queued";
  const outboxVerb = result.dryRun ? "Process" : "Processed";
  const cleanupVerb = result.dryRun ? "Cleanup" : "Cleanup";
  const retentionCounts = result.shouldRunRetention
    ? `${cleanupVerb}: ${result.retention.redactedUsers} users, ${result.retention.redactedRegistrations} registrations, ${result.retention.affectedEvents} event(s).`
    : "Cleanup not included.";
  const retentionDetails = result.retention.preview.dueEvents.length > 0
    ? (
      `<details class="mt-3">` +
        `<summary class="small fw-semibold">Cleanup candidates (${result.retention.preview.totalEvents})</summary>` +
        `<div class="mt-2">` +
          tbl(
            ["Event", "Ended", "Retention", "Registrations", "Users"],
            result.retention.preview.dueEvents.slice(0, 5).map((item) => (
              `<tr>` +
                `<td><div class="fw-semibold">${esc(item.eventName)}</div><div class="small text-muted">${esc(item.eventSlug)}</div></td>` +
                `<td class="small">${esc(fmt(item.endsAt))}</td>` +
                `<td class="small">${item.retentionDays} day(s)</td>` +
                `<td class="small">${item.eligibleRegistrations}</td>` +
                `<td class="small">${item.eligibleUsers}</td>` +
              `</tr>`
            )),
            "No cleanup candidates",
          ) +
        `</div>` +
        (result.retention.preview.dueEvents.length > 5
          ? `<div class="small text-muted mt-2">${result.retention.preview.dueEvents.length - 5} more event(s) eligible for cleanup.</div>`
          : "") +
      `</details>`
    )
    : (result.shouldRunRetention
      ? '<div class="small text-muted mt-2">No events are currently past their retention window.</div>'
      : "");
  const reminderSections: Array<{ title: string; rows: AdminReminderPreviewRow[] }> = [
    { title: "Attendee Invites", rows: result.reminders.preview.attendeeInvites },
    { title: "Speaker Invites", rows: result.reminders.preview.speakerInvites },
    { title: "Co-speaker Invites", rows: result.reminders.preview.coSpeakerInvites },
    { title: "Presentation Uploads", rows: result.reminders.preview.presentationUploads },
  ];
  const reminderDetails = reminderSections
    .filter((section) => section.rows.length > 0)
    .map((section) => {
      const sampleRows = section.rows.slice(0, 5).map((row) => {
          const summaryBits = [row.templateKey, `${row.eventName} (${row.eventSlug})`, `#${row.reminderNumber}`];
          if (row.proposalTitle) summaryBits.push(row.proposalTitle);
          return (
            `<tr>` +
              `<td><div class="fw-semibold">${esc(row.recipientName || row.recipientEmail)}</div><div class="mono small text-muted">${esc(row.recipientEmail)}</div></td>` +
              `<td><div class="small">${esc(summaryBits.join(" | "))}</div><div class="small text-muted">Due ${esc(fmt(row.dueAt))}</div></td>` +
              `<td class="small">${esc(row.subject)}</td>` +
            `</tr>`
          );
        });
      const extra = section.rows.length > 5
        ? `<div class="small text-muted mt-2">${section.rows.length - 5} more candidate(s) in this category.</div>`
        : "";
      return (
        `<details class="mt-3">` +
          `<summary class="small fw-semibold">${esc(section.title)} (${section.rows.length})</summary>` +
          `<div class="mt-2">${tbl(["Recipient", "Event / Template", "Subject"], sampleRows, "No candidates")}</div>` +
          extra +
        `</details>`
      );
    })
    .join("");

  return (
    `<div class="border rounded p-3">` +
      `<div class="fw-semibold mb-2">${esc(title)}</div>` +
      `<div class="small mb-2">${reminderVerb}: ${result.reminders.processed} reminders ` +
        `(${result.reminders.inviteRemindersQueued} attendee, ${result.reminders.speakerInviteRemindersQueued} speaker, ${result.reminders.presentationRemindersQueued} presentation).</div>` +
      `<div class="small mb-2">${outboxVerb}: ${result.outbox.processed} outbox rows, ${result.outbox.failed} failed.</div>` +
      `<div class="small mb-2">${retentionCounts}</div>` +
      `<div class="small text-muted">Queue mix: ${emailOutboxSummaryBadges(result.outbox.dueByStatus)}</div>` +
      retentionDetails +
      reminderDetails +
    `</div>`
  );
}

function dueWorkTypeBadge(typeLabel: string, bucket: AdminDueWorkRow["bucket"]): string {
  const color = bucket === "outbox" ? "primary" : bucket === "reminders" ? "info" : "warning";
  return `<span class="badge text-bg-${color}">${esc(typeLabel)}</span>`;
}

function collectDueWorkRows(result: AdminJobsRunResponse | null, dueOutboxRows: AdminEmailOutboxRow[]): AdminDueWorkRow[] {
  const rows: AdminDueWorkRow[] = dueOutboxRows.map((row) => ({
    bucket: "outbox",
    typeLabel: "Email Queue",
    title: row.recipientName || row.recipientEmail,
    subtitle: row.recipientName ? row.recipientEmail : null,
    context: [row.eventName, row.templateKey, `Attempts ${row.attempts}`].filter(Boolean).join(" | "),
    detail: row.subject,
    dueAt: row.sendAfter,
    statusKey: row.status,
    statusLabel: row.status,
  }));

  const reminderSections: Array<{ label: string; rows: AdminReminderPreviewRow[] }> = result
    ? [
      { label: "Attendee Invite", rows: result.reminders.preview.attendeeInvites },
      { label: "Speaker Invite", rows: result.reminders.preview.speakerInvites },
      { label: "Co-speaker Invite", rows: result.reminders.preview.coSpeakerInvites },
      { label: "Presentation Upload", rows: result.reminders.preview.presentationUploads },
    ]
    : [];

  for (const section of reminderSections) {
    for (const row of section.rows) {
      rows.push({
        bucket: "reminders",
        typeLabel: section.label,
        title: row.recipientName || row.recipientEmail,
        subtitle: row.recipientName ? row.recipientEmail : null,
        context: [row.eventName, row.eventSlug, row.templateKey, `#${row.reminderNumber}`].filter(Boolean).join(" | "),
        detail: row.proposalTitle ? `${row.subject} | ${row.proposalTitle}` : row.subject,
        dueAt: row.dueAt,
        statusKey: "pending",
        statusLabel: "Preview",
      });
    }
  }

  if (result) {
    for (const item of result.retention.preview.dueEvents) {
      rows.push({
        bucket: "cleanup",
        typeLabel: "Cleanup",
        title: item.eventName,
        subtitle: item.eventSlug,
        context: `${item.eligibleRegistrations} registrations | ${item.eligibleUsers} users | ${item.retentionDays} day retention`,
        detail: item.endsAt ? `Event ended ${fmt(item.endsAt)}` : "Event end date unknown",
        dueAt: item.endsAt,
        statusKey: result.shouldRunRetention ? "waiting" : "secondary",
        statusLabel: result.shouldRunRetention ? "Eligible" : "Disabled",
      });
    }
  }

  return rows.sort((left, right) => {
    const leftTime = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.title.localeCompare(right.title);
  });
}

function renderDueWorkMergedTable(result: AdminJobsRunResponse | null, dueOutboxRows: AdminEmailOutboxRow[]): string {
  const allRows = collectDueWorkRows(result, dueOutboxRows);
  const counts = {
    all: allRows.length,
    outbox: allRows.filter((row) => row.bucket === "outbox").length,
    reminders: allRows.filter((row) => row.bucket === "reminders").length,
    cleanup: allRows.filter((row) => row.bucket === "cleanup").length,
  };
  const tab = _adminDueWorkViewState.tab;
  const filteredRows = tab === "all" ? allRows : allRows.filter((row) => row.bucket === tab);
  const offset = Math.min(_adminDueWorkViewState.offset, Math.max(0, filteredRows.length - 1));
  const pageSize = Math.max(1, _adminDueWorkViewState.pageSize);
  const pagedRows = filteredRows.slice(offset, offset + pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;
  const tabs: Array<{ key: AdminDueWorkTab; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "outbox", label: "Outbox", count: counts.outbox },
    { key: "reminders", label: "Reminders", count: counts.reminders },
    { key: "cleanup", label: "Cleanup", count: counts.cleanup },
  ];

  return (
    '<div class="mt-4">' +
      '<div class="d-flex flex-wrap gap-2 mb-3" id="duework-tabs">' +
        tabs.map((item) => (
          `<button type="button" class="btn btn-sm ${item.key === tab ? "btn-primary" : "btn-outline-secondary"}" data-duework-tab="${item.key}">` +
            `${esc(item.label)} <span class="badge ${item.key === tab ? "text-bg-light text-dark" : "text-bg-secondary"}">${item.count}</span>` +
          `</button>`
        )).join("") +
      '</div>' +
      '<div class="border rounded p-3">' +
        tbl(
          ["Type", "Target", "Context", "Due", "Status"],
          pagedRows.map((row) => (
            `<tr>` +
              `<td>${dueWorkTypeBadge(row.typeLabel, row.bucket)}</td>` +
              `<td><div class="fw-semibold">${esc(row.title)}</div>${row.subtitle ? `<div class="mono small text-muted">${esc(row.subtitle)}</div>` : ""}</td>` +
              `<td><div class="small">${esc(row.context)}</div>${row.detail ? `<div class="small text-muted mt-1">${esc(row.detail)}</div>` : ""}</td>` +
              `<td class="small">${esc(fmt(row.dueAt))}</td>` +
              `<td><div>${row.bucket === "outbox" ? badge(row.statusKey) : `<span class="badge text-bg-light border text-dark">${esc(row.statusLabel)}</span>`}</div></td>` +
            `</tr>`
          )),
          tab === "cleanup"
            ? (result?.shouldRunRetention ? "No cleanup candidates right now." : "Enable cleanup to preview retention candidates.")
            : tab === "reminders"
              ? "No reminder candidates due right now."
              : tab === "outbox"
                ? "No due outbox rows right now."
                : "No due work items right now.",
        ) +
        `<div class="mt-3" id="duework-pager">${pagerHtml(currentPage, offset + pagedRows.length < filteredRows.length, pageSize, offset, pagedRows.length, filteredRows.length)}</div>` +
      '</div>' +
    '</div>'
  );
}

function syncJobsStateFromInputs(): void {
  const reminderLimit = parseInt(q<HTMLInputElement>("#jobs-reminder-limit")?.value ?? String(_adminJobsState.reminderLimit), 10) || 120;
  const outboxLimit = parseInt(q<HTMLInputElement>("#jobs-outbox-limit")?.value ?? String(_adminJobsState.outboxLimit), 10) || 120;
  const runRetention = Boolean(q<HTMLInputElement>("#jobs-include-retention")?.checked ?? _adminJobsState.runRetention);
  _adminJobsState = { reminderLimit, outboxLimit, runRetention };
}

async function fetchDueWorkPreview(): Promise<AdminJobsRunResponse> {
  return api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
    method: "POST",
    body: JSON.stringify({
      reminderLimit: _adminJobsState.reminderLimit,
      outboxLimit: _adminJobsState.outboxLimit,
      runReminders: true,
      runRetention: _adminJobsState.runRetention,
      runOutbox: true,
      runRetentionMode: "always",
      retentionHourUtc: 0,
      dryRun: true,
    }),
  });
}

function renderDueWorkControl(
  summary: Pick<AdminEmailOutboxResponse["summary"], "dueNow" | "dueByStatus" | "nextSendAfter">,
  dueOutboxRows: AdminEmailOutboxRow[],
): string {
  const lastRunBlock = _adminJobsLastRun
    ? (
      '<details class="mt-3">' +
        '<summary class="small fw-semibold">Last run summary</summary>' +
        `<div class="mt-2">${renderJobsRunSummary("Last Run", _adminJobsLastRun, "")}</div>` +
      '</details>'
    )
    : '<div class="small text-muted mt-3">No due-work run has been executed in this session yet.</div>';

  return (
    '<div class="action-card">' +
      '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">' +
        '<strong>Due Work</strong>' +
        '<div class="d-flex gap-2 flex-wrap">' +
          '<button class="btn btn-sm btn-outline-primary" id="btn-preview-jobs">Refresh Preview</button>' +
          '<button class="btn btn-sm btn-primary" id="btn-run-jobs">Process Due Work Now</button>' +
        '</div>' +
      '</div>' +
      '<div class="border rounded p-2 mb-3 bg-light-subtle">' +
        '<div class="d-flex flex-wrap align-items-center gap-3 small">' +
          '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
            '<span class="text-muted">Reminders</span>' +
            `<input type="number" class="form-control form-control-sm" id="jobs-reminder-limit" value="${_adminJobsState.reminderLimit}" min="1" max="500" style="width:78px">` +
          '</label>' +
          '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
            '<span class="text-muted">Outbox</span>' +
            `<input type="number" class="form-control form-control-sm" id="jobs-outbox-limit" value="${_adminJobsState.outboxLimit}" min="1" max="500" style="width:78px">` +
          '</label>' +
          '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
            `<input class="form-check-input mt-0" type="checkbox" id="jobs-include-retention"${_adminJobsState.runRetention ? " checked" : ""}>` +
            '<span class="text-muted">Cleanup</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      `<div id="duework-items-panel">${renderDueWorkMergedTable(_adminJobsPreview, dueOutboxRows)}</div>` +
      '<div class="small text-muted mt-3" id="jobs-run-status"></div>' +
      lastRunBlock +
    '</div>'
  );
}

function wireDueWorkItemsControls(): void {
  document.querySelectorAll<HTMLButtonElement>("#duework-tabs [data-duework-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn.dataset.dueworkTab ?? "all") as AdminDueWorkTab;
      _adminDueWorkViewState.tab = tab;
      _adminDueWorkViewState.offset = 0;
      const panel = q("#duework-items-panel");
      if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
      wireDueWorkItemsControls();
    });
  });

  q("#duework-pager [data-page-prev]")?.addEventListener("click", () => {
    _adminDueWorkViewState.offset = Math.max(0, _adminDueWorkViewState.offset - _adminDueWorkViewState.pageSize);
    const panel = q("#duework-items-panel");
    if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
    wireDueWorkItemsControls();
  });
  q("#duework-pager [data-page-next]")?.addEventListener("click", () => {
    _adminDueWorkViewState.offset += _adminDueWorkViewState.pageSize;
    const panel = q("#duework-items-panel");
    if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
    wireDueWorkItemsControls();
  });
  document.querySelectorAll<HTMLButtonElement>("#duework-pager [data-page-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = Number(btn.dataset.pageJump || "1");
      if (!Number.isFinite(page) || page < 1) return;
      _adminDueWorkViewState.offset = (page - 1) * _adminDueWorkViewState.pageSize;
      const panel = q("#duework-items-panel");
      if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
      wireDueWorkItemsControls();
    });
  });
  q<HTMLSelectElement>("#duework-pager [data-page-size]")?.addEventListener("change", (event) => {
    const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
    if (!Number.isFinite(nextSize) || nextSize < 1) return;
    _adminDueWorkViewState.pageSize = nextSize;
    _adminDueWorkViewState.offset = 0;
    const panel = q("#duework-items-panel");
    if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
    wireDueWorkItemsControls();
  });
}

function wireDueWorkControls(): void {
  q("#jobs-reminder-limit")?.addEventListener("change", syncJobsStateFromInputs);
  q("#jobs-outbox-limit")?.addEventListener("change", syncJobsStateFromInputs);
  q("#jobs-include-retention")?.addEventListener("change", syncJobsStateFromInputs);
  q("#btn-preview-jobs")?.addEventListener("click", () => void doRunJobs(true));
  q("#btn-run-jobs")?.addEventListener("click", () => void doRunJobs(false));
  wireDueWorkItemsControls();
}

async function loadDueWork(): Promise<void> {
  const el = q("#w-body");
  if (!el) return;
  syncJobsStateFromInputs();
  el.innerHTML = spinner();
  try {
    const [outboxData, dueOutboxData, preview] = await Promise.all([
      api<AdminEmailOutboxResponse>("/api/v1/admin/email/outbox?limit=1&offset=0"),
      api<AdminEmailOutboxResponse>(`/api/v1/admin/email/outbox?dueNow=true&limit=${Math.max(25, Math.min(_adminJobsState.outboxLimit, 100))}&offset=0`),
      fetchDueWorkPreview(),
    ]);
    _adminJobsPreview = preview;
    _adminDueOutboxRows = dueOutboxData.outbox;
    el.innerHTML = renderDueWorkControl(outboxData.summary, dueOutboxData.outbox);
    wireDueWorkControls();
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function renderEmailOutboxTable(rows: AdminEmailOutboxRow[]): string {
  return tbl(
    ["", "Recipient", "Message", "Queue", "Timing", "Details"],
    rows.map((row) => {
      const showFailureDetails = Boolean(row.lastError) && row.status !== "sent";
      const eventBits = [row.eventName, row.eventSlug ? `/${row.eventSlug}` : null].filter(Boolean);
      const subjectMeta = [
        `<span class="small text-muted">${esc(row.templateKey)}${row.templateVersion !== null ? ` v${row.templateVersion}` : ""}</span>`,
        badge(row.messageType),
        row.usesDirectBody ? '<span class="badge text-bg-light border text-dark">Direct body</span>' : "",
        row.hasCustomText ? '<span class="badge text-bg-light border text-dark">Custom text</span>' : "",
        row.bccRecipientCount > 0 ? `<span class="badge text-bg-light border text-dark">BCC ${row.bccRecipientCount}</span>` : "",
        row.hasCalendarInvite ? '<span class="badge text-bg-light border text-dark">Calendar</span>' : "",
        row.hasBadgeAttachment ? '<span class="badge text-bg-light border text-dark">Badge</span>' : "",
      ].filter(Boolean).join(" ");

      const queueMeta = [
        badge(row.status),
        `<span class="small text-muted">Attempts ${row.attempts}</span>`,
        `<span class="small text-muted">${esc(row.provider)}</span>`,
      ].join(" ");

      const timingLines = [
        `<div><span class="small text-muted">Queued</span><div class="mono small">${fmt(row.createdAt)}</div></div>`,
        `<div><span class="small text-muted">Due</span><div class="mono small">${fmt(row.sendAfter)}</div></div>`,
        `<div><span class="small text-muted">Sent</span><div class="mono small">${fmt(row.sentAt)}</div></div>`,
      ].join("");

      const detailLines = [
        `<div class="small text-muted">Outbox</div><div class="mono small">${esc(row.id)}</div>`,
        row.providerMessageId
          ? `<div class="small text-muted mt-2">Provider Message</div><div class="mono small">${esc(row.providerMessageId)}</div>`
          : "",
        showFailureDetails
          ? `<details class="mt-2"><summary class="small text-danger">Failure details</summary><div class="small text-danger mt-2">${esc(row.lastError)}</div></details>`
          : '<div class="small text-muted mt-2">No delivery error recorded.</div>',
      ].join("");

      return (
        "<tr>" +
          `<td><input class="form-check-input" type="checkbox" data-outbox-select="${esc(row.id)}"></td>` +
          `<td><div class="fw-semibold">${esc(row.recipientName || row.recipientEmail)}</div>` +
          `<div class="mono small text-muted">${esc(row.recipientEmail)}</div>` +
          (eventBits.length ? `<div class="small text-muted mt-1">${esc(eventBits.join(" | "))}</div>` : "") +
          "</td>" +
          `<td><div class="fw-semibold">${esc(row.subject || "PKI Consortium Update")}</div>` +
          `<div class="d-flex flex-wrap gap-1 mt-1">${subjectMeta}</div></td>` +
          `<td><div class="d-flex flex-wrap gap-1 align-items-center">${queueMeta}</div>` +
          `<div class="small text-muted mt-2">Updated ${esc(fmt(row.updatedAt))}</div></td>` +
          `<td>${timingLines}</td>` +
          `<td>${detailLines}</td>` +
        "</tr>"
      );
    }),
    "No outbox rows match the current filters",
  );
}

async function loadEmail(): Promise<void> {
  const el = q("#m-body");
  if (!el) return;
  el.innerHTML = spinner();
  _adminEmailOutboxSelectedIds.clear();
  try {
    const outboxQuery = new URLSearchParams({
      limit: String(_adminEmailOutboxState.pageSize),
      offset: String(_adminEmailOutboxState.offset),
    });
    if (_adminEmailOutboxState.status) outboxQuery.set("status", _adminEmailOutboxState.status);
    if (_adminEmailOutboxState.messageType) outboxQuery.set("messageType", _adminEmailOutboxState.messageType);
    if (_adminEmailOutboxState.q) outboxQuery.set("q", _adminEmailOutboxState.q);

    const [s, outboxData] = await Promise.all([
      api<StatsResponse>("/api/v1/admin/stats"),
      api<AdminEmailOutboxResponse>(`/api/v1/admin/email/outbox?${outboxQuery.toString()}`),
    ]);
    const ob = s.email.outboxByStatus;
    const currentPage = Math.floor(outboxData.page.offset / Math.max(1, outboxData.page.limit)) + 1;
    el.innerHTML =
      '<div class="stat-grid mb-4">' +
        Object.entries(ob)
          .map(
            ([k, v]) =>
              `<div class="stat-card${v > 0 && k === "failed" ? " danger" : ""}">` +
              `<div class="val">${v}</div><div class="lbl">${esc(k)}</div></div>`,
          )
          .join("") +
      "</div>" +
      '<div class="action-card mb-4">' +
        '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-start mb-3">' +
          '<div>' +
            '<strong>Email Outbox</strong>' +
            '<p class="mb-0 text-muted small">Inspect queued, retrying, sent, and failed email rows with recipient, subject, and delivery context.</p>' +
          '</div>' +
          '<div class="d-flex gap-2 flex-wrap">' +
            '<button class="btn btn-sm btn-outline-secondary" id="email-outbox-refresh">Refresh</button>' +
            '<button class="btn btn-sm btn-outline-secondary" id="email-outbox-clear">Clear filters</button>' +
          '</div>' +
        '</div>' +
        '<div class="row g-2 align-items-end mb-3">' +
          '<div class="col-md-3"><label class="form-label small fw-semibold mb-1">Status</label>' +
          `<select class="form-select form-select-sm" id="email-outbox-status">` +
            `<option value="">All statuses</option>` +
            `<option value="queued"${_adminEmailOutboxState.status === "queued" ? " selected" : ""}>Queued</option>` +
            `<option value="retrying"${_adminEmailOutboxState.status === "retrying" ? " selected" : ""}>Retrying</option>` +
            `<option value="sending"${_adminEmailOutboxState.status === "sending" ? " selected" : ""}>Sending</option>` +
            `<option value="sent"${_adminEmailOutboxState.status === "sent" ? " selected" : ""}>Sent</option>` +
            `<option value="failed"${_adminEmailOutboxState.status === "failed" ? " selected" : ""}>Failed</option>` +
          '</select></div>' +
          '<div class="col-md-3"><label class="form-label small fw-semibold mb-1">Message type</label>' +
          `<select class="form-select form-select-sm" id="email-outbox-type">` +
            `<option value="">All message types</option>` +
            `<option value="transactional"${_adminEmailOutboxState.messageType === "transactional" ? " selected" : ""}>Transactional</option>` +
            `<option value="promotional"${_adminEmailOutboxState.messageType === "promotional" ? " selected" : ""}>Promotional</option>` +
          '</select></div>' +
          '<div class="col-md-4"><label class="form-label small fw-semibold mb-1">Search</label>' +
          `<input type="search" class="form-control form-control-sm" id="email-outbox-search" value="${esc(_adminEmailOutboxState.q)}" placeholder="Recipient, subject, template, event, or error">` +
          '</div>' +
          '<div class="col-md-2 d-grid"><button class="btn btn-sm btn-primary" id="email-outbox-apply">Apply</button></div>' +
        '</div>' +
        '<div class="row g-3 mb-3">' +
          '<div class="col-md-6"><div class="border rounded p-3 h-100">' +
            '<div class="small text-muted mb-2">Status mix in current view</div>' +
            `<div class="d-flex flex-wrap gap-2">${emailOutboxSummaryBadges(outboxData.summary.byStatus)}</div>` +
          '</div></div>' +
          '<div class="col-md-6"><div class="border rounded p-3 h-100">' +
            '<div class="small text-muted mb-2">Message types, top templates, and due queue</div>' +
            `<div class="d-flex flex-wrap gap-2 mb-2">${emailOutboxSummaryBadges(outboxData.summary.byMessageType)}</div>` +
            '<div class="d-flex flex-wrap gap-2">' +
              (outboxData.summary.topTemplates.length
                ? outboxData.summary.topTemplates.map((item) => `<span class="badge text-bg-light border text-dark">${esc(item.template_key)}: ${item.count}</span>`).join("")
                : '<span class="text-muted small">No template usage in this view</span>') +
            '</div>' +
            `<div class="small text-muted mt-2">${emailOutboxSummaryBadges(outboxData.summary.dueByStatus)}</div>` +
          '</div></div>' +
        '</div>' +
        '<div class="border rounded p-3 mb-3 bg-light-subtle">' +
          '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">' +
            '<div>' +
              '<div class="small text-muted mb-1">Queue actions</div>' +
              `<div class="small" id="email-outbox-selection-status">Due now: ${outboxData.summary.dueNow}. Select visible rows to process due queued/retrying emails or reset failed ones.</div>` +
            '</div>' +
            '<div class="d-flex flex-wrap gap-2 align-items-end">' +
              '<div><label class="form-label small fw-semibold mb-1">Queue batch limit</label>' +
              '<input type="number" class="form-control form-control-sm" id="retry-limit" value="20" min="1" max="100" style="width:90px"></div>' +
              '<div class="form-check mt-4"><input class="form-check-input" type="checkbox" id="email-outbox-select-visible"><label class="form-check-label small" for="email-outbox-select-visible">Select visible</label></div>' +
              '<button class="btn btn-sm btn-success" id="btn-do-retry">Process due queue</button>' +
              '<button class="btn btn-sm btn-outline-success" id="btn-do-retry-selected" disabled>Process selected</button>' +
              '<button class="btn btn-sm btn-outline-danger" id="btn-do-reset-selected" disabled>Reset selected failed</button>' +
              '<button class="btn btn-sm btn-danger" id="btn-do-reset-failed">Reset all failed</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        `<div id="email-outbox-table">${renderEmailOutboxTable(outboxData.outbox)}</div>` +
        `<div id="email-outbox-pager" class="mt-3">${pagerHtml(currentPage, outboxData.page.hasMore, outboxData.page.limit, outboxData.page.offset, outboxData.outbox.length, outboxData.page.total)}</div>` +
      '</div>';
      const applyOutboxFilters = (): void => {
        _adminEmailOutboxState.status = q<HTMLSelectElement>("#email-outbox-status")?.value ?? "";
        _adminEmailOutboxState.messageType = q<HTMLSelectElement>("#email-outbox-type")?.value ?? "";
        _adminEmailOutboxState.q = q<HTMLInputElement>("#email-outbox-search")?.value.trim() ?? "";
        _adminEmailOutboxState.offset = 0;
        void loadEmail();
      };

      const syncSelectionUi = (): void => {
        const visibleSelected = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id));
        const processableSelected = visibleSelected.filter((row) => isOutboxDueNow(row));
        const failedSelected = visibleSelected.filter((row) => row.status === "failed");
        const selectVisible = q<HTMLInputElement>("#email-outbox-select-visible");
        if (selectVisible) {
          selectVisible.checked = visibleSelected.length > 0 && visibleSelected.length === outboxData.outbox.length;
          selectVisible.indeterminate = visibleSelected.length > 0 && visibleSelected.length < outboxData.outbox.length;
        }
        const selectionStatus = q("#email-outbox-selection-status");
        if (selectionStatus) {
          selectionStatus.textContent =
            `${visibleSelected.length} visible row(s) selected. ` +
            `${processableSelected.length} can be processed now, ${failedSelected.length} can be reset from failed.`;
        }
        const retrySelectedBtn = q<HTMLButtonElement>("#btn-do-retry-selected");
        if (retrySelectedBtn) retrySelectedBtn.disabled = processableSelected.length === 0;
        const resetSelectedBtn = q<HTMLButtonElement>("#btn-do-reset-selected");
        if (resetSelectedBtn) resetSelectedBtn.disabled = failedSelected.length === 0;
      };

      q("#email-outbox-select-visible")?.addEventListener("change", (event) => {
        const checked = (event.currentTarget as HTMLInputElement).checked;
        outboxData.outbox.forEach((row) => {
          if (checked) {
            _adminEmailOutboxSelectedIds.add(row.id);
          } else {
            _adminEmailOutboxSelectedIds.delete(row.id);
          }
        });
        document.querySelectorAll<HTMLInputElement>("[data-outbox-select]").forEach((input) => {
          input.checked = checked;
        });
        syncSelectionUi();
      });
      document.querySelectorAll<HTMLInputElement>("[data-outbox-select]").forEach((input) => {
        input.addEventListener("change", () => {
          const id = input.dataset.outboxSelect ?? "";
          if (!id) return;
          if (input.checked) {
            _adminEmailOutboxSelectedIds.add(id);
          } else {
            _adminEmailOutboxSelectedIds.delete(id);
          }
          syncSelectionUi();
        });
      });
      syncSelectionUi();

      q("#email-outbox-refresh")?.addEventListener("click", () => void loadEmail());
      q("#email-outbox-clear")?.addEventListener("click", () => {
        _adminEmailOutboxState = {
          status: "",
          messageType: "",
          q: "",
          offset: 0,
          pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
        };
        void loadEmail();
      });
      q("#email-outbox-apply")?.addEventListener("click", applyOutboxFilters);
      q("#email-outbox-status")?.addEventListener("change", applyOutboxFilters);
      q("#email-outbox-type")?.addEventListener("change", applyOutboxFilters);
      q<HTMLInputElement>("#email-outbox-search")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyOutboxFilters();
      });
      q("#email-outbox-pager [data-page-prev]")?.addEventListener("click", () => {
        _adminEmailOutboxState.offset = Math.max(0, outboxData.page.offset - outboxData.page.limit);
        void loadEmail();
      });
      q("#email-outbox-pager [data-page-next]")?.addEventListener("click", () => {
        _adminEmailOutboxState.offset = outboxData.page.offset + outboxData.page.limit;
        void loadEmail();
      });
      document.querySelectorAll<HTMLButtonElement>("#email-outbox-pager [data-page-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const page = Number(btn.dataset.pageJump || "1");
          if (!Number.isFinite(page) || page < 1) return;
          _adminEmailOutboxState.offset = (page - 1) * outboxData.page.limit;
          void loadEmail();
        });
      });
      q<HTMLSelectElement>("#email-outbox-pager [data-page-size]")?.addEventListener("change", (event) => {
        const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
        if (!Number.isFinite(nextSize) || nextSize < 1) return;
        _adminEmailOutboxState.pageSize = nextSize;
        _adminEmailOutboxState.offset = 0;
        void loadEmail();
      });
      q("#btn-do-retry")?.addEventListener("click", () => void doRetry());
      q("#btn-do-retry-selected")?.addEventListener("click", () => {
        const ids = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id) && isOutboxDueNow(row)).map((row) => row.id);
        void doRetry(ids);
      });
      q("#btn-do-reset-selected")?.addEventListener("click", () => {
        const ids = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id) && row.status === "failed").map((row) => row.id);
        void doResetFailed(ids);
      });
      q("#btn-do-reset-failed")?.addEventListener("click", () => void doResetFailed());
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function doRunJobs(dryRun: boolean): Promise<void> {
  const btn = q<HTMLButtonElement>(dryRun ? "#btn-preview-jobs" : "#btn-run-jobs");
  const statusEl = q("#jobs-run-status");

  syncJobsStateFromInputs();
  const reminderLimit = _adminJobsState.reminderLimit;
  const outboxLimit = _adminJobsState.outboxLimit;
  const runReminders = true;
  const runOutbox = true;
  const runRetention = _adminJobsState.runRetention;

  if (btn) { btn.disabled = true; btn.textContent = dryRun ? "Refreshing..." : "Processing..."; }
  if (statusEl) statusEl.textContent = dryRun ? "Previewing due work..." : "Processing due reminders and outbox...";

  try {
    const result = await api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
      method: "POST",
      body: JSON.stringify({
        reminderLimit,
        outboxLimit,
        runReminders,
        runRetention,
        runOutbox,
        runRetentionMode: "always",
        retentionHourUtc: 0,
        dryRun,
      }),
    });

    if (dryRun) {
      _adminJobsPreview = result;
    } else {
      _adminJobsLastRun = result;
    }
    const retentionState = runRetention
      ? (result.shouldRunRetention ? (dryRun ? "would run" : "ran") : (dryRun ? "would skip" : "skipped"))
      : "not requested";
    const msg = dryRun
      ? `Preview: ${result.reminders.processed} reminders, ${result.outbox.dueNow} outbox rows due now, cleanup ${retentionState}.`
      : `Processed ${result.reminders.processed} reminders, ${result.outbox.processed} outbox rows, ${result.outbox.failed} outbox failures, cleanup ${retentionState}.`;
    toast(msg, "success");
    if (statusEl) statusEl.textContent = msg;
    await Promise.all([loadDueWork(), loadEmail()]);
  } catch (err) {
    const msg = (err as Error).message;
    toast(msg, "error");
    if (statusEl) statusEl.textContent = msg;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = dryRun ? "Refresh Preview" : "Process Due Work Now"; }
  }
}

async function doRetry(ids?: string[]): Promise<void> {
  const lim = parseInt(q<HTMLInputElement>("#retry-limit")?.value ?? "20") || 20;
  try {
    const r = await api<{ processed?: number; failed?: number; skipped?: number }>("/api/v1/internal/email/retry", {
      method: "POST",
      body: JSON.stringify(ids?.length ? { limit: ids.length, ids } : { limit: lim }),
    });
    const extra = ids?.length ? `, skipped ${r.skipped ?? 0}` : "";
    toast(`Processed ${r.processed ?? 0}, failed ${r.failed ?? 0}${extra}`, "success");
    await loadEmail();
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

async function doResetFailed(ids?: string[]): Promise<void> {
  try {
    const r = await api<{ reset?: number; processed?: number }>("/api/v1/internal/email/reset-failed", {
      method: "POST",
      body: JSON.stringify(ids?.length ? { ids } : {}),
    });
    toast(`Reset ${r.reset ?? 0} failed, sent ${r.processed ?? 0}`, "success");
    await loadEmail();
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

// ── Donations ──────────────────────────────────────────────────────────────────

interface DonationRow {
  id: string;
  checkout_session_id: string;
  payment_intent_id: string | null;
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
  net_amount: number | null;
  source: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface DonationsResponse {
  donations: DonationRow[];
  summary: Record<string, number>;
  limit: number;
  offset: number;
}

interface DonationSyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "still_pending" | "error";
  error?: string;
}

interface DonationSyncResponse {
  synced: number;
  completed: number;
  expired: number;
  errors: number;
  results: DonationSyncResult[];
}

let _donFilter = "";

function fmtAmount(smallestUnit: number, currency: string): string {
  const zeroDecimal = new Set(["bif","clp","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"]);
  const major = zeroDecimal.has(currency.toLowerCase()) ? smallestUnit : smallestUnit / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: currency.toUpperCase(),
      minimumFractionDigits: 0, maximumFractionDigits: zeroDecimal.has(currency.toLowerCase()) ? 0 : 2,
    }).format(major);
  } catch { return `${major} ${currency.toUpperCase()}`; }
}

async function loadDonations(filter?: string): Promise<void> {
  const el = q("#don-body");
  if (!el) return;
  if (filter !== undefined) _donFilter = filter;
  el.innerHTML = spinner();
  try {
    const qs = _donFilter ? `?status=${encodeURIComponent(_donFilter)}` : "";
    const data = await api<DonationsResponse>(`/api/v1/admin/donations${qs}`);

    const total     = Object.values(data.summary).reduce((s, v) => s + v, 0);
    const completed = data.summary["completed"] ?? 0;
    const pending   = data.summary["pending"] ?? 0;
    const expired   = data.summary["expired"] ?? 0;
    const failed    = data.summary["failed"] ?? 0;

    const filterBtns = (["", "pending", "completed", "expired", "failed"] as const).map((f) => {
      const active = _donFilter === f ? " active" : "";
      const label  = f ? f.charAt(0).toUpperCase() + f.slice(1) : "All";
      const cnt    = f === "" ? total : (data.summary[f] ?? 0);
      return `<button class="btn btn-sm btn-outline-secondary${active}" data-don-filter="${f}">${label} <span class="badge text-bg-secondary">${cnt}</span></button>`;
    }).join(" ");

    const rows = data.donations.map((d) => {
      const donBadge = badge(d.status);
      const gross = fmtAmount(d.gross_amount, d.currency);
      const net   = d.net_amount !== null ? fmtAmount(d.net_amount, d.currency) : "—";
      const syncBtn = d.status === "pending"
        ? `<button class="btn btn-xs btn-outline-primary btn-don-sync" data-session="${esc(d.checkout_session_id)}" style="font-size:.7rem;padding:.1rem .4rem">Sync</button>`
        : "";
      const badgeBtn = d.status === "completed"
        ? `<a class="btn btn-xs btn-outline-secondary" href="/api/v1/og/donation/${esc(d.checkout_session_id)}?name=${encodeURIComponent(d.name)}" download="${esc(d.name.replace(/[^\w\s-]/g, ""))}-donation-badge.jpeg" style="font-size:.7rem;padding:.1rem .4rem">🖼 Badge</a>`
        : "";
      return `<tr>
        <td class="mono small">${esc(d.checkout_session_id.slice(0, 24))}…</td>
        <td>${esc(d.name)}<br><small class="text-muted">${esc(d.email)}</small>${d.organization ? `<br><small class="text-muted">${esc(d.organization)}</small>` : ""}</td>
        <td>${gross}<br><small class="text-muted">Net: ${net}</small></td>
        <td>${donBadge} ${syncBtn}${badgeBtn}</td>
        <td class="small text-muted">${d.source ? esc(d.source) : "—"}</td>
        <td class="small text-muted">${fmt(d.created_at)}</td>
        <td class="small text-muted">${fmt(d.completed_at)}</td>
      </tr>`;
    });

    el.innerHTML =
      `<ul class="nav nav-tabs mb-3" id="don-tabs" role="tablist">` +
        `<li class="nav-item"><button class="nav-link active" data-don-tab="list">Donations</button></li>` +
        `<li class="nav-item"><button class="nav-link" data-don-tab="promoters">Share Links</button></li>` +
      `</ul>` +
      `<div id="don-tab-list">` +
        `<div class="d-flex align-items-center gap-2 mb-3 flex-wrap">` +
          filterBtns +
          `<div class="ms-auto d-flex gap-2">` +
            `<button class="btn btn-sm btn-success" id="btn-don-sync-pending">↺ Sync all pending (${pending})</button>` +
            (failed > 0 ? `<span class="badge text-bg-danger ms-1" title="Payment failed">${failed} failed</span>` : "") +
          `</div>` +
        `</div>` +
        tbl(
          ["Session ID", "Donor", "Amount", "Status", "Source", "Created", "Completed"],
          rows,
          "No donations found",
        ) +
      `</div>` +
      `<div id="don-tab-promoters" class="d-none">` +
        `<div class="d-flex justify-content-end mb-2">` +
          `<button class="btn btn-sm btn-outline-secondary" id="btn-promoters-refresh">↺ Refresh</button>` +
        `</div>` +
        `<div id="don-promoters-body"></div>` +
      `</div>`;

    // Tab switching
    el.querySelectorAll<HTMLButtonElement>("[data-don-tab]").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        el.querySelectorAll<HTMLButtonElement>("[data-don-tab]").forEach((b) => b.classList.remove("active"));
        tabBtn.classList.add("active");
        const tab = tabBtn.dataset.donTab!;
        el.querySelectorAll<HTMLElement>("[id^='don-tab-']").forEach((pane) => {
          pane.classList.toggle("d-none", pane.id !== `don-tab-${tab}`);
        });
        if (tab === "promoters") void loadDonationPromoters();
      });
    });

    // Promoters refresh (rendered inside tab pane)
    el.querySelector<HTMLButtonElement>("#btn-promoters-refresh")?.addEventListener("click", () => void loadDonationPromoters());

    // Filter buttons
    el.querySelectorAll<HTMLButtonElement>("[data-don-filter]").forEach((btn) => {
      btn.addEventListener("click", () => void loadDonations(btn.dataset.donFilter!));
    });

    // Per-row sync button
    el.querySelectorAll<HTMLButtonElement>(".btn-don-sync").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sessionId = btn.dataset.session!;
        btn.disabled = true;
        btn.textContent = "…";
        api<DonationSyncResponse>("/api/v1/admin/donations/sync", {
          method: "POST",
          body: JSON.stringify({ sessionIds: [sessionId] }),
        })
          .then((res) => {
            const r = res.results[0];
            if (r?.outcome === "completed") toast("Donation marked as completed.", "success");
            else if (r?.outcome === "expired") toast("Session expired — donation marked expired.", "info");
            else if (r?.outcome === "still_pending") toast("Session still pending on Stripe.", "info");
            else toast(r?.error ?? "Sync failed.", "error");
            void loadDonations();
          })
          .catch((err: Error) => { toast(err.message, "error"); btn.disabled = false; btn.textContent = "Sync"; });
      });
    });

    // Sync all pending
    q<HTMLButtonElement>("#btn-don-sync-pending")?.addEventListener("click", () => {
      if (pending === 0) { toast("No pending donations to sync.", "info"); return; }
      const btn = q<HTMLButtonElement>("#btn-don-sync-pending");
      if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
      api<DonationSyncResponse>("/api/v1/admin/donations/sync", { method: "POST" })
        .then((res) => {
          toast(`Synced ${res.synced}: ${res.completed} completed, ${res.expired} expired, ${res.errors} errors.`,
            res.errors > 0 ? "error" : "success");
          void loadDonations();
        })
        .catch((err: Error) => { toast(err.message, "error"); void loadDonations(); });
    });

    void loadDonationPromoters();

  } catch (err) {
    if (el) el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function loadDonationPromoters(): Promise<void> {
  const el = q("#don-promoters-body");
  if (!el) return;
  el.innerHTML = spinner();
  try {
    const data = await api<{ promoters: Array<{
      code: string;
      name: string | null;
      checkout_session_id: string | null;
      clicks: number;
      attributed_total: number;
      attributed_completed: number;
      attributed_gross: number;
      currency: string | null;
      created_at: string;
    }> }>("/api/v1/admin/donations/promoters");

    const appBase = window.location.origin;
    el.innerHTML = tbl(
      ["Name", "Share URL", "Clicks", "Attributed (compl.)", "Attributed Gross", "Created"],
      data.promoters.map((p) => {
        const shareUrl = `${appBase}/donate/r/${esc(p.code)}`;
        const gross = p.attributed_gross > 0 && p.currency
          ? fmtMoney(p.attributed_gross, p.currency)
          : "\u2014";
        return `<tr>
          <td>${p.name ? esc(p.name) : `<span class="text-muted fst-italic">anonymous</span>`}</td>
          <td class="mono small"><a href="${shareUrl}" target="_blank" rel="noopener">/donate/r/${esc(p.code)}</a></td>
          <td>${p.clicks}</td>
          <td>${p.attributed_completed} / ${p.attributed_total}</td>
          <td class="mono">${gross}</td>
          <td class="small text-muted">${fmt(p.created_at)}</td>
        </tr>`;
      }),
      "No promoter links yet",
    );
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

async function loadStats(): Promise<void> {
  const el = q("#r-body");
  if (!el) return;
  el.innerHTML = spinner();
  try {
    const s = await api<StatsResponse>("/api/v1/admin/stats");
    const primaryCurrency = s.donations.byCurrency.find((r) => r.status === "completed")?.currency ?? "usd";

    const donationPeriodRows = (rows: Array<{ gross: number } & DonationPeriod>, keyCol: string, keyVal: (r: DonationPeriod & { gross: number }) => string) =>
      rows.map((d) =>
        `<tr><td class="mono">${esc(keyVal(d))}</td><td>${d.count}</td><td>${d.completed}</td>` +
        `<td>${d.pending}</td><td>${d.failed}</td><td>${d.expired}</td>` +
        `<td class="mono">${d.gross > 0 ? fmtMoney(d.gross, primaryCurrency) : "\u2014"}</td></tr>`,
      );

    const tabContent = {
      overview:
        '<div class="row g-3">' +
          '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations</h6>' +
            tbl(
              ["Status", "Count"],
              Object.entries(s.registrations.byStatus).map(([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td></tr>`),
              "None",
            ) +
          "</div></div></div>" +
          '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Invites</h6>' +
            tbl(
              ["Status", "Count"],
              Object.entries(s.invites.byStatus).map(([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td></tr>`),
              "None",
            ) +
          "</div></div></div>" +
        "</div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Activity — last 30 days</h6>' +
          tbl(
            ["Date", "Registrations", "Invites"],
            s.recentActivity.map((d) => `<tr><td class="mono">${esc(d.date)}</td><td>${d.registrations}</td><td>${d.invites}</td></tr>`),
            "No data",
          ) +
        "</div></div>",

      registrations:
        '<div class="card border-0 shadow-sm"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Weekly (last 12 weeks)</h6>' +
          tbl(
            ["Week", "Count"],
            s.registrations.weekly.map((d) => `<tr><td class="mono">${esc(d.week)}</td><td>${d.count}</td></tr>`),
            "No data",
          ) +
        "</div></div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Monthly (last 12 months)</h6>' +
          tbl(
            ["Month", "Count"],
            s.registrations.monthly.map((d) => `<tr><td class="mono">${esc(d.month)}</td><td>${d.count}</td></tr>`),
            "No data",
          ) +
        "</div></div>",

      donations:
        '<div class="card border-0 shadow-sm"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations by Status &amp; Currency</h6>' +
          tbl(
            ["Status", "Currency", "Count", "Gross", "Avg Gross", "Net Total"],
            s.donations.byCurrency.map((d) =>
              `<tr><td>${badge(d.status)}</td>` +
              `<td class="mono">${esc(d.currency.toUpperCase())}</td>` +
              `<td>${d.count}</td>` +
              `<td class="mono">${fmtMoney(d.total_gross, d.currency)}</td>` +
              `<td class="mono">${fmtMoney(d.avg_gross, d.currency)}</td>` +
              `<td class="mono">${d.total_net != null ? fmtMoney(d.total_net, d.currency) : `\u2014 <span class="text-muted small">(${esc(d.status)})</span>`}</td></tr>`,
            ),
            "No donations",
          ) +
        "</div></div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Daily (last 30 days)</h6>' +
          tbl(
            ["Date", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
            donationPeriodRows(s.donations.daily, "date", (d) => (d as { date: string } & DonationPeriod).date),
            "No data",
          ) +
        "</div></div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Weekly (last 12 weeks)</h6>' +
          tbl(
            ["Week", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
            donationPeriodRows(s.donations.weekly, "week", (d) => (d as { week: string } & DonationPeriod).week),
            "No data",
          ) +
        "</div></div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Monthly (last 12 months)</h6>' +
          tbl(
            ["Month", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
            donationPeriodRows(s.donations.monthly, "month", (d) => (d as { month: string } & DonationPeriod).month),
            "No data",
          ) +
        "</div></div>" +
        '<details class="card border-0 shadow-sm mt-3">' +
          '<summary class="card-body text-muted small" style="cursor:pointer">JSON export (for automated reporting)</summary>' +
          `<div class="card-body pt-0"><pre class="json-out">${esc(JSON.stringify(s, null, 2))}</pre></div>` +
        "</details>",
    };

    el.innerHTML =
      '<ul class="nav nav-tabs mb-3" id="stats-tabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" data-stats-tab="overview">Overview</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" data-stats-tab="registrations">Registrations</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" data-stats-tab="donations">Donations</button></li>' +
      "</ul>" +
      `<div id="stats-tab-content">${tabContent.overview}</div>`;

    // Wire tab switching via event delegation
    el.querySelector("#stats-tabs")?.addEventListener("click", (evt) => {
      const btn = (evt.target as Element).closest<HTMLButtonElement>("[data-stats-tab]");
      if (!btn) return;
      const tab = btn.dataset.statsTab as keyof typeof tabContent;
      el.querySelectorAll<HTMLButtonElement>("[data-stats-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const content = el.querySelector("#stats-tab-content");
      if (content) content.innerHTML = tabContent[tab] ?? "";
    });
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}


// ── Auth ───────────────────────────────────────────────────────────────────────

async function requestMagicLink(email: string): Promise<void> {
  await fetch("/api/v1/admin/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // Always show success to prevent email enumeration
  hide(q("#form-magic"));
  show(q("#magic-sent"));
}

async function verifyMagicLink(token: string): Promise<void> {
  show(q("#verify-overlay"));
  try {
    const res = await fetch("/api/v1/admin/auth/verify-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d: { token?: string; admin?: { email?: string }; error?: { message?: string } } =
      await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error?.message ?? "The link may have expired or already been used.");
    saveAuth(d.token!, d.admin?.email ?? null);
    history.replaceState({}, "", "/admin/");
    hide(q("#verify-overlay"));
    showApp();
  } catch (err) {
    hide(q("#verify-overlay"));
    const errEl = q("#magic-error");
    if (errEl) errEl.textContent = `✕ Sign-in failed: ${(err as Error).message}`;
    show(errEl);
    showLogin();
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadAuth();

  document.querySelectorAll<HTMLButtonElement>(".sidebar-link[data-sec]").forEach((btn) => {
    btn.addEventListener("click", () => nav(btn.dataset.sec!));
  });

  q("#btn-logout")?.addEventListener("click", () => { clearAuth(); location.reload(); });
  q("#btn-t-refresh")?.addEventListener("click", () => void loadTemplates());
  q("#btn-don-refresh")?.addEventListener("click", () => void loadDonations());
  q("#btn-duework-refresh")?.addEventListener("click", () => void loadDueWork());

  q<HTMLFormElement>("#form-magic")?.addEventListener("submit", (evt) => {
    evt.preventDefault();
    const emailEl = q<HTMLInputElement>("#inp-email");
    const email = emailEl?.value.trim() ?? "";
    if (!email) return;
    const btn = q<HTMLButtonElement>("#btn-send");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    requestMagicLink(email).finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = "Send sign-in link"; }
    });
  });

  // Handle magic link token from URL (?token=...)
  const tok = new URLSearchParams(window.location.search).get("token");
  if (tok) {
    hide(q("#login-wrap")); // prevent flash of login form before verification
    void verifyMagicLink(tok);
    return;
  }

  if (_token) { hide(q("#login-wrap")); showApp(); }
  // else: login form is visible by default
});
