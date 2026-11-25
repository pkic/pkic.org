import { guardPermissionMutationDatabase, hasPermission, requirePermission } from "../../auth/permissions";
import { requireUserBackedAdminFromRequest } from "../../auth/admin";
import { requestDb, type AdminContext } from "../../db/context";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { getSponsorship, type SponsorshipReadModelRow } from "./read-model";

/**
 * How an actor reaches a sponsorship. Staff hold the global sponsorship
 * permission. An event's organizers (`events:write` on that event) reach only
 * that event's one-time `event` sponsorships; payment settlements, consortium
 * sponsorships and every other event stay with staff.
 */
export type SponsorshipAccessBasis = { basis: "staff" } | { basis: "event"; eventId: string };

const STAFF_ACCESS: SponsorshipAccessBasis = { basis: "staff" };

type SponsorshipAccessKind = "read" | "write";

interface SponsorshipTarget {
  sponsorType: string;
  eventId: string | null;
}

function staffPermission(kind: SponsorshipAccessKind) {
  return kind === "write" ? "sponsorships:write" : "sponsorships:read";
}

function eventContext(eventId: string) {
  return { type: "event", id: eventId } as const;
}

/** Resolves the signed-in, user-backed actor without requiring any permission yet. */
export async function requireSponsorshipActor(c: AdminContext) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  return { db, actor };
}

/**
 * Decides how the actor may reach a sponsorship of this type and event.
 * Refuses with the staff permission error when neither basis applies.
 */
export function resolveSponsorshipAccess(
  actor: UserBackedAuthAdmin,
  kind: SponsorshipAccessKind,
  target: SponsorshipTarget | null,
): SponsorshipAccessBasis {
  const permission = staffPermission(kind);
  if (hasPermission(actor, permission)) return STAFF_ACCESS;
  if (
    target?.sponsorType === "event" &&
    target.eventId &&
    hasPermission(actor, "events:write", eventContext(target.eventId))
  ) {
    return { basis: "event", eventId: target.eventId };
  }
  requirePermission(actor, permission);
  throw new AppError(403, "PERMISSION_REQUIRED", `Missing required permission: ${permission}`);
}

/**
 * Loads a sponsorship and authorizes the actor against its stored type and
 * event. A missing record answers like a refusal to an actor without the
 * staff permission, so the id space cannot be probed.
 */
export async function loadAuthorizedSponsorship(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  id: string,
  kind: SponsorshipAccessKind,
): Promise<{ sponsorship: SponsorshipReadModelRow; access: SponsorshipAccessBasis }> {
  const sponsorship = await getSponsorship(db, id);
  if (!sponsorship) {
    resolveSponsorshipAccess(actor, kind, null);
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }
  const access = resolveSponsorshipAccess(actor, kind, {
    sponsorType: sponsorship.sponsor_type,
    eventId: sponsorship.event_id,
  });
  return { sponsorship, access };
}

/** Event organizers do not assign sponsorships to staff; that stays a staff field. */
export function requireStaffToAssignSponsorship(access: SponsorshipAccessBasis, assignedToUserId: unknown): void {
  if (access.basis === "event" && assignedToUserId !== undefined && assignedToUserId !== null) {
    throw new AppError(
      403,
      "SPONSORSHIP_ASSIGNMENT_STAFF_ONLY",
      "Only sponsorship staff can assign a sponsorship to a staff member",
    );
  }
}

/**
 * Rechecks the actor's grant in every D1 mutation batch: the global
 * sponsorship write grant for staff, or `events:write` on the event for an
 * organizer. A revocation after HTTP authentication but before commit
 * therefore cannot leave a partial sponsorship, audit, or outbox transition
 * behind.
 */
export function authorizedSponsorshipMutationDb(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  access: SponsorshipAccessBasis = STAFF_ACCESS,
): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [
      access.basis === "event"
        ? { permission: "events:write", context: eventContext(access.eventId) }
        : { permission: "sponsorships:write" },
    ],
    () =>
      new AppError(
        409,
        "SPONSORSHIP_AUTHORIZATION_CHANGED",
        "Sponsorship permission changed while the update was being saved",
      ),
  );
}
