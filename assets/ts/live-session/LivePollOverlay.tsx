import { formatNumber } from "../../shared/format-number";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import type { LivePoll } from "../../shared/schemas/live-session-poll";
import type { LiveStage } from "../../shared/schemas/live-session-room";
import { FormFieldStatChart } from "../components/forms/FormResponseStats";
import { LiveBoard } from "./LiveBoard";
import "./LivePollOverlay.css";

/**
 * The poll on air on the conference board: how many have voted, the question,
 * and its live tallies on the forms results chart, whose bars grow as answers
 * arrive.
 */
export function LivePollOverlay({
  stage,
  polls,
  box,
}: {
  stage: LiveStage;
  polls: readonly LivePoll[];
  box: Pick<OverlayRect, "width" | "height">;
}) {
  const poll = stage.poll ? polls.find((entry) => entry.id === stage.poll?.id) : undefined;
  if (!poll) return null;
  const votes = poll.results?.totalAnswers ?? 0;
  return (
    <LiveBoard
      key={poll.id}
      box={box}
      class="pk-live-poll"
      label="Poll results"
      eyebrow={`Poll · ${formatNumber(votes)} ${votes === 1 ? "vote" : "votes"}`}
    >
      <p class="pk-live-board__headline pk-live-overlay__poll-question">{poll.field.label}</p>
      {poll.results ? (
        <div class="pk-live-overlay__poll-results">
          <FormFieldStatChart
            field={poll.field}
            stat={poll.results}
            visualization={stage.poll?.presentation.chart ?? "bar"}
            presentation
          />
        </div>
      ) : null}
    </LiveBoard>
  );
}
