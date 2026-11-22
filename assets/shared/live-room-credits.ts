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
const SESSION_PERSON_KEY_PREFIX = "user:";

/** The lower-third key of a person with an account credited on the approved session. */
export function sessionLivePersonKey(userId: string): string {
  return `${SESSION_PERSON_KEY_PREFIX}${userId}`;
}

/** The account a session credit names, or null for a credit without one (a source credit or a host). */
export function sessionLiveCreditUserId(key: string): string | null {
  return key.startsWith(SESSION_PERSON_KEY_PREFIX) ? key.slice(SESSION_PERSON_KEY_PREFIX.length) || null : null;
}

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
  return (
    keys.has(addedLivePersonKey(person.userId, person.identityId)) || keys.has(sessionLivePersonKey(person.userId))
  );
}

export function isAddedLiveCreditKey(key: string): boolean {
  return key.startsWith(ADDED_KEY_PREFIX);
}

/**
 * Whether an added person was typed in, someone without an account: their
 * key names no account, where a person from the event's people is keyed by
 * account and identity. Only they can be edited; everyone else reads as
 * their identity has them.
 */
export function isTypedLiveCreditKey(key: string): boolean {
  return isAddedLiveCreditKey(key) && !key.slice(ADDED_KEY_PREFIX.length).includes(":");
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

/**
 * Every capacity a lower third shows for a person, primary first, each as its
 * title line; a person who speaks for more than one identity has several.
 * Someone without an account has the one line an operator typed for them.
 */
export function liveCreditAffiliations(credit: {
  identity: { title: string | null; organization: string | null } | null;
  additionalIdentities?: readonly { title: string | null; organization: string | null }[];
  titleLine?: string | null;
}): string[] {
  const lines = [credit.identity, ...(credit.additionalIdentities ?? [])].map((identity) =>
    liveCreditAffiliation({ identity }),
  );
  return [...new Set([...lines, credit.titleLine ?? ""].filter(Boolean))];
}

/** A credit that names its role, a host's or the moderator's: shown compact, under the speakers. */
export function liveCreditHasRole(credit: { roleLabel: string | null }): boolean {
  return credit.roleLabel !== null;
}

type AddressableCredit = { key: string; name: string; moderator: boolean; roleLabel: string | null };

/** Whom an attendee may address a question to: the session's speakers and its moderator, not its hosts. */
export function liveQuestionAddressees<Credit extends AddressableCredit>(credits: readonly Credit[]): Credit[] {
  return credits.filter((credit) => credit.moderator || !liveCreditHasRole(credit));
}

/** The name of the person a question is for, read from the session's credits; null when it is for everyone. */
export function liveQuestionAddresseeName(credits: readonly AddressableCredit[], key: string | null): string | null {
  if (key === null) return null;
  return liveQuestionAddressees(credits).find((credit) => credit.key === key)?.name ?? null;
}

/**
 * Who a desk shows as the asker. A prepared question was written by the
 * operator who prepared it, who is not its asker: it comes in anonymously,
 * so no desk names that operator. Other anonymous questions still name their
 * author to operators, who moderate them.
 */
export function liveQuestionAskerName(question: { prepared: boolean; authorName: string | null }): string | null {
  return question.prepared ? null : question.authorName;
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
