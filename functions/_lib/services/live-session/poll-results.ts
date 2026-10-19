import { formFieldStatFromTallies } from "../../../../assets/shared/form-field-statistics";
import { livePollFieldSchema } from "../../../../assets/shared/schemas/live-session-poll";
import {
  livePollResultsResponseSchema,
  type LivePollResultsQuery,
} from "../../../../assets/shared/schemas/live-session-poll-results";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { all } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { LivePollStatus } from "../../../../assets/shared/live-session-policy";

interface PollRow {
  id: string;
  field_json: string;
  status: LivePollStatus;
  show_results: number;
  respondents: number;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
}

const SORTS = { createdAt: "p.created_at", openedAt: "p.opened_at", respondents: "p.respondents" } as const;

/**
 * One session's poll results as the durable copy holds them: a page of its
 * opened and closed polls, searchable by question, each charted from its
 * copied counts with the forms statistics. The tallies of the page arrive in
 * one statement.
 */
export async function listLivePollResults(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  query: LivePollResultsQuery,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["json_extract(p.field_json, '$.label')"]) : null;
  const page = await queryPage<PollRow>(db, {
    source: {
      selectSql: `SELECT p.id, p.field_json, p.status, p.show_results, p.respondents, p.created_at, p.opened_at, p.closed_at`,
      fromSql: `FROM event_session_polls p WHERE p.event_id = ? AND p.occurrence_id = ?${search ? ` AND ${search.sql}` : ""}`,
      bindings: [eventId, occurrenceId, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(query.sort, SORTS, "p.created_at", "p.id"),
    limit: query.limit,
    offset: query.offset,
  });
  const tallies = page.rows.length
    ? await all<{ poll_id: string; value: string; vote_count: number }>(
        db,
        `SELECT poll_id, value, vote_count FROM event_session_poll_tallies
         WHERE poll_id IN (SELECT value FROM json_each(?)) ORDER BY poll_id, value`,
        [JSON.stringify(page.rows.map((row) => row.id))],
      )
    : [];
  const polls = page.rows.map((row) => {
    const field = livePollFieldSchema.parse(JSON.parse(row.field_json));
    const counts = new Map(
      tallies.filter((tally) => tally.poll_id === row.id).map((tally) => [tally.value, tally.vote_count]),
    );
    return {
      id: row.id,
      field,
      status: row.status,
      showResults: row.show_results === 1,
      results: formFieldStatFromTallies(field, counts, row.respondents),
      createdAt: row.created_at,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    };
  });
  return livePollResultsResponseSchema.parse({
    polls,
    page: buildPageInfo(query.limit, query.offset, page.total, polls.length),
  });
}
