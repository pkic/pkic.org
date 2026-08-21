import {
  ADMIN_BADGE_ROLES,
  adminBadgeRoleResponseSchema,
  type AdminBadgeRole,
  type AdminBadgeRolePatch,
} from "../../../../assets/shared/schemas/participant-roles";
import { requirePermission } from "../../auth/permissions";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { getEventBySlug } from "../events";

const ROLE_PRIORITY: Record<string, number> = {
  speaker: 1,
  moderator: 2,
  panelist: 3,
  organizer: 4,
  staff: 5,
};

interface RegistrationRow {
  id: string;
  user_id: string;
  override_role: string | null;
}

interface ParticipantRow {
  role: string;
}

function toAdminBadgeRole(value: string | null | undefined): AdminBadgeRole | null {
  return ADMIN_BADGE_ROLES.find((role) => role === value) ?? null;
}

function resolveAutoRole(rows: ParticipantRow[]): AdminBadgeRole {
  const selected = [...rows].sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99))[0]?.role;
  return toAdminBadgeRole(selected) ?? "attendee";
}

async function loadBadgeRole(db: DatabaseLike, eventId: string, registrationId: string) {
  const [registrationResult, participantResult] = await db.batch([
    db
      .prepare(
        `SELECT r.id, r.user_id, bro.role AS override_role
           FROM registrations r
           LEFT JOIN registration_badge_role_overrides bro ON bro.registration_id = r.id
          WHERE r.id = ? AND r.event_id = ?`,
      )
      .bind(registrationId, eventId),
    db
      .prepare(
        `SELECT ep.role
           FROM registrations r
           JOIN event_participants ep ON ep.event_id = r.event_id AND ep.user_id = r.user_id
           LEFT JOIN session_proposals sp
             ON ep.source_type = 'proposal' AND ep.source_ref = sp.id
          WHERE r.id = ? AND r.event_id = ?
            AND ep.role != 'attendee' AND ep.status = 'active'
            AND (ep.source_type != 'proposal' OR sp.status = 'accepted')`,
      )
      .bind(registrationId, eventId),
  ]);
  const registration = batchFirst<RegistrationRow>(registrationResult);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  const autoDetected = resolveAutoRole(batchRows<ParticipantRow>(participantResult));
  const adminOverride = toAdminBadgeRole(registration.override_role);
  return {
    registration,
    response: adminBadgeRoleResponseSchema.parse({
      admin_override: adminOverride,
      auto_detected: autoDetected,
      effective_role: adminOverride ?? autoDetected,
      available_roles: ADMIN_BADGE_ROLES,
    }),
  };
}

export async function getAdminRegistrationBadgeRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventSlug: string,
  registrationId: string,
) {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  return (await loadBadgeRole(db, event.id, registrationId)).response;
}

export async function setAdminRegistrationBadgeRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: { eventSlug: string; registrationId: string; patch: AdminBadgeRolePatch },
) {
  const event = await getEventBySlug(db, input.eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const current = await loadBadgeRole(db, event.id, input.registrationId);
  const newRole = input.patch.role && input.patch.role !== "attendee" ? input.patch.role : null;
  const at = nowIso();
  const mutation = newRole
    ? db
        .prepare(
          `INSERT INTO registration_badge_role_overrides
             (registration_id, role, set_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(registration_id) DO UPDATE SET
             role = excluded.role, set_by_user_id = excluded.set_by_user_id, updated_at = excluded.updated_at`,
        )
        .bind(current.registration.id, newRole, actor.id, at, at)
    : db
        .prepare("DELETE FROM registration_badge_role_overrides WHERE registration_id = ?")
        .bind(current.registration.id);
  await db.batch([
    mutation,
    prepareAuditLog(db, "admin", actor.id, "admin_badge_role_set", "registration", current.registration.id, {
      eventId: event.id,
      userId: current.registration.user_id,
      previousRole: current.response.admin_override,
      newRole,
    }),
  ]);
  const updated = (await loadBadgeRole(db, event.id, input.registrationId)).response;
  return {
    response: adminBadgeRoleResponseSchema.parse({ ...updated, success: true }),
    userId: current.registration.user_id,
  };
}
