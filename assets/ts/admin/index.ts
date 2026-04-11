/**
 * Admin console SPA — compiled by Hugo's esbuild pipeline (assets/ts/admin.ts).
 * Loaded via {{ partial "script.html" }} to satisfy CSP script-src 'self'.
 * All event handlers are wired via addEventListener — no inline onclick attributes.
 */

import { loadAuditLog, type AuditLogEntry } from "./audit-log";
import { eventStatsTabHtml, loadEventStats } from "./event-stats";
import { createDonationsSection } from "./donations";
import { createReportsSection, type StatsResponse } from "./reports";
import { createUsersSection } from "./users";
import { badge, esc, fmt, hide, q, show, spinner, tbl, toast } from "./ui";
import { createEmailTemplatesSection, type EmailTemplateVersion } from "./email-templates";
import { newEventFormHtml, detailsFormHtml, loadEventDays, doSaveDetails, eventDaysTabHtml } from "./event-settings";
import { eventTermsTabHtml, loadEventTerms, eventFormsTabHtml, loadEventForms } from "./event-config";
import { teamTabHtml, loadEventPermissions } from "./event-team";
import type { AdminEventDay, AdminRegistrationDay, BadgeRoleInfo, EventDetail, EventSummary, EventPermission, AdminEventFormSummary, AdminFormDetailField, AdminFormSubmission, Registration, AdminInviteEntry } from "./types";
import { createRegistrationsSection } from "./event-registrations";
import { createProposalsSection } from "./event-proposals";
import { createEmailSection } from "./event-email";
import { createInvitesSection } from "./event-invites";
import { createPromotersSection } from "./event-promoters";
import { createEmailOutboxSection } from "./email-outbox";
import { createJobsSection } from "./jobs";
import { createProposalsInviteSection } from "./proposals-invites";

// ── Type declarations ──────────────────────────────────────────────────────────

interface ApiOpts extends RequestInit {
  headers?: Record<string, string>;
}

// ── State ──────────────────────────────────────────────────────────────────────

let _token: string | null = null;
let _email: string | null = null;
let _evList: EventSummary[] = [];
let _currentEventDetail: EventDetail | null = null;

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
const { emailTabHtml, wireEmailTab } = createEmailSection(api);
const { inviteFormHtml, inviteListHtml, inviteBadge, parseAdminInviteText, parseAdminCsv, wireInviteForm, loadEventInvites } = createInvitesSection(api);
const { promotersTabHtml, loadEventPromoters } = createPromotersSection(api);
const { loadEmail } = createEmailOutboxSection(api);
const { loadDueWork } = createJobsSection(api, { loadEmail });
const { registrationsGroupTabHtml, wireRegistrationsGroupTabs, loadEventRegistrations } = createRegistrationsSection(api, {
  inviteListHtml,
  inviteFormHtml,
  emailTabHtml,
  loadEventInvites,
  wireEmailTab,
});

const { proposalInviteFormHtml, proposalInviteListHtml, wireProposalInviteForm, loadProposalInvites } = createProposalsInviteSection(api, { inviteBadge, parseAdminInviteText, parseAdminCsv });
const { proposalsGroupTabHtml, wireProposalsGroupTabs, loadEventProposals } = createProposalsSection(api, {
  emailTabHtml,
  wireEmailTab,
  getEmail: () => _email,
  proposalInviteFormHtml,
  proposalInviteListHtml,
  wireProposalInviteForm,
  loadProposalInvites,
});

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
        if (tab === "general") wireDetailsForm(slug);
        if (tab === "days") void loadEventDays(api, slug, _currentEventDetail?.timezone ?? "UTC", spinner());
        if (tab === "terms") void loadEventTerms(api, slug);
        if (tab === "forms") void loadEventForms(api, slug);
        if (tab === "team") void loadEventPermissions(api, slug, spinner());
      };
    });
  }

  function wireDetailsForm(slug: string): void {
    q<HTMLFormElement>("#form-details")?.addEventListener("submit", (evt) => {
      evt.preventDefault();
      void doSaveDetails(api, slug, loadEvents, (updated) => {
        _currentEventDetail = updated;
      });
    });
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
