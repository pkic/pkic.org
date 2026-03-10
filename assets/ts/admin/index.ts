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
  capacity_in_person: number | null;
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
  settings: Record<string, unknown>;
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
}

interface BadgeRoleInfo {
  admin_override: string | null;
  auto_detected: string;
  effective_role: string;
  available_roles: string[];
}

interface StatsResponse {
  registrations: { byStatus: Record<string, number>; total: number };
  invites: { byStatus: Record<string, number>; total: number };
  email: { outboxByStatus: Record<string, number>; totalQueued: number; totalFailed: number };
  topEvents: Array<{ slug: string; name: string; confirmed: number; total: number }>;
  recentActivity: Array<{ date: string; registrations: number; invites: number }>;
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
    waitlisted: "info", cancelled: "danger",
    // Invite statuses
    sent: "primary", accepted: "success", declined: "danger", expired: "secondary", revoked: "secondary",
    // Email outbox statuses
    queued: "primary", retrying: "warning", failed: "danger", sending: "primary",
    // Email template version statuses
    active: "success", draft: "warning",
    // Event/registration mode
    invite_only: "warning", invite_or_open: "primary", open: "success",
  };
  return `<span class="badge text-bg-${map[status] ?? "secondary"}">${esc(status || "—")}</span>`;
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
    templates: loadTemplates,
    stats: loadStats,
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
    const { registrations: r, email: em, invites: inv } = s;
    el.innerHTML =
      '<div class="stat-grid">' +
        sc("Total Registrations", r.total, `${r.byStatus.registered ?? 0} confirmed`) +
        sc("Pending Invites", inv.byStatus.sent ?? 0, `${inv.total} total`) +
        sc("Queued Emails", em.totalQueued, "") +
        sc("Failed Emails", em.totalFailed, "go to Email tab to fix", em.totalFailed > 0 ? "danger" : "") +
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
        ["Event", "Dates", "Mode", "Cap.", "Confirmed", "Total", "Pending", ""],
        _evList.map(
          (e) =>
            `<tr><td><strong style="font-size:.85rem">${esc(e.name)}</strong><br>` +
            `<span class="mono text-muted">${esc(e.slug)}</span></td>` +
            `<td class="mono" style="white-space:nowrap;font-size:.75rem">${e.starts_at ? esc(e.starts_at.substring(0, 10)) : "—"}</td>` +
            `<td>${badge(e.registration_mode)}</td>` +
            `<td class="mono">${e.capacity_in_person ?? "∞"}</td>` +
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
    // Load full event detail (includes timezone, dates, venue, etc.)
    const detailResp = await api<{ event: EventDetail }>(`/api/v1/admin/events/${slug}`);
    _currentEventDetail = detailResp.event;

    const d = await api<{ registrations: Registration[] }>(`/api/v1/admin/events/${slug}/registrations`);
    const regs = d.registrations ?? [];
    det.innerHTML =
      '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
        `<span class="fw-semibold">${esc(ev.name || slug)}</span>` +
        '<button class="btn btn-sm btn-secondary" id="btn-close-event">&larr; Back</button>' +
      '</div><div class="card-body">' +
        '<ul class="nav nav-tabs mb-3">' +
          `<li class="nav-item"><button class="nav-link active" data-tab="regs">Registrations (${regs.length})</button></li>` +
          '<li class="nav-item"><button class="nav-link" data-tab="invite">Send Invites</button></li>' +
          `<li class="nav-item"><button class="nav-link" data-tab="invlist">Invite List <span class="badge text-bg-secondary" style="font-size:.65rem">${ev.pending_invites ?? 0} pending</span></button></li>` +
          '<li class="nav-item"><button class="nav-link" data-tab="promoters">Promoters &#127881;</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-tab="details">Details</button></li>' +
          '<li class="nav-item"><button class="nav-link" data-tab="team">Team</button></li>' +
        '</ul>' +
        `<div id="et-regs">${regsTable(regs)}</div>` +
        `<div id="et-invite" class="d-none">${inviteFormHtml(slug)}</div>` +
        // wireRegsTable called below after innerHTML is set
        `<div id="et-invlist" class="d-none">${inviteListHtml(slug)}</div>` +
        `<div id="et-promoters" class="d-none">${promotersTabHtml()}</div>` +
        `<div id="et-details" class="d-none">${detailsFormHtml(_currentEventDetail)}</div>` +
        `<div id="et-team" class="d-none">${teamTabHtml()}</div>` +
      '</div></div>';

    q("#btn-close-event")?.addEventListener("click", closeEvent);

    det.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        det.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.classList.remove("active"));
        ["regs", "invite", "invlist", "promoters", "details", "team"].forEach((id) => hide(q(`#et-${id}`)));
        btn.classList.add("active");
        const tab = btn.dataset.tab!;
        show(q(`#et-${tab}`));
        if (tab === "invlist")   void loadEventInvites(slug);
        if (tab === "promoters") void loadEventPromoters(slug);
        if (tab === "team")      void loadEventPermissions(slug);
      });
    });

    wireInviteForm(slug);
    wireDetailsForm(slug);
    wireRegsTable(slug, regs);
  } catch (err) {
    det.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

function closeEvent(): void {
  hide(q("#e-detail"));
  show(q("#e-body"));
}

function regsTable(regs: Registration[]): string {
  const rows = regs.map((r) => {
    const name = r.display_name || r.user_email || r.user_id || "—";
    const sub =
      r.user_email && r.display_name && r.display_name !== r.user_email
        ? `<br><span class="mono text-muted">${esc(r.user_email)}</span>`
        : "";
    return (
      `<tr data-reg-id="${esc(r.id)}">` +
      `<td>${esc(name)}${sub}</td>` +
      `<td>${badge(r.status)}</td>` +
      `<td>${esc(r.attendance_type ?? "—")}</td>` +
      `<td class="text-muted small">${esc(r.source_type ?? "—")}</td>` +
      `<td class="mono">${fmt(r.created_at)}</td>` +
      `<td><button class="btn btn-sm btn-outline-secondary" data-manage-reg="${esc(r.id)}">Manage →</button></td>` +
      `</tr>` +
      `<tr id="reg-detail-${esc(r.id)}" class="d-none"><td colspan="6" class="p-0">` +
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
    ["Name / Email", "Status", "Attendance", "Source", "Registered", ""].map((h) => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function regDetailHtml(r: Registration, slug: string): string {
  const appBase = window.location.origin;
  const shareUrl = r.referral_code ? `${appBase}/r/${esc(r.referral_code)}` : null;
  const ogBadgeUrl = r.referral_code ? `${appBase}/api/v1/og/${esc(r.referral_code)}` : null;

  void slug; // used by wiring functions via data-reg-id

  return (
    `<div class="row g-3">` +

    // ── Open manage page ──────────────────────────────────────────────────
    `<div class="col-md-6">` +
    `<h6 class="small fw-semibold text-uppercase text-muted mb-2">Manage Registration</h6>` +
    `<p class="small text-muted mb-2">Opens the registrant-facing manage page in a new tab. Requires your admin session — the link cannot be forwarded to or used by an attendee.</p>` +
    `<button class="btn btn-sm btn-primary" data-open-manage="${esc(r.id)}">Open Manage Page &#8599;</button>` +
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
        const reg = regMap.get(regId);
        if (!reg) return;
        const container = detailRow.querySelector("div");
        if (container) container.innerHTML = regDetailHtml(reg, slug);
        detailRow.classList.remove("d-none");
        btn.textContent = "Close ↑";

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
      }
    });
  });
}

async function doOpenManagePage(slug: string, regId: string): Promise<void> {
  const openBtn = document.querySelector<HTMLButtonElement>(`[data-open-manage="${regId}"]`);
  if (openBtn) { openBtn.disabled = true; openBtn.textContent = "Opening…"; }
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
    if (openBtn) { openBtn.disabled = false; openBtn.textContent = "Open Manage Page ↗"; }
  }
}

async function doRegenerateBadge(slug: string, regId: string): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-regen-badge="${regId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Regenerating…"; }
  try {
    const res = await api<{ badgeUrl: string }>(`/api/v1/admin/events/${slug}/registrations/${regId}/regenerate-badge`, { method: "POST", body: "{}" });
    toast("Badge regenerated — opening…", "success");
    // Cache-bust the badge URL so the browser doesn't serve the old PNG (max-age=86400)
    window.open(`${res.badgeUrl}?v=${Date.now()}`, "_blank", "noopener");
  } catch (err) {
    toast((err as Error).message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "\u21BB Regenerate"; }
  }
}

async function doResendConfirmation(slug: string, regId: string): Promise<void> {
  const statusEl = document.getElementById(`rd-resend-status-${regId}`);
  const resendBtn = document.querySelector<HTMLButtonElement>(`[data-resend-reg="${regId}"]`);

  if (resendBtn) { resendBtn.disabled = true; resendBtn.textContent = "Sending…"; }
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    await api(`/api/v1/admin/events/${slug}/registrations/${regId}/resend-confirmation`, { method: "POST", body: "{}" });
    toast("Confirmation email queued", "success");
    if (statusEl) { statusEl.textContent = "✓ Email queued"; statusEl.className = "mt-2 small text-success"; }
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
  } finally {
    if (resendBtn) { resendBtn.disabled = false; resendBtn.textContent = "Resend Email"; }
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

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
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
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
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
      '<button type="button" class="btn btn-sm btn-success" id="inv-send-btn">Send Invites</button>' +
      '<span class="text-muted small" id="inv-count-lbl"></span>' +
    '</div>' +
    '<div id="inv-form-status" class="mt-2 small"></div>' +
    '</div>'
  );
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
    '<div id="inv-list-body">' + spinner() + '</div>'
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

function syncInviteCount(): void {
  const rows = document.querySelectorAll("#inv-rows .inv-row");
  const lbl = q("#inv-count-lbl");
  if (lbl) lbl.textContent = rows.length > 0 ? `${rows.length} row${rows.length !== 1 ? "s" : ""}` : "";
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
  // Start with one empty row
  addAdminInviteRow();

  // Parse button
  q("#inv-parse-btn")?.addEventListener("click", () => {
    const text = q<HTMLTextAreaElement>("#inv-paste")?.value ?? "";
    const entries = parseAdminInviteText(text);
    if (!entries.length) { toast("No valid email addresses found in the pasted text", "error"); return; }
    addParsedAdminEntries(entries);
    const ta = q<HTMLTextAreaElement>("#inv-paste");
    if (ta) ta.value = "";
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
      toast(`Imported ${entries.length} row${entries.length !== 1 ? "s" : ""} from CSV`, "success");
      (e.target as HTMLInputElement).value = "";
    };
    reader.readAsText(file);
  });

  // Add row button
  q("#inv-add-btn")?.addEventListener("click", () => addAdminInviteRow());

  // Send button
  q("#inv-send-btn")?.addEventListener("click", () => void doAdminInvite(slug));
}

async function doAdminInvite(slug: string): Promise<void> {
  const container = q("#inv-rows");
  const statusEl = q("#inv-form-status");
  if (!container) return;

  const invites = Array.from(container.querySelectorAll<HTMLElement>(".inv-row"))
    .map((row) => ({
      email: (row.querySelector<HTMLInputElement>("[data-inv-email]")?.value ?? "").trim(),
      firstName: (row.querySelector<HTMLInputElement>("[data-inv-first]")?.value ?? "").trim() || undefined,
      lastName:  (row.querySelector<HTMLInputElement>("[data-inv-last]")?.value  ?? "").trim() || undefined,
    }))
    .filter((i) => i.email);

  if (!invites.length) {
    if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
    return;
  }

  const sendBtn = q<HTMLButtonElement>("#inv-send-btn");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending…"; }
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

  try {
    const r = await api<{ created?: unknown[] }>(`/api/v1/admin/events/${slug}/invites/attendees/bulk`, {
      method: "POST",
      body: JSON.stringify({ invites }),
    });
    const count = r.created?.length ?? invites.length;
    toast(`Sent ${count} invite${count !== 1 ? "s" : ""}`, "success");
    if (container) {
      container.innerHTML = "";
      addAdminInviteRow();
      syncInviteCount();
    }
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

// ── Invite list (pending + all) ──────────────────────────────────────────────────

async function loadEventInvites(slug: string, statusFilter?: string): Promise<void> {
  const body = q("#inv-list-body");
  if (!body) return;
  body.innerHTML = spinner();

  // Wire filter controls once
  const filterSel = q<HTMLSelectElement>("#inv-filter");
  const refreshBtn = q<HTMLButtonElement>("#inv-list-refresh");

  const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    const filter = getFilter();
    const url = `/api/v1/admin/events/${slug}/invites${filter ? `?status=${filter}` : ""}`;
    try {
      const d = await api<{ invites: InviteRecord[] }>(url);
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
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  };

  // Only wire once (check data attribute)
  const bodyEl = body as HTMLElement;
  if (!bodyEl.dataset.invListWired) {
    bodyEl.dataset.invListWired = "1";
    filterSel?.addEventListener("change", () => void doLoad());
    refreshBtn?.addEventListener("click", () => void doLoad());
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
      '<div class="col-md-3"><label class="form-label small fw-semibold">Capacity</label>' +
      '<input class="form-control form-control-sm" id="ne-cap" type="number" placeholder="Unlimited"></div>' +
      '<div class="col-md-3"><label class="form-label small fw-semibold">Invite Limit</label>' +
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
  const capEl    = q<HTMLInputElement>("#ne-cap");
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
  if (capEl?.value)    body.capacityInPerson = parseInt(capEl.value) || null;
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

    // Registration settings
    '<h6 class="text-uppercase small fw-bold text-muted mb-2 mt-3">Registration Settings</h6>' +
    '<div class="mb-3"><label class="form-label fw-semibold">Registration Mode</label>' +
    '<select class="form-select" id="det-mode">' +
      modeOpt("open", "Open") +
      modeOpt("invite_or_open", "Invite or Open") +
      modeOpt("invite_only", "Invite Only") +
    "</select></div>" +
    '<div class="row g-2 mb-3">' +
      '<div class="col"><label class="form-label small fw-semibold">In-Person Capacity</label>' +
      `<input class="form-control form-control-sm" type="number" id="det-cap" value="${esc(det.capacity_in_person ?? "")}" placeholder="Unlimited"></div>` +
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

async function doSaveDetails(evt: Event, slug: string): Promise<void> {
  evt.preventDefault();
  const startsRaw = q<HTMLInputElement>("#det-starts")?.value;
  const endsRaw   = q<HTMLInputElement>("#det-ends")?.value;
  const capStr    = q<HTMLInputElement>("#det-cap")?.value ?? "";
  const retStr    = q<HTMLInputElement>("#det-retention")?.value ?? "";

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
    capacityInPerson: capStr ? (parseInt(capStr) || null) : null,
    inviteLimitAttendee: parseInt(q<HTMLInputElement>("#det-invlim")?.value ?? "") || undefined,
  };

  const venue = q<HTMLInputElement>("#det-venue")?.value.trim();
  const vurl  = q<HTMLInputElement>("#det-vurl")?.value.trim();
  body.venue      = venue || null;
  body.virtualUrl = vurl  || null;
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
  hide(listEl);
  show(editorEl);

  // Prefer active version for pre-fill; fall back to latest draft
  const active = versions.find((v) => v.status === "active");
  const current = active ?? versions[0];

  editorEl.innerHTML =
    '<div class="card border-0 shadow-sm">' +
      '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
        `<span class="fw-semibold">Edit: <span class="mono">${esc(key)}</span></span>` +
        '<button class="btn btn-sm btn-secondary" id="btn-close-template">&larr; Back to list</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="mb-3">' +
          '<label class="form-label small fw-semibold mb-1" for="t-subject">' +
            'Subject template <span class="text-muted fw-normal">(optional — supports {{variables}})</span>' +
          '</label>' +
          `<input type="text" class="form-control form-control-sm font-monospace" id="t-subject" ` +
            `value="${esc(current?.subject_template ?? "")}" placeholder="e.g. Your invitation to {{eventName}}">` +
        '</div>' +
        '<div class="mb-3">' +
          '<label class="form-label small fw-semibold mb-1" for="t-content">' +
            'Body <span class="text-muted fw-normal">(Markdown — {{variable}}, {{#if cond}}…{{/if}}, {{#each list}}…{{/each}})</span>' +
          '</label>' +
          `<textarea class="form-control font-monospace" id="t-content" rows="20" style="font-size:.8rem;resize:vertical">${esc(current?.body ?? "")}</textarea>` +
        '</div>' +
        '<div class="d-flex gap-2 align-items-center">' +
          '<button class="btn btn-success" id="btn-t-save">Save as Draft</button>' +
          '<span class="text-muted small">Saving creates a new draft version. Activate it below to put it in use.</span>' +
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

async function doSaveTemplateVersion(key: string): Promise<void> {
  const subject = q<HTMLInputElement>("#t-subject")?.value.trim() ?? "";
  const content = q<HTMLTextAreaElement>("#t-content")?.value ?? "";
  const btn = q<HTMLButtonElement>("#btn-t-save");
  if (!content.trim()) { toast("Body cannot be empty", "error"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const r = await api<{ success: boolean; version: number }>(
      `/api/v1/admin/email-templates/${encodeURIComponent(key)}/versions`,
      { method: "POST", body: JSON.stringify({ content, subjectTemplate: subject || undefined }) },
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

async function loadEmail(): Promise<void> {
  const el = q("#m-body");
  if (!el) return;
  el.innerHTML = spinner();
  try {
    const s = await api<StatsResponse>("/api/v1/admin/stats");
    const ob = s.email.outboxByStatus;
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
      '<div class="row g-3">' +
        '<div class="col-md-6"><div class="action-card">' +
          "<strong>Retry Queued / Retrying</strong>" +
          "<p>Process emails in queue or retry state. Use after fixing a configuration issue.</p>" +
          '<div class="d-flex gap-2 align-items-end">' +
            '<div><label class="form-label small fw-semibold mb-1">Batch limit</label>' +
            '<input type="number" class="form-control form-control-sm" id="retry-limit" value="20" min="1" max="100" style="width:90px"></div>' +
            '<button class="btn btn-sm btn-success" id="btn-do-retry">Run Retry</button>' +
          "</div></div></div>" +
        '<div class="col-md-6"><div class="action-card">' +
          "<strong>Reset Failed Emails</strong>" +
          "<p>Reset all <code>failed</code> records back to <code>retrying</code> so they are re-sent on the next cycle.</p>" +
          '<button class="btn btn-sm btn-danger" id="btn-do-reset-failed">Reset All Failed</button>' +
        "</div></div>" +
      "</div>";
    q("#btn-do-retry")?.addEventListener("click", doRetry);
    q("#btn-do-reset-failed")?.addEventListener("click", doResetFailed);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function doRetry(): Promise<void> {
  const lim = parseInt(q<HTMLInputElement>("#retry-limit")?.value ?? "20") || 20;
  try {
    const r = await api<{ processed?: number; failed?: number }>("/api/v1/internal/email/retry", {
      method: "POST",
      body: JSON.stringify({ limit: lim }),
    });
    toast(`Processed ${r.processed ?? 0}, failed ${r.failed ?? 0}`, "success");
    await loadEmail();
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

async function doResetFailed(): Promise<void> {
  try {
    const r = await api<{ reset?: number; processed?: number }>("/api/v1/internal/email/reset-failed", {
      method: "POST",
      body: "{}",
    });
    toast(`Reset ${r.reset ?? 0} failed, sent ${r.processed ?? 0}`, "success");
    await loadEmail();
  } catch (err) {
    toast((err as Error).message, "error");
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

async function loadStats(): Promise<void> {
  const el = q("#r-body");
  if (!el) return;
  el.innerHTML = spinner();
  try {
    const s = await api<StatsResponse>("/api/v1/admin/stats");
    el.innerHTML =
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
      "</div></div>" +
      '<details class="card border-0 shadow-sm mt-3">' +
        '<summary class="card-body text-muted small" style="cursor:pointer">JSON export (for automated reporting)</summary>' +
        `<div class="card-body pt-0"><pre class="json-out">${esc(JSON.stringify(s, null, 2))}</pre></div>` +
      "</details>";
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
