import type {
  SponsorshipEvent,
  SponsorshipEventsListQuery,
  SponsorshipEventsListResponse,
  SponsorshipPipelineStage,
} from "../../../../assets/shared/schemas/admin-sponsorships";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

interface SponsorshipEventRow {
  id: string;
  from_stage: SponsorshipPipelineStage | null;
  to_stage: SponsorshipPipelineStage;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

function toSponsorshipEvent(row: SponsorshipEventRow): SponsorshipEvent {
  return {
    id: row.id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Builds one bounded, searchable sponsorship pipeline-history page in D1. */
export async function listSponsorshipEvents(
  db: DatabaseLike,
  sponsorshipId: string,
  query: SponsorshipEventsListQuery,
): Promise<SponsorshipEventsListResponse> {
  const sponsorship = await first<{ id: string }>(db, "SELECT id FROM sponsorships WHERE id = ? LIMIT 1", [
    sponsorshipId,
  ]);
  if (!sponsorship) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }

  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "se.note",
        "se.from_stage",
        "se.to_stage",
        "u.email",
        "u.first_name",
        "u.last_name",
      ])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [sponsorshipId, ...(search?.bindings ?? [])];
  const from = `FROM sponsorship_events se LEFT JOIN users u ON u.id = se.actor_user_id`;
  const descending = query.sort.startsWith("-");
  const orderBy = resolveMappedOrderBy(
    query.sort,
    { createdAt: "se.created_at" },
    "se.created_at DESC",
    `se.id ${descending ? "DESC" : "ASC"}`,
  );
  const { rows, total } = await queryPage<SponsorshipEventRow>(db, {
    sql: `SELECT se.id, se.from_stage, se.to_stage, se.actor_user_id,
                   COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_name,
                   se.note, se.created_at
            ${from}
            WHERE se.sponsorship_id = ? ${searchSql}
            `,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const events = rows.map(toSponsorshipEvent);
  return { events, page: buildPageInfo(query.limit, query.offset, total, events.length) };
}
