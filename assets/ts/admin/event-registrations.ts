import { type AuditLogEntry } from "./audit-log";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { type ApiFn, type AdminRegistrationDay, type BadgeRoleInfo, type Registration } from "./types";
import { badge, esc, fmt, resetButton, q, setButtonLoading, spinner, toast } from "./ui";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Factory ───────────────────────────────────────────────────────────────────

interface RegistrationsSectionDeps {
  inviteListHtml: (slug: string) => string;
  inviteFormHtml: (slug: string) => string;
  emailTabHtml: (context: string) => string;
  loadEventInvites: (slug: string) => Promise<void>;
  wireEmailTab: (slug: string, context: string, audience: "attendees" | "speakers") => Promise<void>;
}

export function createRegistrationsSection(api: ApiFn, deps: RegistrationsSectionDeps) {

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
          const prefix = day.rsvpLabel ? `<div class="text-muted small mb-1">${esc(day.rsvpLabel)}</div>` : "";
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

  async function doOpenManagePage(slug: string, regId: string): Promise<void> {
    const openBtn = document.querySelector<HTMLButtonElement>(`[data-open-manage="${regId}"]`);
    if (openBtn) setButtonLoading(openBtn);
    try {
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

    const roleValue = select?.value || null;

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
      const refreshed = await api<BadgeRoleInfo>(
        `/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`,
      );
      renderBadgeRolePanel(container, slug, regId, refreshed);
      void result;
    } catch (err) {
      toast((err as Error).message, "error");
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
      if (saveBtn) resetButton(saveBtn);
    }
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

  function wireRegsTable(slug: string, regs: Registration[]): void {
    const regMap = new Map(regs.map((r) => [r.id, r]));

    document.querySelectorAll<HTMLButtonElement>("[data-manage-reg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const regId = btn.dataset.manageReg!;
        const detailRow = document.getElementById(`reg-detail-${regId}`);
        if (!detailRow) return;

        const isOpen = !detailRow.classList.contains("d-none");
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

              document.querySelector<HTMLButtonElement>(`[data-open-manage="${regId}"]`)?.addEventListener("click", () =>
                void doOpenManagePage(slug, regId),
              );
              document.querySelector<HTMLButtonElement>(`[data-resend-reg="${regId}"]`)?.addEventListener("click", () =>
                void doResendConfirmation(slug, regId),
              );
              document.querySelector<HTMLButtonElement>(`[data-regen-badge="${regId}"]`)?.addEventListener("click", () =>
                void doRegenerateBadge(slug, regId),
              );
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
              document.querySelector<HTMLButtonElement>(`[data-copy-ref="${regId}"]`)?.addEventListener("click", () => {
                const inp = document.getElementById(`rd-reflink-${regId}`) as HTMLInputElement | null;
                if (inp) {
                  void navigator.clipboard.writeText(inp.value);
                  toast("Referral link copied!", "success");
                }
              });
              void doLoadBadgeRoleInfo(slug, regId);
              void doLoadAuditLog(slug, regId);
            } catch (err) {
              if (container) container.innerHTML = `<div class="alert alert-danger mb-0">${esc((err as Error).message)}</div>`;
            }
          })();
        }
      });
    });
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

  function registrationsGroupTabHtml(slug: string): string {
    return (
      '<ul class="nav nav-tabs mb-3">' +
        '<li class="nav-item"><button class="nav-link active" data-reg-tab="regs">Registrations</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-reg-tab="invlist">Invite List</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-reg-tab="invite">Send Invite</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-reg-tab="email">Send Email</button></li>' +
      '</ul>' +
      `<div id="et-regs">${registrationsListHtml(slug)}</div>` +
      `<div id="et-invlist" class="d-none">${deps.inviteListHtml(slug)}</div>` +
      `<div id="et-invite" class="d-none">${deps.inviteFormHtml(slug)}</div>` +
      `<div id="et-email" class="d-none">${deps.emailTabHtml("regs")}</div>`
    );
  }

  function wireRegistrationsGroupTabs(slug: string): void {
    const root = q("#et-registrations");
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>("[data-reg-tab]").forEach((btn) => {
      btn.onclick = () => {
        root.querySelectorAll<HTMLButtonElement>("[data-reg-tab]").forEach((b) => b.classList.remove("active"));
        ["regs", "invlist", "invite", "email"].forEach((id) => {
          const el = q(`#et-${id}`);
          if (el) el.classList.add("d-none");
        });
        btn.classList.add("active");
        const tab = btn.dataset.regTab!;
        const shown = q(`#et-${tab}`);
        if (shown) shown.classList.remove("d-none");
        if (tab === "regs") void loadEventRegistrations(slug);
        if (tab === "invlist") void deps.loadEventInvites(slug);
        if (tab === "email") void deps.wireEmailTab(slug, "regs", "attendees");
      };
    });
  }

  return { registrationsGroupTabHtml, wireRegistrationsGroupTabs, loadEventRegistrations };
}
