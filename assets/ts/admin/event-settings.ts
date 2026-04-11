import { AdminAttendanceOption, AdminEventDay, ApiFn, EventDetail } from "./types";
import { esc, q, toast } from "./ui";

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

export function newEventFormHtml(): string {
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

export function detailsFormHtml(det: Partial<EventDetail>): string {
  const toLocalDt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    try { return new Date(iso).toISOString().slice(0, 16); } catch { return ""; }
  };
  const modeOpt = (val: string, label: string): string =>
    `<option value="${val}"${det.registration_mode === val ? " selected" : ""}>${label}</option>`;
  return (
    `<form id="form-details" data-slug="${esc(det.slug ?? "")}">` +
    `<h6 class="text-uppercase small fw-bold text-muted mb-2">Event Details</h6>` +
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

export function eventSettingsTabHtml(detailsHtml: string, daysHtml: string, termsHtml: string, formsHtml: string, teamHtml: string): string {
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
        `<div id="ets-general">${detailsHtml}</div>` +
        `<div id="ets-days" class="d-none">${daysHtml}</div>` +
        `<div id="ets-terms" class="d-none">${termsHtml}</div>` +
        `<div id="ets-forms" class="d-none">${formsHtml}</div>` +
        `<div id="ets-team" class="d-none">${teamHtml}</div>` +
      '</div>' +
    '</div>'
  );
}

export async function doSaveDetails(api: ApiFn, slug: string, loadEvents: () => Promise<void>, updateCurrentDetail: (d: EventDetail) => void): Promise<void> {
  const startsRaw = q<HTMLInputElement>("#det-starts")?.value;
  const endsRaw   = q<HTMLInputElement>("#det-ends")?.value;
  const retStr    = q<HTMLInputElement>("#det-retention")?.value ?? "";
  const sessionTypesRaw = q<HTMLInputElement>("#det-session-types")?.value ?? "";

  const toIso = (v: string | undefined): string | null | undefined => {
    if (v === undefined) return undefined;
    if (!v.trim()) return null;
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
    updateCurrentDetail(res.event);
    toast("Details saved", "success");
    if (statusEl) { statusEl.textContent = "✓ Saved"; statusEl.className = "small text-success ms-3"; }
    await loadEvents();
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger ms-3"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }
  }
}

export function eventDaysTabHtml(): string {
  return (
    '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
      '<span class="small text-muted">Manage per-day attendance options and local event times</span>' +
      '<button class="btn btn-sm btn-outline-secondary ms-auto" id="btn-days-refresh">&circlearrowright; Refresh</button>' +
      '<button class="btn btn-sm btn-success" id="btn-days-add">+ Add day</button>' +
      '<button class="btn btn-sm btn-primary" id="btn-days-save">Save Days</button>' +
    '</div>' +
    '<div id="days-status" class="small mb-2"></div>' +
    '<div id="days-body"></div>'
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

function dayEditorCard(day?: AdminEventDay, timezone = "UTC"): string {
  const opts = day?.attendanceOptions ?? [];
  const counts = day?.attendanceCounts ?? {};
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

export async function loadEventDays(api: ApiFn, slug: string, timezone: string, spinnerHtml: string): Promise<void> {
  const body = q("#days-body");
  if (!body) return;
  body.innerHTML = spinnerHtml;
  try {
    const d = await api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`);
    const days = d.days ?? [];
    body.innerHTML = days.length ? days.map((day) => dayEditorCard(day, timezone)).join("") : '<p class="text-muted fst-italic small">No days configured yet.</p>';

    q("#btn-days-refresh")?.addEventListener("click", () => void loadEventDays(api, slug, timezone, spinnerHtml));
    q("#btn-days-add")?.addEventListener("click", () => {
      body.insertAdjacentHTML("beforeend", dayEditorCard(undefined, timezone));
      wireDayCards(body);
    });
    q("#btn-days-save")?.addEventListener("click", () => void saveEventDays(api, slug, timezone, spinnerHtml));
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

async function saveEventDays(api: ApiFn, slug: string, timezone: string, spinnerHtml: string): Promise<void> {
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
    await loadEventDays(api, slug, timezone, spinnerHtml);
  } catch (err) {
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger mb-2"; }
    toast((err as Error).message, "error");
  }
}
