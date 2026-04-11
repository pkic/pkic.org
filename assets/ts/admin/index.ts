/**
 * Admin console SPA — compiled by Hugo's esbuild pipeline (assets/ts/admin.ts).
 * Loaded via {{ partial "script.html" }} to satisfy CSP script-src 'self'.
 * All event handlers are wired via addEventListener — no inline onclick attributes.
 */

import { z } from "zod";
import { loadAuditLog, type AuditLogEntry } from "./audit-log";
import { eventStatsTabHtml, loadEventStats } from "./event-stats";
import { createDonationsSection } from "./donations";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { createReportsSection, type StatsResponse } from "./reports";
import { createUsersSection } from "./users";
import { badge, esc, fmt, hide, q, resetButton, setButtonLoading, show, spinner, tbl, toast } from "./ui";
import { createEmailTemplatesSection, type EmailTemplateVersion } from "./email-templates";
import { newEventFormHtml, detailsFormHtml, loadEventDays, doSaveDetails, eventDaysTabHtml } from "./event-settings";
import { eventTermsTabHtml, loadEventTerms, eventFormsTabHtml, loadEventForms } from "./event-config";
import { teamTabHtml, loadEventPermissions, addPermission, revokePermission } from "./event-team";
import { AdminEventDay, EventDetail, EventPermission, AdminEventFormSummary, AdminFormDetailField, AdminFormSubmission } from "./types";

const _emailValidator = z.email();

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
  rsvp_events_json?: string | null;
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

// ── State ──────────────────────────────────────────────────────────────────────

let _token: string | null = null;
let _email: string | null = null;
let _evList: EventSummary[] = [];
let _currentEventDetail: EventDetail | null = null;
let _proposalAccessByEventSlug: Record<string, ProposalAccess> = {};

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

function closeSidebar(): void {
  q("#admin-sidebar")?.classList.remove("open");
  q("#sidebar-backdrop")?.classList.remove("active");
  q("#sidebar-toggle")?.setAttribute("aria-expanded", "false");
}

const { loadUsers } = createUsersSection({
  api,
  esc,
  fmt,
  getAuthToken: () => _token,
  hide,
  q,
  show,
  spinner,
  tbl,
  toast,
});
const { loadTemplates } = createEmailTemplatesSection(api);
const { loadDonations } = createDonationsSection({
  api,
  badge,
  esc,
  fmt,
  q,
  spinner,
  tbl,
  toast,
});
const { loadDashboard, loadStats } = createReportsSection({
  api,
  goToSection: nav,
  openEvent,
});

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
    auditlog: () => loadAuditLog(api),
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
          '<li class="nav-item"><button class="nav-link" data-main-tab="event-stats">Stats</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-main-tab="settings">Event Settings</button></li>' +
        '</ul>' +
        `<div id="et-registrations">${registrationsGroupTabHtml(slug)}</div>` +
        `<div id="et-proposals-group" class="d-none">${proposalsGroupTabHtml()}</div>` +
        `<div id="et-promoters" class="d-none">${promotersTabHtml()}</div>` +
        `<div id="et-event-stats" class="d-none">${eventStatsTabHtml()}</div>` +
        `<div id="et-settings" class="d-none">${eventSettingsTabHtml()}</div>` +
      '</div></div>';

    q("#btn-close-event")?.addEventListener("click", closeEvent);

    det.querySelectorAll<HTMLButtonElement>("[data-main-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        det.querySelectorAll<HTMLButtonElement>("[data-main-tab]").forEach((b) => b.classList.remove("active"));
        ["registrations", "proposals-group", "promoters", "event-stats", "settings"].forEach((id) => hide(q(`#et-${id}`)));
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
        if (tab === "event-stats") {
          show(q("#et-event-stats"));
          void loadEventStats(api, slug);
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
  return (
    '<div id="regs-stats" class="mb-2"></div>' +
    '<div class="d-flex gap-2 align-items-center mb-2 flex-wrap">' +
      '<input type="search" class="form-control form-control-sm" id="regs-search" placeholder="Search name / email…" style="max-width:260px" autocomplete="off">' +
      '<select class="form-select form-select-sm" id="regs-status-filter" style="width:auto">' +
        '<option value="">All statuses</option>' +
        '<option value="registered">Confirmed</option>' +
        '<option value="pending_email_confirmation">Pending confirmation</option>' +
        '<option value="waitlisted">Waitlisted</option>' +
        '<option value="cancelled">Cancelled</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="regs-list-refresh">&circlearrowright; Refresh</button>' +
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

  const searchInput = q<HTMLInputElement>("#regs-search");
  const statusSel = q<HTMLSelectElement>("#regs-status-filter");
  const refreshBtn = q<HTMLButtonElement>("#regs-list-refresh");

  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    try {
      const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      const searchVal = (searchInput?.value ?? "").trim();
      if (searchVal) query.set("q", searchVal);
      const statusVal = statusSel?.value ?? "";
      if (statusVal) query.set("status", statusVal);
      const d = await api<{
        registrations: Registration[];
        stats?: { byAttendanceType: Record<string, number>; byStatus: Record<string, number> };
        page?: { limit: number; offset: number; hasMore: boolean; total: number };
      }>(`/api/v1/admin/events/${slug}/registrations?${query.toString()}`);

      const regs = d.registrations ?? [];

      // Render attendance-type stats above the table
      const statsEl = q("#regs-stats");
      if (statsEl && d.stats?.byAttendanceType) {
        const { byAttendanceType } = d.stats;
        const labels: Record<string, string> = { in_person: "In person", virtual: "Virtual", on_demand: "On demand" };
        const total = Object.values(byAttendanceType).reduce((s, n) => s + n, 0);
        const items = Object.entries(byAttendanceType)
          .map(([k, v]) => `<span class="badge bg-secondary me-1">${esc(labels[k] ?? k)}</span><span class="fw-semibold me-3">${v}</span>`)
          .join("");
        statsEl.innerHTML =
          `<div class="d-flex align-items-center flex-wrap gap-1 small mb-1">` +
          `<span class="text-muted me-2">Attendance type:</span>${items}` +
          `<span class="text-muted ms-auto">Total: <strong>${total}</strong></span>` +
          `</div>`;
      } else if (statsEl) {
        statsEl.innerHTML = "";
      }

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
    searchInput?.addEventListener("input", () => { offset = 0; void doLoad(); });
    statusSel?.addEventListener("change", () => { offset = 0; void doLoad(); });
    refreshBtn?.addEventListener("click", () => { offset = 0; void doLoad(); });
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
      '<input type="search" class="form-control form-control-sm" id="pinv-search" placeholder="Search email / name…" style="max-width:260px" autocomplete="off">' +
      '<label class="form-label mb-0 small fw-semibold visually-hidden" for="pinv-filter">Filter status:</label>' +
      '<select class="form-select form-select-sm" id="pinv-filter" style="width:auto">' +
        '<option value="">All statuses</option>' +
        '<option value="sent" selected>Pending (sent)</option>' +
        '<option value="accepted">Accepted</option>' +
        '<option value="declined">Declined</option>' +
        '<option value="expired">Expired</option>' +
        '<option value="revoked">Revoked</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="pinv-list-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="pinv-list-body">' + spinner() + '</div>' +
    '<div id="pinv-list-pager" class="mt-2"></div>'
  );
}

function syncProposalInviteCount(): void {
  const lbl = q("#pinv-count-lbl");
  if (!lbl) return;
  const count = _proposalInviteEntries.length > 0
    ? _proposalInviteEntries.length
    : document.querySelectorAll("#pinv-rows .inv-row").length;
  lbl.textContent = count > 0 ? `${count.toLocaleString()} row${count !== 1 ? "s" : ""}` : "";
}

function collectProposalInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
  if (_proposalInviteEntries.length > 0) return _proposalInviteEntries;
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

function renderProposalBulkSummary(entries: AdminInviteEntry[]): void {
  const container = q("#pinv-rows");
  if (!container) return;
  const preview = entries.slice(0, INVITE_BULK_THRESHOLD);
  const more = entries.length - preview.length;
  const rows = preview
    .map((e) => {
      return `<tr><td class="small">${esc(e.firstName || "—")}</td><td class="small">${esc(e.lastName || "—")}</td><td class="small mono">${esc(e.email)}</td></tr>`;
    })
    .join("");
  container.innerHTML =
    `<div class="d-flex align-items-center gap-2 rounded border px-3 py-2 mb-2 small bg-light">` +
    `<span><strong>${entries.length.toLocaleString()}</strong> invites loaded from CSV</span>` +
    `<button type="button" class="btn btn-sm btn-link p-0 text-danger ms-auto" id="pinv-clear-bulk">× Clear</button>` +
    `</div>` +
    `<table class="table table-sm mb-1"><thead><tr><th class="small">First name</th><th class="small">Last name</th><th class="small">Email</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    (more > 0 ? `<div class="small text-muted ps-1">\u2026and ${more.toLocaleString()} more</div>` : "");
  container.querySelector("#pinv-clear-bulk")?.addEventListener("click", () => clearProposalBulkImport());
}

function clearProposalBulkImport(): void {
  _proposalInviteEntries = [];
  const container = q("#pinv-rows");
  if (container) container.innerHTML = "";
  addProposalInviteRow();
  syncProposalInviteCount();
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
  if (entries.length > INVITE_BULK_THRESHOLD) {
    _proposalInviteEntries = entries;
    renderProposalBulkSummary(entries);
    syncProposalInviteCount();
    return;
  }
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
    const { valid, skipped } = parseAdminInviteText(text);
    if (!valid.length) { toast(skipped > 0 ? `No valid email addresses found (${skipped} invalid)` : "No valid email addresses found in the pasted text", "error"); return; }
    addParsedProposalEntries(valid);
    const ta = q<HTMLTextAreaElement>("#pinv-paste");
    if (ta) ta.value = "";
    const skipMsg = skipped > 0 ? ` (${skipped} skipped — invalid email)` : "";
    toast(`Parsed ${valid.length} entr${valid.length !== 1 ? "ies" : "y"}${skipMsg}`, skipped > 0 ? "info" : "success");
  });

  q<HTMLInputElement>("#pinv-csv")?.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string ?? "";
      const { valid, skipped } = parseAdminCsv(text);
      if (!valid.length) { toast("No valid rows found in CSV", "error"); return; }
      addParsedProposalEntries(valid);
      const skipMsg = skipped > 0 ? ` (${skipped} row${skipped !== 1 ? "s" : ""} skipped — invalid email)` : "";
      toast(`Imported ${valid.length} row${valid.length !== 1 ? "s" : ""} from CSV${skipMsg}`, skipped > 0 ? "info" : "success");
      (e.target as HTMLInputElement).value = "";
    };
    reader.readAsText(file);
  });

  q("#pinv-add-btn")?.addEventListener("click", () => addProposalInviteRow());
  q("#pinv-send-btn")?.addEventListener("click", () => void doAdminProposalInvite(slug));
}

async function doAdminProposalInvite(slug: string): Promise<void> {
  const statusEl = q("#pinv-form-status");

  const invites = collectProposalInvites();
  if (!invites.length) {
    if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
    return;
  }

  const sendBtn = q<HTMLButtonElement>("#pinv-send-btn");
  if (sendBtn) setButtonLoading(sendBtn);
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    const chunks: typeof invites[] = [];
    for (let i = 0; i < invites.length; i += INVITE_CHUNK_SIZE) {
      chunks.push(invites.slice(i, i + INVITE_CHUNK_SIZE));
    }

    let totalCreated = 0;
    let totalEndorsed = 0;
    let totalSkipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1 && statusEl) {
        statusEl.textContent = `Sending batch ${i + 1} of ${chunks.length}…`;
        statusEl.className = "mt-2 small text-muted";
      }
      const r = await api<{ created?: unknown[]; endorsed?: unknown[]; skipped?: unknown[] }>(
        `/api/v1/admin/events/${slug}/invites/speakers/bulk`,
        { method: "POST", body: JSON.stringify({ invites: chunks[i] }) },
      );
      totalCreated  += r.created?.length  ?? 0;
      totalEndorsed += r.endorsed?.length ?? 0;
      totalSkipped  += r.skipped?.length  ?? 0;
    }

    const parts = [`✓ ${totalCreated} proposal invitation${totalCreated !== 1 ? "s" : ""} queued`];
    if (totalEndorsed) parts.push(`${totalEndorsed} already invited`);
    if (totalSkipped)  parts.push(`${totalSkipped} skipped`);
    toast(parts.join(" · "), "success");

    clearProposalBulkImport();
    if (statusEl) { statusEl.textContent = parts.join(" · "); statusEl.className = "mt-2 small text-success"; }
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
  const searchInput = q<HTMLInputElement>("#pinv-search");
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
    const searchVal = (searchInput?.value ?? "").trim();
    if (searchVal) query.set("q", searchVal);
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
    searchInput?.addEventListener("input", () => { offset = 0; void doLoad(); });
    filterSel?.addEventListener("change", () => { offset = 0; void doLoad(); });
    refreshBtn?.addEventListener("click", () => { offset = 0; void doLoad(); });
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
          `<div id="ets-days" class="d-none">${eventDaysTabHtml(_currentEventDetail?.timezone ?? "UTC")}</div>` +
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
        if (tab === "general") wireDetailsForm(slug);
        if (tab === "days") void loadEventDays(api, slug);
        if (tab === "terms") void loadEventTerms(api, slug);
        if (tab === "forms") void loadEventForms(api, slug);
        if (tab === "team") void loadEventPermissions(api, slug);
      };
    });
  }

  function wireDetailsForm(slug: string): void {
    q<HTMLFormElement>("#form-details")?.addEventListener("submit", (evt) => void doSaveDetails(evt, slug, api, (updated) => {
      _currentEventDetail = updated;
    }));
  }

function regsTable(regs: Registration[]): string {
  const rows = regs.map((r) => {
    const name = r.display_name ?? r.user_email ?? "—";
    const sub = r.display_name && r.user_email
      ? `<br><span class="text-muted small">${esc(r.user_email)}</span>`
      : "";
    const waitlistCell = r.dayWaitlistSummary
      ? esc(r.dayWaitlistSummary)
      : r.dayWaitlistCount
        ? `${r.dayWaitlistCount} day${r.dayWaitlistCount !== 1 ? "s" : ""}`
        : "—";
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

  const dayStatusMap = new Map<string, { attendanceType?: string; attendanceLabel?: string | null; waitlist?: { status: string; priorityLane: string; offerExpiresAt: string | null }, rsvp?: any, rsvpLabel?: string }>();
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

  const nonDayRsvp: any[] = [];

  if (r.rsvp_events_json) {
    try {
      const parsed = JSON.parse(r.rsvp_events_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const ev of parsed) {
          let isDaySpecific = false;
          if (ev.uid && String(ev.uid).includes("@")) {
            const dateMatch = String(ev.uid).match(/-(\d{4}-\d{2}-\d{2})@/);
            if (dateMatch) {
              isDaySpecific = true;
              const current = dayStatusMap.get(dateMatch[1]) ?? {};
              if (!current.rsvp) {
                current.rsvp = ev;
                current.rsvpLabel = "Calendar RSVP";
              }
              dayStatusMap.set(dateMatch[1], current);
            }
          }

          if (!isDaySpecific) {
            // Cannot map to a specific day — collect for display in the email section below
            nonDayRsvp.push(ev);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
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
      
      let rsvpCellHtml = `<span class="text-body-secondary">None</span>`;
      if (day.rsvp) {
        const ev = day.rsvp;
        let subDetails = "";
        let prefix = day.rsvpLabel ? `<div class="text-muted small mb-1">${esc(day.rsvpLabel)}</div>` : "";
        if (ev.warning_sent_at) subDetails += `<div class="text-warning small mt-1">Warned: ${esc(new Date(ev.warning_sent_at).toLocaleString())}</div>`;
        if (ev.action_executed_at) subDetails += `<div class="text-danger small mt-1">Enforced: ${badge(String(ev.action_taken))} at ${esc(new Date(ev.action_executed_at).toLocaleString())}</div>`;
        rsvpCellHtml = `${prefix}<div>${badge(ev.status)}</div>${subDetails}`;
      }

      return `<tr><td>${esc(dayDate)}</td><td>${attendanceHtml}</td><td>${waitlistHtml}</td><td>${rsvpCellHtml}</td></tr>`;
    })
    .join("");
  const nonDayRsvpHtml = nonDayRsvp.map((ev) => {
    let label = "Event RSVP";
    if (ev.uid && (String(ev.uid).startsWith("implicit-") || String(ev.uid).startsWith("bounce-"))) {
      label = String(ev.uid).startsWith("bounce-") ? "Email Bounce" : "Email Reply";
      if (ev.raw_payload_json) {
        try {
          const payload = typeof ev.raw_payload_json === "string" ? JSON.parse(ev.raw_payload_json) : ev.raw_payload_json;
          if (payload && payload.subject) label = `${label}: ${payload.subject}`;
        } catch (_) {}
      }
    }
    let subDetails = "";
    if (ev.warning_sent_at) subDetails += ` · <span class="text-warning">Warned: ${esc(new Date(ev.warning_sent_at).toLocaleString())}</span>`;
    if (ev.action_executed_at) subDetails += ` · <span class="text-danger">Enforced: ${badge(String(ev.action_taken))} at ${esc(new Date(ev.action_executed_at).toLocaleString())}</span>`;
    return `<div class="small"><strong>${esc(label)}:</strong> ${badge(ev.status)}${subDetails} <span class="text-muted">(no specific day)</span></div>`;
  }).join("");

  const dayStatusBlock = dayStatusMap.size > 0
    ? `<div class="mt-3"><h6 class="small fw-semibold text-uppercase text-muted mb-2">Day status</h6><p class="small text-body-secondary mb-2">Per-day waitlist offers can be admitted directly here; the attendee does not need to claim them first.</p><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Day</th><th>Attendance</th><th>Waitlist</th><th>RSVP</th></tr></thead><tbody>${dayStatusRows}</tbody></table></div>${nonDayRsvpHtml ? `<div class="mt-2">${nonDayRsvpHtml}</div>` : ""}</div>`
    : `<div class="mt-3"><h6 class="small fw-semibold text-uppercase text-muted mb-2">Day status</h6><p class="small text-body-secondary mb-0">No day-level attendance or waitlist records were returned for this registration.</p>${nonDayRsvpHtml ? `<div class="mt-2">${nonDayRsvpHtml}</div>` : ""}</div>`;

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
    `<p class="small text-muted mb-2 mt-1">Rotates the token and re-queues the email (confirm link or manage link depending on status).</p>` +
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

    dayStatusBlock +

    // ── Audit log ─────────────────────────────────────────────────────────────
    `<div class="row g-3 mt-0 border-top pt-3">` +
    `<div class="col-12">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Audit Log</h6>` +
    `<div id="rd-audit-log-${esc(r.id)}">${spinner()}</div>` +
    `</div>` +
    `</div>`
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
            // Load audit log
            void doLoadAuditLog(slug, regId);
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

async function doLoadAuditLog(slug: string, regId: string): Promise<void> {
  const container = document.getElementById(`rd-audit-log-${regId}`);
  if (!container) return;
  try {
    const { auditLog } = await api<{ auditLog: AuditLogEntry[] }>(
      `/api/v1/admin/events/${slug}/registrations/${regId}/audit-log`,
    );
    if (auditLog.length === 0) {
      container.innerHTML = `<p class="small text-body-secondary mb-0">No audit log entries found for this registration.</p>`;
      return;
    }
    const rows = auditLog.map((entry) => {
      const actorHtml = entry.actor_type === "system"
        ? `<span class="text-muted">System</span>`
        : entry.actor_display
          ? esc(entry.actor_display)
          : entry.actor_id
            ? `<span class="text-muted small">${esc(entry.actor_id)}</span>`
            : `<span class="text-muted">${esc(entry.actor_type)}</span>`;
      const detailsHtml = entry.details
        ? `<pre class="mb-0 small text-body-secondary">${esc(JSON.stringify(entry.details, null, 2))}</pre>`
        : "";
      const ts = new Date(entry.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" });
      return `<tr>
        <td class="text-nowrap small text-muted">${esc(ts)}</td>
        <td class="small">${actorHtml}</td>
        <td><code class="small">${esc(entry.action)}</code></td>
        <td>${detailsHtml}</td>
      </tr>`;
    }).join("");
    container.innerHTML =
      `<div class="table-responsive">` +
      `<table class="table table-sm align-middle mb-0">` +
      `<thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `</table></div>`;
  } catch (err) {
    container.innerHTML = `<span class="small text-danger">${esc((err as Error).message)}</span>`;
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
      '<input type="search" class="form-control form-control-sm" id="inv-search" placeholder="Search email / name…" style="max-width:260px" autocomplete="off">' +
      '<label class="form-label mb-0 small fw-semibold visually-hidden" for="inv-filter">Filter status:</label>' +
      '<select class="form-select form-select-sm" id="inv-filter" style="width:auto">' +
        '<option value="">All statuses</option>' +
        '<option value="sent" selected>Pending (sent)</option>' +
        '<option value="accepted">Accepted</option>' +
        '<option value="declined">Declined</option>' +
        '<option value="expired">Expired</option>' +
        '<option value="revoked">Revoked</option>' +
      '</select>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="inv-list-refresh">&circlearrowright; Refresh</button>' +
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
      const top100 = d.promoters.slice(0, 100);
      const promoterRows = top100.map((p, idx) => {
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
        '<h6 class="text-uppercase small fw-bold text-muted mb-2">Top Promoters &amp; Inviters' +
        (d.promoters.length > 100 ? ` <span class="fw-normal">(showing top 100 of ${d.promoters.length})</span>` : '') +
        '</h6>' +
        tbl(
          ["#", "Person", "Sent", "Accepted", "Declined", "Conv. Rate", "Link Clicks", "Link Conv.", "Impact", "Last Invite"],
          promoterRows,
          "No invite or referral activity yet — send invites or share referral links to see data here.",
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

function parseAdminInviteText(raw: string): { valid: AdminInviteEntry[]; skipped: number } {
  const results: AdminInviteEntry[] = [];
  let skipped = 0;
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // "First Last" <email>  or  First Last <email>
    const angleBracket = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
    if (angleBracket) {
      const namePart = angleBracket[1].trim();
      const email = angleBracket[2].trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
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
      const email = csv[2].toLowerCase();
      if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
      results.push({ firstName: csv[0] || undefined, lastName: csv[1] || undefined, email });
      continue;
    }
    // Plain email(s) separated by commas/semicolons
    for (const atom of line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
      if (!atom.includes("@")) continue;
      const email = atom.toLowerCase();
      if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
      const entry: AdminInviteEntry = { email };
      const local = email.split("@")[0];
      const dotParts = local.split(".").filter(Boolean);
      if (dotParts.length >= 2) {
        entry.firstName = adminCapWord(dotParts[0]);
        entry.lastName = adminCapWord(dotParts.slice(1).join(" "));
      }
      results.push(entry);
    }
  }
  const seen = new Set<string>();
  const valid = results.filter((e) => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });
  return { valid, skipped };
}

const EMAIL_REGEX = { test: (s: string) => _emailValidator.safeParse(s).success };

function parseAdminCsv(text: string): { valid: AdminInviteEntry[]; skipped: number } {
  // Strip UTF-8 BOM that Excel adds to CSV exports.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { valid: [], skipped: 0 };
  // Detect header row: first line with no '@' and contains commas
  let dataStart = 0;
  const header = lines[0].toLowerCase();
  const colEmail = header.includes("email") ? header.split(",").findIndex((c) => c.includes("email")) : -1;
  const colFirst = header.split(",").findIndex((c) => c.includes("first"));
  const colLast  = header.split(",").findIndex((c) => c.includes("last"));
  if (colEmail !== -1) { dataStart = 1; } // has header
  const valid: AdminInviteEntry[] = [];
  let skipped = 0;
  for (let i = dataStart; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (colEmail !== -1) {
      const email = parts[colEmail]?.trim().toLowerCase() ?? "";
      if (!EMAIL_REGEX.test(email)) { skipped++; continue; }
      const entry: AdminInviteEntry = { email };
      if (colFirst !== -1) { entry.firstName = parts[colFirst] || undefined; }
      if (colLast  !== -1) { entry.lastName  = parts[colLast]  || undefined; }
      if (colFirst === -1 && colLast === -1) {
        const local = email.split("@")[0];
        const dotParts = local.split(".").filter(Boolean);
        if (dotParts.length >= 2) {
          entry.firstName = adminCapWord(dotParts[0]);
          entry.lastName  = adminCapWord(dotParts.slice(1).join(" "));
        }
      }
      valid.push(entry);
    } else {
      // No header: treat as plain text
      const parsed = parseAdminInviteText(lines[i]);
      valid.push(...parsed.valid);
      skipped += parsed.skipped;
    }
  }
  return { valid, skipped };
}

// ── Admin invite row management ──────────────────────────────────────────────

const MAX_ADMIN_INVITES = 500;
/** Show at most this many rows in the DOM when a large CSV is imported. */
const INVITE_BULK_THRESHOLD = 10;
/** Entries per POST when chunking a large invite list across multiple requests. */
// D1/SQLite hard-limits bind variables per statement to 999.
// The pre-check queries bind up to N+2 variables, so keep chunks ≤ 900.
const INVITE_CHUNK_SIZE = 900;

let _invitePreviewState: {
  token: string;
  digest: string;
  expiresAt: string;
  /** SHA-256 hex digest of the full invite list, returned by the preview endpoint.
   *  Sent with every bulk chunk so the preview token validates against the full list. */
  inviteDigest: string;
} | null = null;
/** In-memory store for large CSV imports (> INVITE_BULK_THRESHOLD entries). */
let _adminInviteEntries: AdminInviteEntry[] = [];
/** In-memory store for large speaker CSV imports. */
let _proposalInviteEntries: AdminInviteEntry[] = [];
const _emailPreviewTokens = new Map<string, string | null>();

function syncInviteCount(): void {
  const lbl = q("#inv-count-lbl");
  if (!lbl) return;
  const count = _adminInviteEntries.length > 0
    ? _adminInviteEntries.length
    : document.querySelectorAll("#inv-rows .inv-row").length;
  lbl.textContent = count > 0 ? `${count.toLocaleString()} row${count !== 1 ? "s" : ""}` : "";
}

function collectAdminInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
  if (_adminInviteEntries.length > 0) return _adminInviteEntries;
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

function renderAdminBulkSummary(entries: AdminInviteEntry[]): void {
  const container = q("#inv-rows");
  if (!container) return;
  const preview = entries.slice(0, INVITE_BULK_THRESHOLD);
  const more = entries.length - preview.length;
  const rows = preview
    .map((e) => {
      return `<tr><td class="small">${esc(e.firstName || "—")}</td><td class="small">${esc(e.lastName || "—")}</td><td class="small mono">${esc(e.email)}</td></tr>`;
    })
    .join("");
  container.innerHTML =
    `<div class="d-flex align-items-center gap-2 rounded border px-3 py-2 mb-2 small bg-light">` +
    `<span><strong>${entries.length.toLocaleString()}</strong> invites loaded from CSV</span>` +
    `<button type="button" class="btn btn-sm btn-link p-0 text-danger ms-auto" id="inv-clear-bulk">× Clear</button>` +
    `</div>` +
    `<table class="table table-sm mb-1"><thead><tr><th class="small">First name</th><th class="small">Last name</th><th class="small">Email</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    (more > 0 ? `<div class="small text-muted ps-1">\u2026and ${more.toLocaleString()} more</div>` : "");
  container.querySelector("#inv-clear-bulk")?.addEventListener("click", () => {
    clearAdminBulkImport();
    invalidateInvitePreview();
  });
}

function clearAdminBulkImport(): void {
  _adminInviteEntries = [];
  const container = q("#inv-rows");
  if (container) container.innerHTML = "";
  addAdminInviteRow();
  syncInviteCount();
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
    const { valid: entries, skipped: _s } = parseAdminInviteText(pasted);
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
  if (entries.length > INVITE_BULK_THRESHOLD) {
    _adminInviteEntries = entries;
    renderAdminBulkSummary(entries);
    syncInviteCount();
    return;
  }
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
    const { valid, skipped } = parseAdminInviteText(text);
    if (!valid.length) { toast(skipped > 0 ? `No valid email addresses found (${skipped} invalid)` : "No valid email addresses found in the pasted text", "error"); return; }
    addParsedAdminEntries(valid);
    const ta = q<HTMLTextAreaElement>("#inv-paste");
    if (ta) ta.value = "";
    invalidateInvitePreview();
    const skipMsg = skipped > 0 ? ` (${skipped} skipped — invalid email)` : "";
    toast(`Parsed ${valid.length} entr${valid.length !== 1 ? "ies" : "y"}${skipMsg}`, skipped > 0 ? "info" : "success");
  });

  // Auto-parse on paste into the textarea
  q<HTMLTextAreaElement>("#inv-paste")?.addEventListener("paste", () => {
    setTimeout(() => {
      const ta = q<HTMLTextAreaElement>("#inv-paste");
      if (!ta?.value.trim()) return;
      const { valid, skipped } = parseAdminInviteText(ta.value);
      if (!valid.length) return;
      addParsedAdminEntries(valid);
      if (skipped > 0) toast(`${skipped} address${skipped !== 1 ? "es" : ""} skipped — invalid email`, "info");
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
      const { valid, skipped } = parseAdminCsv(text);
      if (!valid.length) { toast("No valid rows found in CSV", "error"); return; }
      addParsedAdminEntries(valid);
      invalidateInvitePreview();
      const skipMsg = skipped > 0 ? ` (${skipped} row${skipped !== 1 ? "s" : ""} skipped — invalid email)` : "";
      toast(`Imported ${valid.length} row${valid.length !== 1 ? "s" : ""} from CSV${skipMsg}`, skipped > 0 ? "info" : "success");
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
      inviteDigest: string;
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
      inviteDigest: result.inviteDigest,
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
  const statusEl = q("#inv-form-status");

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
    // Split large lists into chunks so each Worker request stays within the
    // 30-second wall-clock limit.  All chunks share the same previewToken
    // (issued for the full list) and include the full-list inviteDigest so
    // the backend can validate the token against the complete list rather
    // than just the current chunk.
    const chunks: typeof invites[] = [];
    for (let i = 0; i < invites.length; i += INVITE_CHUNK_SIZE) {
      chunks.push(invites.slice(i, i + INVITE_CHUNK_SIZE));
    }

    let totalCreated = 0;
    let totalEndorsed = 0;
    let totalSkipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1 && statusEl) {
        statusEl.textContent = `Sending batch ${i + 1} of ${chunks.length}…`;
        statusEl.className = "mt-2 small text-muted";
      }
      const payload: Record<string, unknown> = {
        invites: chunks[i],
        previewToken: _invitePreviewState.token,
      };
      if (chunks.length > 1) {
        payload.inviteDigest = _invitePreviewState.inviteDigest;
      }
      const r = await api<{ created?: unknown[]; endorsed?: unknown[]; skipped?: unknown[] }>(
        `/api/v1/admin/events/${slug}/invites/attendees/bulk`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      totalCreated  += r.created?.length  ?? 0;
      totalEndorsed += r.endorsed?.length ?? 0;
      totalSkipped  += r.skipped?.length  ?? 0;
    }

    const parts = [`✓ ${totalCreated} invitation${totalCreated !== 1 ? "s" : ""} queued`];
    if (totalEndorsed) parts.push(`${totalEndorsed} already invited`);
    if (totalSkipped)  parts.push(`${totalSkipped} skipped`);
    toast(parts.join(" · "), "success");

    _invitePreviewState = null;
    clearAdminBulkImport();
    invalidateInvitePreview();
    if (statusEl) { statusEl.textContent = parts.join(" · "); statusEl.className = "mt-2 small text-success"; }
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

// ── Invite list (pending + all) ──────────────────────────────────────────────────

async function loadEventInvites(slug: string, statusFilter?: string): Promise<void> {
  const body = q("#inv-list-body");
  const pager = q("#inv-list-pager");
  if (!body) return;
  body.innerHTML = spinner();
  if (pager) pager.innerHTML = "";

  // Wire filter controls once
  const filterSel = q<HTMLSelectElement>("#inv-filter");
  const searchInput = q<HTMLInputElement>("#inv-search");
  const refreshBtn = q<HTMLButtonElement>("#inv-list-refresh");

  const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");
  let offset = 0;
  let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    const filter = getFilter();
    const query = new URLSearchParams({ type: "attendee", limit: String(pageSize), offset: String(offset) });
    if (filter) query.set("status", filter);
    const searchVal = (searchInput?.value ?? "").trim();
    if (searchVal) query.set("q", searchVal);
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
    searchInput?.addEventListener("input", () => { offset = 0; void doLoad(); });
    filterSel?.addEventListener("change", () => { offset = 0; void doLoad(); });
    refreshBtn?.addEventListener("click", () => { offset = 0; void doLoad(); });
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
    toast("Event created", "success");
    q("#new-event-form")?.classList.add("d-none");
    await loadEvents();
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
    toast((err as Error).message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Create Event"; }
  }
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

function emailOutboxSummaryBadges(items: Record<string, number>): string {
  const order = ["failed", "retrying", "queued", "sending", "sent", "transactional", "promotional"];
  const ordered = Object.entries(items).sort(([left], [right]) => {
    const leftRank = order.indexOf(left) === -1 ? order.length : order.indexOf(left);
    const rightRank = order.indexOf(right) === -1 ? order.length : order.indexOf(right);
    return leftRank - rightRank || left.localeCompare(right);
  });
  if (!ordered.length) {
    return '<span class="text-muted small">No matching rows</span>';
  }
  return ordered
    .map(([key, value]) => `${badge(key)} <span class="small text-muted me-3">${value}</span>`)
    .join("");
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
              '<input type="number" class="form-control form-control-sm" id="retry-limit" value="20" min="1" max="500" style="width:90px"></div>' +
              '<div class="form-check mt-4"><input class="form-check-input" type="checkbox" id="email-outbox-select-visible"><label class="form-check-label small" for="email-outbox-select-visible">Select visible</label></div>' +
              '<button class="btn btn-sm btn-success" id="btn-do-retry">Process due queue</button>' +
              '<button class="btn btn-sm btn-primary" id="btn-do-retry-all">Process all due</button>' +
              '<span class="small text-muted align-self-center" id="retry-all-status"></span>' +
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
      q("#btn-do-retry-all")?.addEventListener("click", () => void doProcessAllDue());
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

async function doProcessAllDue(): Promise<void> {
  const BATCH = 500;
  const btn = q<HTMLButtonElement>("#btn-do-retry-all");
  const statusEl = q("#retry-all-status");
  if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
  let totalProcessed = 0;
  let totalFailed = 0;
  try {
    while (true) {
      if (statusEl) statusEl.textContent = `${totalProcessed} sent so far…`;
      const r = await api<{ processed?: number; failed?: number }>("/api/v1/internal/email/retry", {
        method: "POST",
        body: JSON.stringify({ limit: BATCH }),
      });
      const processed = r.processed ?? 0;
      totalProcessed += processed;
      totalFailed += r.failed ?? 0;
      if (processed < BATCH) break; // queue exhausted
    }
    toast(`Done: ${totalProcessed} sent, ${totalFailed} failed`, "success");
    if (statusEl) statusEl.textContent = "";
    await loadEmail();
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) statusEl.textContent = "";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Process all due"; }
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

// ── Chart tooltip ──────────────────────────────────────────────────────────────
let _admTipEl: HTMLDivElement | null = null;
function admTipEl(): HTMLDivElement {
  if (!_admTipEl) {
    _admTipEl = document.createElement("div");
    _admTipEl.className = "adm-tooltip";
    document.body.appendChild(_admTipEl);
  }
  return _admTipEl;
}
function initChartTooltips(): void {
  const escH = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  document.addEventListener("mousemove", (e: MouseEvent) => {
    const el = (e.target as Element).closest<Element>("[data-tip]");
    const tip = admTipEl();
    if (el) {
      tip.innerHTML = (el.getAttribute("data-tip") ?? "")
        .split("\n").map(escH).join("<br>");
      tip.classList.add("visible");
      const tw = tip.offsetWidth + 24;
      const th = tip.offsetHeight + 16;
      const x = Math.min(e.clientX + 14, window.innerWidth - tw);
      const y = Math.max(e.clientY - th, 8);
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    } else {
      tip.classList.remove("visible");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initChartTooltips();
  loadAuth();

  document.querySelectorAll<HTMLButtonElement>(".sidebar-link[data-sec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      nav(btn.dataset.sec!);
      closeSidebar();
    });
  });

  q("#btn-logout")?.addEventListener("click", () => { clearAuth(); location.reload(); });

  // Mobile sidebar toggle
  q("#sidebar-toggle")?.addEventListener("click", () => {
    const sidebar = q("#admin-sidebar");
    const backdrop = q("#sidebar-backdrop");
    const toggle = q("#sidebar-toggle");
    const isOpen = sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("active", isOpen);
    toggle?.setAttribute("aria-expanded", String(isOpen));
  });

  q("#sidebar-backdrop")?.addEventListener("click", () => closeSidebar());
  q("#btn-dashboard-refresh")?.addEventListener("click", () => void loadDashboard());
  q("#btn-events-refresh")?.addEventListener("click", () => void loadEvents());
  q("#btn-email-refresh")?.addEventListener("click", () => void loadEmail());
  q("#btn-stats-refresh")?.addEventListener("click", () => void loadStats());
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
