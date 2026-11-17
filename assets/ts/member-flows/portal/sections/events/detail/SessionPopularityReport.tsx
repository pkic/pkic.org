import { useState } from "preact/hooks";
import { clockForZone, type ClockZone } from "../../../../../../shared/event-clock";
import { formatClockInZone, formatEventDayInZone } from "../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../shared/format-number";
import { LIVE_REACTIONS } from "../../../../../../shared/live-session-policy";
import {
  sessionPopularityReportResponseSchema,
  type SessionPopularityReportResponse,
  type SessionPopularityReportRow,
} from "../../../../../../shared/schemas/event-session-popularity-report";
import { ApiDataTable } from "../../../../../components/ApiDataTable";
import type { Column } from "../../../../../components/Table";
import { SessionChatActions } from "./SessionChatActions";

const REACTION_EMOJI = new Map<string, string>(LIVE_REACTIONS.map((reaction) => [reaction.id, reaction.emoji]));

/** "Tue, Dec 1 · 09:00" on the event's clock. */
function sessionStart(startAt: string, zone: ClockZone) {
  return `${formatEventDayInZone(startAt, zone)} · ${formatClockInZone(startAt, zone)}`;
}

type CountKey = "reactionTotal" | "chatPeople" | "questions" | "questionVotes" | "pollAnswers";

function countColumn(header: string, key: CountKey): Column<SessionPopularityReportRow> {
  return {
    header,
    align: "end",
    width: "fit",
    cell: (row) => formatNumber(row[key]),
    sort: { asc: key, desc: `-${key}`, defaultDirection: "desc" },
  };
}

/**
 * How each session's audience took part, side by side: its reactions with
 * their breakdown, the chat, the questions asked and voted on, and the poll answers,
 * sorted and paged by the server so organizers can compare sessions after the
 * event. Each reaction also has its own column, hidden until a reader wants
 * to sort by it.
 */
export function SessionPopularityReport({
  slug,
  clock,
  canModerateChat = false,
}: {
  slug: string;
  clock?: ClockZone;
  /** Moderators can download and erase the chat the live rooms still hold. */
  canModerateChat?: boolean;
}) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  return (
    <ApiDataTable<SessionPopularityReportRow, SessionPopularityReportResponse>
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/reports/popularity`}
      responseSchema={sessionPopularityReportResponseSchema}
      resolve={(response) => response.sessions}
      resolvePage={(response) => response.page}
      onData={(response) => setTimeZone(response.timeZone)}
      paginate
      initialSort="-reactionTotal"
      caption="Session popularity"
      urlState="sessionPopularity"
      searchPlaceholder="Find a session…"
      empty="No session has reactions, chat messages, questions, or poll answers yet. They appear here shortly after a live session starts."
      inset={
        <p class="pk-small pk-muted">
          Reactions count each person once per reaction every 10 seconds, so they reflect people, not clicks.
        </p>
      }
      toolbar={canModerateChat ? () => <SessionChatActions slug={slug} /> : undefined}
      rowKey={(row) => row.occurrenceId}
      columns={[
        {
          header: "Session",
          width: "primary",
          hideable: false,
          cell: (row) => (
            <>
              <div>{row.title}</div>
              {row.startAt && timeZone && (
                <div class="pk-small pk-muted">{sessionStart(row.startAt, clockForZone(clock, timeZone))}</div>
              )}
            </>
          ),
          sort: { asc: "title", desc: "-title" },
        },
        {
          header: "Starts",
          defaultHidden: true,
          width: "fit",
          cell: (row) => (row.startAt && timeZone ? sessionStart(row.startAt, clockForZone(clock, timeZone)) : "—"),
          sort: { asc: "startAt", desc: "-startAt" },
        },
        {
          header: "Reactions",
          align: "end",
          width: "fit",
          cell: (row) => (
            <>
              <div>{formatNumber(row.reactionTotal)}</div>
              <div class="pk-small pk-muted">
                {row.reactions
                  .filter((count) => count.total > 0)
                  .map((count) => `${REACTION_EMOJI.get(count.reaction)} ${formatNumber(count.total)}`)
                  .join(" · ")}
              </div>
            </>
          ),
          sort: { asc: "reactionTotal", desc: "-reactionTotal", defaultDirection: "desc" },
        },
        ...LIVE_REACTIONS.map((reaction): Column<SessionPopularityReportRow> => ({
          header: reaction.label,
          headerIcon: reaction.emoji,
          defaultHidden: true,
          align: "end",
          width: "fit",
          cell: (row) => formatNumber(row.reactions.find((count) => count.reaction === reaction.id)?.total ?? 0),
          sort: { asc: reaction.id, desc: `-${reaction.id}`, defaultDirection: "desc" },
        })),
        {
          header: "Chat messages",
          align: "end",
          width: "fit",
          cell: (row) => (
            <>
              <div>{formatNumber(row.chatMessages)}</div>
              {row.chatPeople > 0 && (
                <div class="pk-small pk-muted">
                  from {formatNumber(row.chatPeople)} {row.chatPeople === 1 ? "person" : "people"}
                </div>
              )}
            </>
          ),
          sort: { asc: "chatMessages", desc: "-chatMessages", defaultDirection: "desc" },
        },
        { ...countColumn("People in chat", "chatPeople"), defaultHidden: true },
        countColumn("Questions", "questions"),
        countColumn("Question votes", "questionVotes"),
        countColumn("Poll answers", "pollAnswers"),
      ]}
    />
  );
}
