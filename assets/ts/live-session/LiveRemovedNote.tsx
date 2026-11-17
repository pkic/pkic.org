import { liveModerationReasonLabel } from "../../shared/live-moderation-policy";
import type { LiveRemoval } from "../../shared/schemas/live-session-moderation";
import "./LiveRemovedNote.css";

/** The author's own removed post: and why it went. */
export function LiveRemovedNote({ removal }: { removal: LiveRemoval }) {
  return <p class="pk-live-removed">Removed by a moderator: {liveModerationReasonLabel(removal.reason)}.</p>;
}
