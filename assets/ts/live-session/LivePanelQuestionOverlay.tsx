import type { OverlayRect } from "../../shared/live-overlay-geometry";
import type { LiveRoomSession, LiveStage } from "../../shared/schemas/live-session-room";
import { LiveBoard, liveBoardSize } from "./LiveBoard";
import { LivePanelistsCredits } from "./LivePanelistsOverlay";
import { LiveQuestionBody } from "./LiveQuestionOverlay";
import "./LivePanelQuestionOverlay.css";

/**
 * The audience question and the panel that answers it on one board: the
 * question at the top, the session and its people along the bottom, where
 * they sit on stage. A layout that stacks the two boxes gets this one board
 * in their place, so the frame shows one field and one logo, not two boards.
 */
export function LivePanelQuestionOverlay({
  stage,
  session,
  box,
}: {
  stage: LiveStage;
  session: LiveRoomSession;
  box: Pick<OverlayRect, "width" | "height">;
}) {
  const { question, panelists } = stage;
  if (!question || !panelists) return null;
  return (
    <LiveBoard
      box={box}
      class="pk-live-question pk-live-panelists pk-live-panel"
      label="Audience question to the panel"
      eyebrow="Audience question"
    >
      <LiveQuestionBody key={question.id} question={question} />
      <div class="pk-live-panel__people">
        <LivePanelistsCredits session={session} panelists={panelists} shape={liveBoardSize(box).shape} />
      </div>
    </LiveBoard>
  );
}
