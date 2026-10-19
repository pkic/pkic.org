/**
 * The roles a live room recognizes beside an author's name, highest first.
 * Each is a fact the event or the site already shows in public: the event
 * team, the agenda's speaker credits, the groups' published leadership and
 * the member directory. The room derives them when someone writes; browsers
 * only draw them.
 */
export const LIVE_AUTHOR_ROLES = [
  { id: "event_team", label: "Event team" },
  { id: "speaker", label: "Speaker" },
  { id: "moderator", label: "Moderator" },
  { id: "host", label: "Host" },
  { id: "chair", label: "Chair" },
  { id: "vice_chair", label: "Vice-chair" },
  { id: "member", label: "PKI Consortium member" },
] as const;

export type LiveAuthorRole = (typeof LIVE_AUTHOR_ROLES)[number]["id"];
export const LIVE_AUTHOR_ROLE_IDS = LIVE_AUTHOR_ROLES.map((role) => role.id) as [LiveAuthorRole, ...LiveAuthorRole[]];

/** Marks shown inline beside a name; the author's card lists every role. */
export const LIVE_AUTHOR_INLINE_ROLES = 2;

const RANK = new Map<LiveAuthorRole, number>(LIVE_AUTHOR_ROLE_IDS.map((id, index) => [id, index]));

/** Each role once, highest first. */
export function orderLiveAuthorRoles(roles: Iterable<LiveAuthorRole>): LiveAuthorRole[] {
  return [...new Set(roles)].sort((left, right) => RANK.get(left)! - RANK.get(right)!);
}

/**
 * Roles that are ordinary in the room: true and worth a line on the author's
 * card, but no mark beside every message, so the marks that remain stand for
 * an exceptional part in the session.
 */
export const LIVE_AUTHOR_CARD_ONLY_ROLES: readonly LiveAuthorRole[] = ["member"];

/** The marks a name carries inline: only exceptional roles, highest first. */
export function inlineLiveAuthorRoles(roles: Iterable<LiveAuthorRole>): LiveAuthorRole[] {
  return orderLiveAuthorRoles(roles)
    .filter((role) => !LIVE_AUTHOR_CARD_ONLY_ROLES.includes(role))
    .slice(0, LIVE_AUTHOR_INLINE_ROLES);
}

export function liveAuthorRoleLabel(role: LiveAuthorRole): string {
  return LIVE_AUTHOR_ROLES.find((entry) => entry.id === role)!.label;
}

/** What an agenda credit's role makes its person in the room; a proposer is not credited on stage. */
export function liveAuthorRoleForCredit(role: string | null | undefined): LiveAuthorRole | null {
  if (role === "moderator") return "moderator";
  if (role === "speaker" || role === "co_speaker" || role === "panelist") return "speaker";
  return null;
}

/** A staffing role the agenda shows: a host is named as such; every other shown duty is the event team. */
export function liveAuthorRoleForDuty(name: string): LiveAuthorRole {
  return name.trim().toLowerCase() === "host" ? "host" : "event_team";
}
