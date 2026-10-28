/**
 * The virtual room's Questions tab: the live Q&A of the session running in the location, or of the
 * next one once its room opens shortly before the start. Between sessions it says when questions open.
 */
import { SessionQuestions } from "../../../../../../live-session/SessionQuestions";
import { EmptyState } from "../../../../../../ui/EmptyState";
import type { RoomSession } from "./virtual-room-schedule";

export interface SessionQuestionsSlotProps {
  slug: string;
  /** The session running in the location now; null between sessions. */
  session: RoomSession | null;
  /** The next session in the location, whose room may already be open. */
  next?: RoomSession | null;
  /** The tab that names this panel, so the questions need no heading of their own. */
  labelledBy: string;
}

const CLOSED = (
  <EmptyState
    title="Questions open when the session is live"
    body="You can ask the speakers questions here during their session."
  />
);

export function SessionQuestionsSlot({ slug, session, next = null, labelledBy }: SessionQuestionsSlotProps) {
  const target = session ?? next;
  if (!target) return CLOSED;
  return (
    <SessionQuestions
      key={target.id}
      slug={slug}
      occurrenceId={target.id}
      startAt={target.startAt}
      endAt={target.endAt}
      labelledBy={labelledBy}
      showClosedControls
      closed={CLOSED}
    />
  );
}
