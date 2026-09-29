import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type {
  SponsorsDisplayResponse,
  SponsorsListQuery,
  SponsorsListResponse,
} from "../../../assets/shared/schemas/public-sponsors";
import { sanitizeLegacyHttpUrl } from "../../../assets/shared/schemas/urls";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

/**
 * Public sponsor read model. Consortium and event sponsorships are merged,
 * filtered, sorted, counted, and paged in D1. Tier display weights come from
 * sponsorship_tier_catalog rather than a frontend constant.
 */
const PUBLIC_SPONSOR_READ_MODEL_CTE = `
  WITH selected_event AS (
    __SELECTED_EVENT__
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
    SELECT rows.sponsor_key, rows.id, rows.name, rows.website, rows.logo_r2_key,
           rows.sponsorship_logo_r2_key, rows.tier, rows.event_tier,
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

export type PublicSponsorEventIdentity = Pick<SponsorsListQuery, "eventSlug" | "eventName">;

/**
 * Select an event by stable canonical slug whenever available. Name matching is
 * deliberately retained only as a compatibility fallback for old shortcodes;
 * it is not used when a slug is supplied, so renamed/duplicate events cannot
 * silently redirect a sponsorship wall.
 */
export function buildPublicSponsorReadModel(identity: PublicSponsorEventIdentity = {}): {
  sql: string;
  bindings: unknown[];
} {
  if (identity.eventSlug) {
    return {
      sql: PUBLIC_SPONSOR_READ_MODEL_CTE.replace("__SELECTED_EVENT__", "SELECT id FROM events WHERE slug = ? LIMIT 1"),
      bindings: [identity.eventSlug],
    };
  }
  if (identity.eventName) {
    return {
      sql: PUBLIC_SPONSOR_READ_MODEL_CTE.replace(
        "__SELECTED_EVENT__",
        "SELECT id FROM events WHERE lower(replace(name, ' - ', ' ')) = lower(replace(?, ' - ', ' ')) ORDER BY starts_at DESC, id ASC LIMIT 1",
      ),
      bindings: [identity.eventName],
    };
  }
  return {
    sql: PUBLIC_SPONSOR_READ_MODEL_CTE.replace("__SELECTED_EVENT__", "SELECT id FROM events WHERE 0"),
    bindings: [],
  };
}

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

export type PublicSponsorListOptions = SponsorsListQuery;

async function rejectAmbiguousLegacyEventName(db: DatabaseLike, eventName?: string): Promise<void> {
  if (!eventName) return;
  const matches = await db
    .prepare("SELECT id FROM events WHERE lower(replace(name, ' - ', ' ')) = lower(replace(?, ' - ', ' ')) LIMIT 2")
    .bind(eventName)
    .all<{ id: string }>();
  if (matches.results.length > 1) {
    throw new AppError(
      400,
      "AMBIGUOUS_EVENT_NAME",
      "eventName matches multiple events; provide the canonical eventSlug instead.",
    );
  }
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

interface SponsorPageRow extends SponsorRow {
  total_count: number;
  page_marker: number;
  page_position: number | null;
}

export function buildPublicSponsorPageQuery(
  options: PublicSponsorListOptions,
  filter: { sql: string; bindings: unknown[] },
  orderBy: string,
): { sql: string; bindings: unknown[] } {
  const readModel = buildPublicSponsorReadModel(options);
  const orderExpression = orderBy.replace(/^ORDER\s+BY\s+/i, "");
  return {
    sql: `${readModel.sql}, filtered AS MATERIALIZED (
    SELECT id, name, website, logo_r2_key, sponsorship_logo_r2_key,
           tier, event_tier, effective_tier, effective_weight
      FROM enriched_sponsors
      ${filter.sql}
  ), page_rows AS (
    SELECT id, name, website, logo_r2_key, sponsorship_logo_r2_key,
           tier, event_tier, effective_tier, effective_weight,
           COUNT(*) OVER() AS total_count,
           ROW_NUMBER() OVER (ORDER BY ${orderExpression}) AS page_position,
           0 AS page_marker
      FROM filtered
     ${orderBy}
     LIMIT ? OFFSET ?
  ), total_row AS (
    SELECT NULL AS id, NULL AS name, NULL AS website, NULL AS logo_r2_key,
           NULL AS sponsorship_logo_r2_key, NULL AS tier, NULL AS event_tier,
           NULL AS effective_tier, NULL AS effective_weight,
           COUNT(*) AS total_count, NULL AS page_position, 1 AS page_marker
      FROM filtered
  )
  SELECT id, name, website, logo_r2_key, sponsorship_logo_r2_key,
         tier, event_tier, effective_tier, effective_weight,
         total_count, page_position, page_marker
    FROM page_rows
  UNION ALL
  SELECT id, name, website, logo_r2_key, sponsorship_logo_r2_key,
         tier, event_tier, effective_tier, effective_weight,
         total_count, page_position, page_marker
    FROM total_row
   ORDER BY page_marker, page_position`,
    bindings: [...readModel.bindings, ...filter.bindings, options.limit, options.offset],
  };
}

/**
 * Executes the sponsor projection once. The final total row makes the total
 * available even when the requested offset is beyond the final page, without
 * issuing queryPage's second full CTE evaluation.
 */
async function querySponsorPage(
  db: DatabaseLike,
  options: PublicSponsorListOptions,
  filter: { sql: string; bindings: unknown[] },
  orderBy: string,
): Promise<{ rows: SponsorRow[]; total: number }> {
  const query = buildPublicSponsorPageQuery(options, filter, orderBy);
  const result = await db
    .prepare(query.sql)
    .bind(...query.bindings)
    .all<SponsorPageRow>();
  const totalRow = result.results.find((row) => row.page_marker === 1);
  return {
    rows: result.results.filter((row) => row.page_marker === 0),
    total: Number(totalRow?.total_count ?? result.results[0]?.total_count ?? 0),
  };
}

export async function listPublicSponsors(
  db: DatabaseLike,
  options: PublicSponsorListOptions,
): Promise<SponsorsListResponse> {
  await rejectAmbiguousLegacyEventName(db, options.eventName && !options.eventSlug ? options.eventName : undefined);
  const filter = buildFilter(options);
  const orderBy = resolveMappedOrderBy(
    options.sort,
    { name: "name", weight: "effective_weight" },
    "effective_weight DESC",
    "name ASC, id ASC",
  );
  const { rows, total } = await querySponsorPage(db, options, filter, orderBy);

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

export async function listPublicSponsorDisplay(
  db: DatabaseLike,
  options: PublicSponsorListOptions,
): Promise<SponsorsDisplayResponse> {
  const response = await listPublicSponsors(db, options);
  const groups = new Map<number, { weight: number; tierName: string; sponsors: typeof response.sponsors }>();
  for (const sponsor of response.sponsors) {
    const group = groups.get(sponsor.weight) ?? {
      weight: sponsor.weight,
      tierName: sponsor.effectiveTier,
      sponsors: [],
    };
    group.sponsors.push(sponsor);
    groups.set(sponsor.weight, group);
  }
  return {
    groups: [...groups.values()].sort((a, b) => b.weight - a.weight),
    page: response.page,
  };
}

/** `id` is a sponsorship id; organization logos use GET /api/v1/members/:id/logo. */
export async function getNonMemberSponsorLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  const result = await db.prepare(`SELECT non_member_logo_r2_key FROM sponsorships WHERE id = ?`).bind(id).first();
  return (result as { non_member_logo_r2_key?: string | null } | null)?.non_member_logo_r2_key ?? null;
}
