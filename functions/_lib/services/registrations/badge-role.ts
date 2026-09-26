import {
  REGISTRATION_BADGE_ROLES,
  registrationBadgeResponseSchema,
  type RegistrationBadgeRole,
  type RegistrationBadgePatch,
} from "../../../../assets/shared/schemas/participant-roles";
import { requirePermission } from "../../auth/permissions";
import { requireAdminDatabaseUserId } from "../../auth/admin-identity";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { getEventBySlug } from "../events";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";

interface RegistrationRow {
  id: string;
  user_id: string;
  override_role: string | null;
}

interface ParticipantRow {
  role: string;
}

function toRegistrationBadgeRole(value: string | null | undefined): RegistrationBadgeRole | null {
  return REGISTRATION_BADGE_ROLES.find((role) => role === value) ?? null;
}

function resolveAutoRole(rows: ParticipantRow[]): RegistrationBadgeRole {
  return toRegistrationBadgeRole(rows[0]?.role) ?? "attendee";
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
           JOIN event_participant_badge_roles ep ON ep.event_id = r.event_id AND ep.user_id = r.user_id
          WHERE r.id = ? AND r.event_id = ?
          ORDER BY ep.priority ASC, ep.role ASC`,
      )
      .bind(registrationId, eventId),
  ]);
  const registration = batchFirst<RegistrationRow>(registrationResult);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  const autoDetected = resolveAutoRole(batchRows<ParticipantRow>(participantResult));
  const registrationOverride = toRegistrationBadgeRole(registration.override_role);
  return {
    registration,
    response: registrationBadgeResponseSchema.parse({
      admin_override: registrationOverride,
      auto_detected: autoDetected,
      effective_role: registrationOverride ?? autoDetected,
      available_roles: REGISTRATION_BADGE_ROLES,
    }),
  };
}

export async function getRegistrationBadge(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventSlug: string,
  registrationId: string,
) {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  return (await loadBadgeRole(db, event.id, registrationId)).response;
}

export async function setRegistrationBadge(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: { eventSlug: string; registrationId: string; patch: RegistrationBadgePatch },
) {
  const event = await getEventBySlug(db, input.eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const current = await loadBadgeRole(db, event.id, input.registrationId);
  const newRole = input.patch.role && input.patch.role !== "attendee" ? input.patch.role : null;
  const setterUserId = newRole ? requireAdminDatabaseUserId(actor) : null;
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
        .bind(current.registration.id, newRole, setterUserId, at, at)
    : db
        .prepare("DELETE FROM registration_badge_role_overrides WHERE registration_id = ?")
        .bind(current.registration.id);
  await db.batch([
    mutation,
    prepareBadgeRenderJobsForUser(db, current.registration.user_id, at),
    prepareAuditLog(db, "admin", actor.id, "admin_badge_role_set", "registration", current.registration.id, {
      eventId: event.id,
      userId: current.registration.user_id,
      previousRole: current.response.admin_override,
      newRole,
    }),
  ]);
  const updated = (await loadBadgeRole(db, event.id, input.registrationId)).response;
  return {
    response: registrationBadgeResponseSchema.parse({ ...updated, success: true }),
    userId: current.registration.user_id,
  };
}
