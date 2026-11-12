import { formatNumber } from "../../shared/format-number";
import type { LiveStageContent as Content } from "../../shared/live-stage-display-plan";
import type { LivePoll } from "../../shared/schemas/live-session-poll";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";

/** A tag before a line: red while on air, green for what is next. */
function StageTag({ tone, children }: { tone: "live" | "next"; children: string }) {
  return (
    <span class="pk-live-stage-display__tag" data-tone={tone}>
      {children}
    </span>
  );
}

/** Only so many answers fit at the lead size; past that they step down to the smallest size. */
const LEAD_ANSWERS = 4;
/** The most answers the stage shows at all; the rest are left to the projector. */
const MAX_ANSWERS = 5;

/** One answer as a bar of its share, the answer's words over it and its percentage at the end. */
function PollAnswer({ entry }: { entry: { label: string; percent: number } }) {
  const geometry = useNumericCssProperties({ "--answer-share": Math.max(0, Math.min(100, entry.percent)) / 100 });
  return (
    <li class="pk-live-stage-display__answer" data-numeric-css-properties={geometry}>
      <span class="pk-live-stage-display__answer-label">{entry.label}</span>
      <span class="pk-live-stage-display__answer-share">{formatNumber(entry.percent)}%</span>
    </li>
  );
}

function StagePoll({ poll, onAir }: { poll: LivePoll; onAir: boolean }) {
  const entries = poll.results?.entries.slice(0, MAX_ANSWERS) ?? [];
  const votes = poll.results?.totalAnswers ?? 0;
  return (
    <div class="pk-live-stage-display__poll" data-dense={entries.length > LEAD_ANSWERS ? "" : undefined}>
      <p class="pk-live-stage-display__line">
        {onAir ? <StageTag tone="live">On air</StageTag> : null}
        <span class="pk-live-stage-display__poll-count">
          Poll · {formatNumber(votes)} {votes === 1 ? "vote" : "votes"}
        </span>
      </p>
      {entries.length ? (
        <ol class="pk-live-stage-display__answers">
          {entries.map((entry) => (
            <PollAnswer key={entry.label} entry={entry} />
          ))}
        </ol>
      ) : (
        <p class="pk-live-stage-display__question-text">{poll.field.label}</p>
      )}
    </div>
  );
}

/**
 * The question or poll beside the timer: the question being answered large,
 * tagged On air while it is on Program, and the one lined up next under it
 * with its votes. With nothing being answered, the next one leads.
 */
export function LiveStageContent({ content }: { content: Content }) {
  if (content.kind === "poll") return <StagePoll poll={content.poll} onAir={content.onAir} />;
  const { question, next } = content;
  return (
    <div class="pk-live-stage-display__questions">
      {question ? (
        <>
          {content.onAir ? (
            <p class="pk-live-stage-display__line">
              <StageTag tone="live">On air</StageTag>
            </p>
          ) : null}
          <p class="pk-live-stage-display__question-text">{question.text}</p>
        </>
      ) : null}
      {next ? (
        <p class="pk-live-stage-display__next" data-leads={question ? undefined : ""}>
          <StageTag tone="next">Next</StageTag>
          <span class="pk-live-stage-display__next-text">{next.question.text}</span>
          {next.votes !== null ? (
            <span class="pk-live-stage-display__votes" title="Votes">
              {formatNumber(next.votes)}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
