import type { LivePollStatus } from "../../../../../../../shared/live-session-policy";
import "./LivePollStatusBadge.css";

const LABEL: Record<LivePollStatus, string> = {
  draft: "Prepared",
  open: "Voting open",
  closed: "Closed",
};

/**
 * Where a poll is in its life, as the desk and the results both name it: a
 * word, with a dot while voting is open, not a colored pill for every state.
 */
export function LivePollStatusBadge({ status }: { status: LivePollStatus }) {
  return (
    <span class="pk-live-poll-status" data-status={status}>
      {LABEL[status]}
    </span>
  );
}
