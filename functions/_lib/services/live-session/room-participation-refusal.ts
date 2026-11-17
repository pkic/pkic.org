import type { LiveRefusal } from "./room-controls";

/** One refusal for every way a blocked person tries to post, vote or react. */
export const LIVE_PARTICIPATION_REFUSAL = {
  code: "LIVE_PARTICIPATION_BLOCKED",
  message: "A moderator blocked your posting. You can keep watching.",
} satisfies LiveRefusal;
