import type { z } from "zod";
import {
  eventTicketSponsorListSchema,
  type eventTicketSponsorListQuerySchema,
} from "../../../../assets/shared/schemas/event-ticket-codes";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import type { DatabaseLike } from "../../types";

/**
 * The sponsors whose passes and codes an event counts: its own active event
 * sponsors, and the PKI Consortium's current sponsors, who sponsor every
 * event. A sponsor is its member organization, or the sponsorship when no
 * member organization is behind it. An organization that sponsors this event
 * itself counts once, as an event sponsor.
 */

/** A `WITH` entry named `event_sponsors`; `eventParam` is the SQL parameter that holds the event id. */
export function eventSponsorsCte(eventParam: string): string {
  return `event_sponsors AS (
    SELECT COALESCE(sponsor.organization_id, sponsor.id) AS sponsor_id, sponsor.organization_id,
           sponsor.id AS sponsorship_id, COALESCE(organization.name, sponsor.non_member_name, 'Sponsor') AS name,
           sponsor.tier, 'event' AS sponsor_type
    FROM sponsorships sponsor LEFT JOIN organizations organization ON organization.id = sponsor.organization_id
    WHERE sponsor.event_id = ${eventParam} AND sponsor.sponsor_type = 'event'
      AND sponsor.pipeline_stage = 'active' AND sponsor.tier IS NOT NULL
    UNION ALL
    SELECT organization.id, organization.id, NULL, organization.name, organization.sponsor_tier, 'consortium'
    FROM organizations organization
    WHERE organization.sponsor_tier IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sponsorships own WHERE own.event_id = ${eventParam} AND own.sponsor_type = 'event'
                        AND own.pipeline_stage = 'active' AND own.organization_id = organization.id)
    UNION ALL
    SELECT sponsor.id, NULL, sponsor.id, COALESCE(sponsor.non_member_name, 'Sponsor'), sponsor.tier, 'consortium'
    FROM sponsorships sponsor
    WHERE sponsor.sponsor_type = 'consortium' AND sponsor.organization_id IS NULL
      AND sponsor.pipeline_stage = 'active' AND sponsor.tier IS NOT NULL
  )`;
}

/** Whether a code belongs to the sponsor row `alias` of `event_sponsors`. */
export function codeOfSponsorSql(code: string, alias: string): string {
  return `(${code}.organization_id = ${alias}.organization_id
    OR (${code}.organization_id IS NULL AND ${alias}.organization_id IS NULL AND ${code}.sponsorship_id = ${alias}.sponsorship_id))`;
}

/** The sponsors a code can be made for, by name; ids are those `event_sponsors` gives. */
export async function listEventTicketSponsors(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof eventTicketSponsorListQuerySchema>,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["name"]) : null;
  const { rows, total } = await queryPage<{ sponsor_id: string; name: string; tier: string; sponsor_type: string }>(
    db,
    {
      source: {
        withSql: `WITH ${eventSponsorsCte("?1")}`,
        selectSql: "SELECT sponsor_id, name, tier, sponsor_type",
        fromSql: `FROM event_sponsors${search ? ` WHERE ${search.sql}` : ""}`,
        bindings: [eventId, ...(search?.bindings ?? [])],
      },
      orderBy: `ORDER BY name COLLATE NOCASE ${query.sort === "-name" ? "DESC" : "ASC"}, sponsor_id`,
      limit: query.limit,
      offset: query.offset,
    },
  );
  return eventTicketSponsorListSchema.parse({
    sponsors: rows.map((row) => ({
      id: row.sponsor_id,
      name: row.name,
      tier: row.tier,
      sponsorType: row.sponsor_type,
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
