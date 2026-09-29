/** The URL syntax is shared by the Worker, the join page, and the portal return path. */
const COMPACT_ID = "[A-Za-z0-9_-]{22}";

export const MEMBER_PERSONAL_MEETING_TOKEN = new RegExp(
  `^m2\\.(${COMPACT_ID})\\.(${COMPACT_ID})\\.(${COMPACT_ID}|0)\\.(${COMPACT_ID})$`,
);
export const GUEST_PERSONAL_MEETING_TOKEN = new RegExp(`^g2\\.(${COMPACT_ID})\\.(${COMPACT_ID})$`);

export function isPersonalMeetingToken(value: string): boolean {
  return MEMBER_PERSONAL_MEETING_TOKEN.test(value) || GUEST_PERSONAL_MEETING_TOKEN.test(value);
}
