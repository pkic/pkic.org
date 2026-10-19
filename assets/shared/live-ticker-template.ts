/** Insertion shortcuts for the shared logic-less overlay template engine. */
export const LIVE_TICKER_TAGS = [
  { key: "greeting", label: "Greeting" },
  { key: "session.title", label: "Current session title" },
  { key: "session.speakers", label: "Current speakers" },
  { key: "session.minutes_remaining", label: "Minutes remaining" },
  { key: "next.title", label: "Next session title" },
  { key: "next.speakers", label: "Next speakers" },
  { key: "next.time", label: "Next start time" },
  { key: "next.in", label: "Time until next session" },
  { key: "after_next.title", label: "Following session title" },
  { key: "after_next.speakers", label: "Following speakers" },
  { key: "after_next.time", label: "Following start time" },
  { key: "after_next.in", label: "Time until following session" },
  { key: "other_rooms.next", label: "Next sessions in other rooms" },
  { key: "sponsors.summary", label: "Sponsor tiers and names" },
  { key: "chat.latest", label: "Latest attendee chat" },
] as const;
export const LIVE_TICKER_NEAR_END_MS = 5 * 60000;
