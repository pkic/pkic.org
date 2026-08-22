import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { SponsorsListResponse } from "../../../assets/shared/schemas/public-sponsors";
import { sanitizeLegacyHttpUrl } from "../../../assets/shared/schemas/urls";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";

/**
 * Public sponsor read model. Consortium and event sponsorships are merged,
 * filtered, sorted, counted, and paged in D1. Tier display weights come from
 * sponsorship_tier_catalog rather than a frontend constant.
 */
export const PUBLIC_SPONSOR_READ_MODEL_SQL = `
  WITH selected_event AS (
    SELECT id
      FROM events
     WHERE lower(replace(name, ' - ', ' ')) = lower(replace(?, ' - ', ' '))
     ORDER BY starts_at DESC, id ASC
     LIMIT 1
  ), consortium_rows AS (
    SELECT 'org:' || o.id AS sponsor_key,
           o.id,
           o.name,
           o.website,
           o.logo_r2_key,
           NULL AS sponsorship_logo_r2_key,
           o.sponsor_tier AS tier
      FROM organizations o
     WHERE o.sponsor_tier IS NOT NULL
    UNION ALL
    SELECT 'sponsorship:' || sp.id AS sponsor_key,
           sp.id,
           sp.non_member_name AS name,
           sp.non_member_website AS website,
           NULL AS logo_r2_key,
           sp.non_member_logo_r2_key AS sponsorship_logo_r2_key,
           sp.tier
      FROM sponsorships sp
     WHERE sp.sponsor_type = 'consortium'
       AND sp.organization_id IS NULL
       AND sp.pipeline_stage = 'active'
       AND sp.non_member_name IS NOT NULL
  ), ranked_event_rows AS (
    SELECT CASE
             WHEN sp.organization_id IS NOT NULL THEN 'org:' || sp.organization_id
             ELSE 'sponsorship:' || sp.id
           END AS sponsor_key,
           COALESCE(o.id, sp.id) AS id,
           COALESCE(o.name, sp.non_member_name) AS name,
           COALESCE(o.website, sp.non_member_website) AS website,
           o.logo_r2_key,
           sp.non_member_logo_r2_key AS sponsorship_logo_r2_key,
           sp.tier AS event_tier,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(sp.organization_id, sp.id)
             ORDER BY sp.updated_at DESC, sp.id ASC
           ) AS event_rank
      FROM sponsorships sp
      JOIN selected_event e ON e.id = sp.event_id
      LEFT JOIN organizations o ON o.id = sp.organization_id
     WHERE sp.sponsor_type = 'event'
       AND sp.pipeline_stage = 'active'
       AND (sp.organization_id IS NOT NULL OR sp.non_member_name IS NOT NULL)
  ), event_rows AS (
    SELECT sponsor_key, id, name, website, logo_r2_key, sponsorship_logo_r2_key, event_tier
      FROM ranked_event_rows
     WHERE event_rank = 1
  ), sponsor_keys AS (
    SELECT sponsor_key FROM consortium_rows
    UNION
    SELECT sponsor_key FROM event_rows
  ), sponsor_rows AS (
    SELECT keys.sponsor_key,
           COALESCE(consortium.id, event.id) AS id,
           COALESCE(consortium.name, event.name) AS name,
           COALESCE(consortium.website, event.website) AS website,
           COALESCE(consortium.logo_r2_key, event.logo_r2_key) AS logo_r2_key,
           COALESCE(consortium.sponsorship_logo_r2_key, event.sponsorship_logo_r2_key) AS sponsorship_logo_r2_key,
           consortium.tier,
           event.event_tier
      FROM sponsor_keys keys
      LEFT JOIN consortium_rows consortium ON consortium.sponsor_key = keys.sponsor_key
      LEFT JOIN event_rows event ON event.sponsor_key = keys.sponsor_key
  ), enriched_sponsors AS (
    SELECT rows.*,
           COALESCE(rows.event_tier, rows.tier) AS effective_tier,
           COALESCE(event_tier.display_weight, consortium_tier.display_weight, 0) AS effective_weight,
           MAX(COALESCE(event_tier.display_weight, 0), COALESCE(consortium_tier.display_weight, 0)) AS max_weight
      FROM sponsor_rows rows
      LEFT JOIN sponsorship_tier_catalog consortium_tier
        ON consortium_tier.sponsor_type = 'consortium'
       AND consortium_tier.tier = rows.tier
       AND consortium_tier.active = 1
      LEFT JOIN sponsorship_tier_catalog event_tier
        ON event_tier.sponsor_type = 'event'
       AND event_tier.tier = rows.event_tier
       AND event_tier.active = 1
  )`;

interface SponsorRow {
  id: string;
  name: string;
  website: string | null;
  logo_r2_key: string | null;
  sponsorship_logo_r2_key: string | null;
  tier: string | null;
  event_tier: string | null;
  effective_tier: string;
  effective_weight: number;
}

interface PublicSponsorListOptions {
  eventName?: string;
  level?: string;
  minWeight?: number;
  limit: number;
  offset: number;
  q?: string;
  sort?: string;
}

function buildFilter(options: PublicSponsorListOptions): { sql: string; bindings: unknown[] } {
  const clauses = ["effective_weight > 0"];
  const bindings: unknown[] = [];

  if (options.q) {
    const search = buildD1TextSearchFilter(options.q, ["name"]);
    clauses.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (options.level && options.level !== "all") {
    clauses.push("(tier = ? OR event_tier = ?)");
    bindings.push(options.level, options.level);
  }
  if (options.minWeight !== undefined) {
    clauses.push("max_weight >= ?");
    bindings.push(options.minWeight);
  }

  return { sql: `WHERE ${clauses.join(" AND ")}`, bindings };
}

export async function listPublicSponsors(
  db: DatabaseLike,
  options: PublicSponsorListOptions,
): Promise<SponsorsListResponse> {
  const filter = buildFilter(options);
  const orderBy = resolveMappedOrderBy(
    options.sort,
    { name: "name", weight: "effective_weight" },
    "effective_weight DESC",
    "name ASC, id ASC",
  );
  const eventName = options.eventName ?? "";

  const { rows, total } = await queryPage<SponsorRow>(db, {
    sql: `${PUBLIC_SPONSOR_READ_MODEL_SQL}
            SELECT id, name, website, logo_r2_key, sponsorship_logo_r2_key,
                   tier, event_tier, effective_tier, effective_weight
              FROM enriched_sponsors
              ${filter.sql}`,
    bindings: [eventName, ...filter.bindings],
    orderBy,
    limit: options.limit,
    offset: options.offset,
  });

  const sponsors = rows.map((row) => ({
    id: row.id,
    name: row.name,
    website: sanitizeLegacyHttpUrl(row.website),
    logoUrl: row.logo_r2_key
      ? `/api/v1/members/${row.id}/logo`
      : row.sponsorship_logo_r2_key
        ? `/api/v1/sponsors/${row.id}/logo`
        : null,
    tier: row.tier,
    eventTier: row.event_tier,
    effectiveTier: row.effective_tier,
    weight: row.effective_weight,
  }));
  return { sponsors, page: buildPageInfo(options.limit, options.offset, total, sponsors.length) };
}

/** `id` is a sponsorship id; organization logos use GET /api/v1/members/:id/logo. */
export async function getNonMemberSponsorLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  const result = await db.prepare(`SELECT non_member_logo_r2_key FROM sponsorships WHERE id = ?`).bind(id).first();
  return (result as { non_member_logo_r2_key?: string | null } | null)?.non_member_logo_r2_key ?? null;
}
