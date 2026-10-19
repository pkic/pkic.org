import { agendaStaffingShiftAppliesToOccurrence } from "./event-agenda-staffing-scope";
import type { AgendaOccurrence, AgendaSnapshot } from "./schemas/event-agenda";

/**
 * The people a live room offers as lower thirds. The approved session's
 * speakers come first; the moderator and the hosts the agenda shows on duty
 * for the session follow with their role, and operators may add people for
 * the room's session only. One policy for the room, the control room and the
 * overlay.
 */

/** The role line on a moderator's lower third. */
export const LIVE_MODERATOR_ROLE_LABEL = "Moderator";

/** At most this many people operators add to one session's lower thirds. */
export const LIVE_ADDED_CREDITS_MAX = 12;

const ADDED_KEY_PREFIX = "added:";
const HOST_KEY_PREFIX = "host:";

/** The lower-third key of a person operators added for this session. */
export function addedLiveCreditKey(id: string): string {
  return `${ADDED_KEY_PREFIX}${id}`;
}

/**
 * The lower-third key of one identity of someone from the event's people, the
 * same every time they are added, so the room can tell the same person in the
 * same capacity is already there. A typed name gets a fresh key instead.
 */
export function addedLivePersonKey(userId: string, identityId: string | null): string {
  return addedLiveCreditKey(`${userId}:${identityId ?? "self"}`);
}

/** Whether a person, in this identity, is already among the session's lower thirds. */
export function liveCreditAlreadyListed(
  keys: ReadonlySet<string>,
  person: { userId: string; identityId: string | null },
): boolean {
  return keys.has(addedLivePersonKey(person.userId, person.identityId)) || keys.has(`user:${person.userId}`);
}

export function isAddedLiveCreditKey(key: string): boolean {
  return key.startsWith(ADDED_KEY_PREFIX);
}

/**
 * The capacity a credit appears in, on one line: the identity's job title and
 * organization, "Chief Cryptographer, Northwind Trust". Empty for someone who
 * appears as themselves.
 */
export function liveCreditAffiliation(credit: {
  identity: { title: string | null; organization: string | null } | null;
}): string {
  return [credit.identity?.title, credit.identity?.organization].filter(Boolean).join(", ");
}

/** A credit that names its role, a host's or the moderator's: shown compact, under the speakers. */
export function liveCreditHasRole(credit: { roleLabel: string | null }): boolean {
  return credit.roleLabel !== null;
}

type DisplayRoleShift = NonNullable<AgendaSnapshot["displayRoles"]>[number];

/** A stable key for a host: the same duty and name give the same key on every admission. */
function hostKey(role: string, name: string): string {
  const slug = `${role} ${name}`
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return `${HOST_KEY_PREFIX}${slug}`.slice(0, 80);
}

/**
 * The hosts of one session: every duty the published agenda shows for a
 * shift that covers the session's time, room and track. Someone already
 * credited on the session keeps their speaker credit instead.
 */
export function liveSessionHosts(
  shifts: readonly DisplayRoleShift[],
  occurrence: Pick<AgendaOccurrence, "startAt" | "endAt" | "roomId" | "additionalRoomIds" | "track">,
  creditedNames: readonly string[],
): Array<{ key: string; name: string; roleLabel: string }> {
  const credited = new Set(creditedNames.map((name) => name.trim().toLowerCase()));
  const hosts = new Map<string, { key: string; name: string; roleLabel: string }>();
  for (const shift of shifts) {
    const scope = { startAt: shift.startAt, endAt: shift.endAt, roomId: shift.locationId, track: shift.track ?? null };
    if (!agendaStaffingShiftAppliesToOccurrence(scope, occurrence)) continue;
    for (const duty of shift.duties) {
      const name = duty.displayName.trim();
      if (!name || credited.has(name.toLowerCase())) continue;
      const key = hostKey(duty.role, name);
      if (!hosts.has(key)) hosts.set(key, { key, name, roleLabel: duty.role.trim().slice(0, 80) });
    }
  }
  return [...hosts.values()];
}
