import { LIVE_REACTION_IDS } from "../../../../assets/shared/live-session-policy";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  sessionPopularityReportResponseSchema,
  type SessionPopularityReportQuery,
} from "../../../../assets/shared/schemas/event-session-popularity-report";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { readEventAdminResource } from "../events/authorized-context";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";

interface PopularityRow {
  occurrence_id: string;
  title: string;
  start_at: string | null;
  reaction_total: number;
  questions: number;
  question_votes: number;
  poll_answers: number;
  [column: `r${number}`]: number;
}

/** One trusted column alias per reaction, in display order. */
const REACTION_COLUMNS = LIVE_REACTION_IDS.map((reaction, index) => ({ reaction, column: `r${index}` as const }));

const SORTS: Readonly<Record<string, string>> = {
  title: "o.title",
  startAt: "o.start_at",
  reactionTotal: "reaction_total",
  ...Object.fromEntries(REACTION_COLUMNS.map(({ reaction, column }) => [reaction, column])),
  questions: "questions",
  questionVotes: "question_votes",
  pollAnswers: "poll_answers",
};

/**
 * One row per agenda session that received any reaction, question or poll
 * answer, from the live rooms' durable copies. Each source is aggregated
 * through its event-and-session index before the join, and the page and its
 * total share one source, so sorting, search and paging stay in D1.
 */
function prepareSessionPopularityReport(
  db: DatabaseLike,
  event: EventReadSelection,
  query: SessionPopularityReportQuery,
) {
  const scope = eventReadIdSql(event);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["o.title"]) : null;
  const pivot = REACTION_COLUMNS.map(
    ({ column }) => `SUM(CASE WHEN reaction=? THEN total ELSE 0 END) AS ${column}`,
  ).join(",");
  return buildOffsetPageStatements(db, {
    source: {
      withSql: `WITH r AS (SELECT occurrence_id,${pivot},SUM(total) AS total FROM event_session_reaction_totals
          WHERE event_id=${scope.sql} AND reaction IN (SELECT value FROM json_each(?)) GROUP BY occurrence_id),
        q AS (SELECT occurrence_id,COUNT(*) AS asked,SUM(vote_count) AS votes FROM event_session_questions
          WHERE event_id=${scope.sql} GROUP BY occurrence_id),
        p AS (SELECT occurrence_id,SUM(respondents) AS answers FROM event_session_polls
          WHERE event_id=${scope.sql} GROUP BY occurrence_id),
        s AS (SELECT o.id,o.title,o.start_at,COALESCE(r.total,0) AS reaction_total,
          ${REACTION_COLUMNS.map(({ column }) => `COALESCE(r.${column},0) AS ${column}`).join(",")},
          COALESCE(q.asked,0) AS questions,COALESCE(q.votes,0) AS question_votes,COALESCE(p.answers,0) AS poll_answers
          FROM (SELECT occurrence_id FROM r UNION SELECT occurrence_id FROM q UNION SELECT occurrence_id FROM p) ids
          JOIN event_agenda_occurrences o ON o.id=ids.occurrence_id AND o.event_id=${scope.sql}
          LEFT JOIN r ON r.occurrence_id=o.id LEFT JOIN q ON q.occurrence_id=o.id LEFT JOIN p ON p.occurrence_id=o.id)`,
      selectSql: `SELECT o.id AS occurrence_id,o.title,o.start_at,reaction_total,${REACTION_COLUMNS.map(({ column }) => column).join(",")},questions,question_votes,poll_answers`,
      fromSql: `FROM s o WHERE (reaction_total>0 OR questions>0 OR poll_answers>0)${search ? ` AND ${search.sql}` : ""}`,
      bindings: [
        ...LIVE_REACTION_IDS,
        ...scope.bindings,
        JSON.stringify(LIVE_REACTION_IDS),
        ...scope.bindings,
        ...scope.bindings,
        ...scope.bindings,
        ...(search?.bindings ?? []),
      ],
    },
    orderBy: resolveMappedOrderBy(query.sort, SORTS, "reaction_total DESC", "o.id"),
    limit: query.limit,
    offset: query.offset,
  });
}

function decodeSessionPopularityReport(
  results: D1StatementResult[],
  query: SessionPopularityReportQuery,
  timeZone: string,
) {
  const page = decodeOffsetPageResults<PopularityRow>(results[0], results[1]);
  const sessions = page.rows.map((row) => ({
    occurrenceId: row.occurrence_id,
    title: row.title,
    startAt: row.start_at,
    reactions: REACTION_COLUMNS.map(({ reaction, column }) => ({ reaction, total: Number(row[column]) })),
    reactionTotal: Number(row.reaction_total),
    questions: Number(row.questions),
    questionVotes: Number(row.question_votes),
    pollAnswers: Number(row.poll_answers),
  }));
  return sessionPopularityReportResponseSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, page.total, sessions.length),
    timeZone,
  });
}

/** Organizers compare sessions by how their audiences took part, after the event or during it. */
export function readSessionPopularityReport(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: SessionPopularityReportQuery,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:read", (event) => ({
    statements: prepareSessionPopularityReport(db, event, query),
    decode: (results, record) => decodeSessionPopularityReport(results, query, record.timezone ?? "UTC"),
  }));
}
