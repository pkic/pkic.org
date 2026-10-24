import type { PublicStaffCapacity } from "../../../assets/shared/schemas/staff-capacity";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import { all } from "../db/queries";
import type { AuthMember, DatabaseLike } from "../types";
import type { SessionActingIdentity } from "../../../assets/shared/session-acting-identity";
import type { UserSessionResult } from "./user-session";
import { publicStaffCapacity } from "./admin-identity";

export async function publicUserSession(
  db: DatabaseLike,
  result: UserSessionResult,
): Promise<{
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  identity: { id: string; email: string };
  staff?: PublicStaffCapacity;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
  hasActiveIdentity: boolean;
  actingIdentities: SessionActingIdentity[];
  actingIdentityId: string | null;
}> {
  const staff = result.staff ? publicStaffCapacity(result.staff) : undefined;
  const groupIds = [
    ...new Set(
      (staff?.grants ?? [])
        .filter((grant) => grant.contextType === "group" && grant.contextId)
        .map((grant) => grant.contextId),
    ),
  ];
  // Resolve only the caller's granted groups, once for the whole response.
  if (staff && groupIds.length > 0) {
    const groups = await all<{ id: string; name: string }>(
      db,
      "SELECT g.id, g.name FROM groups g JOIN json_each(?) requested ON requested.value = g.id",
      [JSON.stringify(groupIds)],
    );
    const names = new Map(groups.map((group) => [group.id, group.name]));
    staff.grants = staff.grants.map((grant) =>
      grant.contextType === "group" ? { ...grant, contextName: names.get(grant.contextId ?? "") ?? null } : grant,
    );
  }
  return {
    sessionId: result.sessionId,
    expiresAt: result.expiresAt,
    idleExpiresAt: result.idleExpiresAt,
    identity: result.identity,
    ...(result.staff
      ? {
          staff: {
            ...staff!,
            idleExpiresAt: result.staffIdleExpiresAt!,
          },
        }
      : {}),
    ...(result.member ? { member: result.member } : {}),
    sponsors: result.sponsors,
    pendingIdentityCount: result.pendingIdentityCount,
    eventParticipation: result.eventParticipation ?? false,
    hasActiveIdentity: result.hasActiveIdentity,
    actingIdentities: result.actingIdentities,
    actingIdentityId: result.actingIdentityId,
  };
}
