/**
 * Admin: get or set the badge role for a single registration.
 *
 * Badge role is derived directly from event_participants.role — no separate
 * override column needed. The effective role is the highest-priority active
 * non-attendee participant row (any source).
 *
 * GET  .../badge-role
 *   Returns the effective role, auto-detected role, and any admin-set role.
 *
 * PATCH .../badge-role
 *   Body: { role: "attendee"|"speaker"|"moderator"|"panelist"|"organizer"|"staff"|null }
 *   - null / "attendee" → remove any admin-added participant row (revert to auto)
 *   - other roles       → upsert an event_participants row with source_type='admin'
 *
 * Effective role resolution:
 *   1. Highest-priority active non-attendee participant row (any source)
 *      (speaker > moderator > panelist > organizer > staff)
 *   2. "attendee" — default
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { first, run, all } from "../../../../../../../_lib/db/queries";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { invalidateAndRerender } from "../../../../../../../_lib/services/og-badge-prerender";
import { nowIso } from "../../../../../../../_lib/utils/time";
import { uuid } from "../../../../../../../_lib/utils/ids";
import type { DatabaseLike, PagesContext } from "../../../../../../../_lib/types";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────

const VALID_ROLES = ["attendee", "speaker", "moderator", "panelist", "organizer", "staff"] as const;
type ParticipantRole = (typeof VALID_ROLES)[number];

const ROLE_PRIORITY: Record<string, number> = {
  speaker: 1, moderator: 2, panelist: 3, organizer: 4, staff: 5,
};

const patchSchema = z.object({
  role: z.enum(VALID_ROLES).nullable(),
});

interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
}

interface ParticipantRow {
  id: string;
  role: string;
  source_type: string | null;
  status: string;
  source_ref: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Highest-priority active non-attendee role across all participant rows, or 'attendee'. */
function resolveEffectiveRole(rows: ParticipantRow[]): ParticipantRole {
  const active = rows
    .filter((r) => r.role !== "attendee" && r.status === "active")
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));
  return (active[0]?.role ?? "attendee") as ParticipantRole;
}

async function fetchData(db: DatabaseLike, eventId: string, registrationId: string) {
  const registration = await first<RegistrationRow>(
    db,
    "SELECT id, event_id, user_id FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, eventId],
  );
  if (!registration) return null;

  const participantRows = await all<ParticipantRow>(
    db,
    `SELECT ep.id, ep.role, ep.source_type, ep.status, ep.source_ref
     FROM event_participants ep
     LEFT JOIN session_proposals sp
       ON ep.source_type = 'proposal'
      AND ep.source_ref = sp.id
     WHERE ep.event_id = ?
       AND ep.user_id = ?
       AND ep.role != 'attendee'
       AND ep.status = 'active'
       AND (ep.source_type != 'proposal' OR sp.status = 'accepted')`,
    [eventId, registration.user_id],
  );

  return { registration, participantRows };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function onRequestGet(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const data  = await fetchData(context.env.DB, event.id, context.params.registrationId);

  if (!data) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const { participantRows } = data;

  // admin_override: the role explicitly set by an admin (source_type = 'admin')
  const adminRow      = participantRows.find((r) => r.source_type === "admin" && r.role !== "attendee");
  const admin_override = adminRow?.role ?? null;

  // auto_detected: effective role ignoring any admin-sourced rows
  const nonAdminRows  = participantRows.filter((r) => r.source_type !== "admin");
  const auto_detected = resolveEffectiveRole(nonAdminRows);

  // effective_role: best role considering all rows
  const effective_role = resolveEffectiveRole(participantRows);

  return json({
    admin_override,
    auto_detected,
    effective_role,
    available_roles: VALID_ROLES,
  });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function onRequestPatch(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const body  = await parseJsonBody(context.request, patchSchema);
  const data  = await fetchData(context.env.DB, event.id, context.params.registrationId);

  if (!data) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const { registration, participantRows } = data;
  const db  = context.env.DB;
  const now = nowIso();

  // Remove any existing admin-sourced non-attendee participant row
  const existingAdminRow = participantRows.find(
    (r) => r.source_type === "admin" && r.role !== "attendee",
  );
  const previousRole = existingAdminRow?.role ?? null;

  if (existingAdminRow) {
    await run(db, "DELETE FROM event_participants WHERE id = ?", [existingAdminRow.id]);
  }

  // Insert new admin participant row unless reverting to auto (null or 'attendee')
  const newRole = body.role && body.role !== "attendee" ? body.role : null;
  if (newRole) {
    // INSERT OR IGNORE: if a row with this (event_id, user_id, role, subrole)
    // already exists from another source (e.g. CFP), we leave it untouched —
    // the effective badge role will be the same either way.
    await run(
      db,
      `INSERT OR IGNORE INTO event_participants
         (id, event_id, user_id, role, status, source_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'admin', ?, ?)`,
      [uuid(), event.id, registration.user_id, newRole, now, now],
    );
  }

  await writeAuditLog(
    db,
    "admin",
    admin.id,
    "admin_badge_role_set",
    "event_participant",
    registration.id,
    {
      eventId:        event.id,
      registrationId: registration.id,
      userId:         registration.user_id,
      previousRole,
      newRole,
    },
  );

  // Re-render cached badge PNGs with the new role
  const origin = new URL(context.request.url).origin;
  context.waitUntil(invalidateAndRerender(registration.user_id, context.env, origin));

  // Re-fetch to compute the fresh effective role
  const refreshed     = await fetchData(db, event.id, registration.id);
  const rows          = refreshed?.participantRows ?? participantRows;
  const adminRow      = rows.find((r) => r.source_type === "admin" && r.role !== "attendee");
  const nonAdminRows  = rows.filter((r) => r.source_type !== "admin");
  const effective_role = resolveEffectiveRole(rows);
  const auto_detected  = resolveEffectiveRole(nonAdminRows);

  return json({
    success:        true,
    admin_override: adminRow?.role ?? null,
    auto_detected,
    effective_role,
  });
}

// ── Catch-all ─────────────────────────────────────────────────────────────────

export async function onRequest(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  if (context.request.method === "GET")   return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
