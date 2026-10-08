import type { z } from "zod";
import { BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT } from "../../../../assets/shared/schemas/event-badge-template";
import {
  agendaSponsorChoicesQuerySchema,
  agendaBreakSponsorDisplaySchema,
} from "../../../../assets/shared/schemas/event-agenda-sponsors";
import { buildPublicSponsorReadModel, publicSponsorFromRow, type SponsorRow } from "../public-sponsors";
import { buildD1TextSearchFilter } from "../../db/search";
import { queryPage } from "../../db/pagination";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";

interface AgendaSponsorRow extends SponsorRow {
  sponsor_id: string;
  source_json: string;
}
function source(eventId: string) {
  const read = buildPublicSponsorReadModel({ eventId });
  return {
    sql: `${read.sql} SELECT public.id,public.name,public.website,public.logo_r2_key,public.sponsorship_logo_r2_key,
      public.tier,public.event_tier,public.effective_tier,public.effective_weight,sp.id AS sponsor_id,
      json_object('sponsorId',sp.id,'updatedAt',sp.updated_at,'publicId',public.id,'name',public.name,'website',public.website,
        'logo',public.logo_r2_key,'sponsorLogo',public.sponsorship_logo_r2_key,'tier',public.tier,'eventTier',public.event_tier,
        'weight',public.effective_weight) AS source_json FROM sponsorships sp JOIN enriched_sponsors public
        ON public.id=COALESCE(sp.organization_id,sp.id)
      WHERE sp.event_id=? AND sp.sponsor_type='event' AND sp.pipeline_stage='active'
        AND public.event_tier IS NOT NULL AND public.effective_weight>0
        AND EXISTS(SELECT 1 FROM sponsorship_tier_catalog event_catalog
          WHERE event_catalog.sponsor_type='event' AND event_catalog.tier=public.event_tier
            AND event_catalog.active=1 AND event_catalog.display_weight>0)`,
    bindings: [...read.bindings, eventId],
  };
}

export async function listAgendaSponsorChoices(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaSponsorChoicesQuerySchema>,
) {
  const read = source(eventId);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["public.name"]) : null;
  const page = await queryPage<AgendaSponsorRow>(db, {
    sql: `${read.sql}${search ? ` AND ${search.sql}` : ""}`,
    bindings: [...read.bindings, ...(search?.bindings ?? [])],
    orderBy: `ORDER BY public.name ${query.sort?.startsWith("-") ? "DESC" : "ASC"},sp.id`,
    limit: query.limit,
    offset: query.offset,
  });
  return {
    sponsors: page.rows.map((row) => ({ sponsorId: row.sponsor_id, display: publicSponsorFromRow(row) })),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
  };
}

export async function readAgendaSponsorRows(db: DatabaseLike, eventId: string, sponsorIds: readonly string[]) {
  if (!sponsorIds.length) return [];
  const read = source(eventId);
  return all<AgendaSponsorRow>(
    db,
    `${read.sql} AND sp.id IN(SELECT value FROM json_each(?)) ORDER BY sp.id LIMIT 20001`,
    [...read.bindings, JSON.stringify(sponsorIds)],
  );
}

export function agendaSponsorDisplay(row: AgendaSponsorRow) {
  return agendaBreakSponsorDisplaySchema.parse(publicSponsorFromRow(row));
}

/** Selection is presentation-only and never grants sponsor access, membership, or attendee data. */
export async function prepareAgendaSponsorSelection(db: DatabaseLike, eventId: string, sponsorIds: readonly string[]) {
  if (!sponsorIds.length) return [];
  const rows = await readAgendaSponsorRows(db, eventId, sponsorIds);
  return prepareSponsorRowsGuard(db, eventId, sponsorIds, rows);
}

function prepareSponsorRowsGuard(
  db: DatabaseLike,
  eventId: string,
  sponsorIds: readonly string[],
  rows: readonly AgendaSponsorRow[],
) {
  if (rows.length !== sponsorIds.length || new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new AppError(
      422,
      "AGENDA_SPONSOR_INVALID",
      "Choose distinct active public sponsors belonging to this event.",
    );
  const read = source(eventId);
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT json_group_array(json(source_json)) FROM (${read.sql}
      AND sp.id IN(SELECT value FROM json_each(?)) ORDER BY sp.id))=?`,
      bindings: [
        ...read.bindings,
        JSON.stringify(sponsorIds),
        JSON.stringify(rows.map((row) => JSON.parse(row.source_json))),
      ],
    }),
  ];
}

/** Approval freezes exactly the branding the organizer reviewed, with the same final active-public source guard. */
export async function prepareAgendaSponsorApproval(
  db: DatabaseLike,
  eventId: string,
  occurrences: readonly AgendaOccurrence[],
) {
  const selected = occurrences.filter((occurrence) => occurrence.kind === "break" && occurrence.sponsorIds?.length);
  const ids = [...new Set(selected.flatMap((occurrence) => occurrence.sponsorIds ?? []))];
  if (!ids.length) return [];
  const rows = await readAgendaSponsorRows(db, eventId, ids);
  const display = new Map(rows.map((row) => [row.sponsor_id, agendaSponsorDisplay(row)]));
  if (
    selected.some(
      (occurrence) =>
        JSON.stringify(occurrence.sponsors ?? []) !==
        JSON.stringify(occurrence.sponsorIds!.flatMap((id) => (display.has(id) ? [display.get(id)!] : []))),
    )
  )
    throw new AppError(409, "AGENDA_SPONSOR_CHANGED", "Sponsor branding changed. Refresh before approving the agenda.");
  return prepareSponsorRowsGuard(db, eventId, ids, rows);
}

/** Complete bounded branding population for configured event tiers, using the agenda's canonical visibility policy. */
export async function prepareAgendaSponsorTierRead(db: DatabaseLike, eventId: string, tiers: readonly string[]) {
  const read = source(eventId);
  return prepareSponsorBrandingRead(
    db,
    `${read.sql} AND public.event_tier IN(SELECT value FROM json_each(?)) ORDER BY sp.id`,
    [...read.bindings, JSON.stringify([...new Set(tiers)])],
  );
}

/** Generic event badges discover actual visible event tiers from the same canonical population. */
export async function prepareAgendaSponsorBrandingRead(db: DatabaseLike, eventId: string) {
  const read = source(eventId);
  return prepareSponsorBrandingRead(db, `${read.sql} ORDER BY sp.id`, read.bindings);
}

async function prepareSponsorBrandingRead(db: DatabaseLike, sql: string, bindings: readonly unknown[]) {
  const rows = await all<AgendaSponsorRow>(db, `${sql} LIMIT ${BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT + 1}`, [
    ...bindings,
  ]);
  if (rows.length > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT)
    throw new AppError(422, "BADGE_SPONSOR_LIMIT", "Use at most 40 event sponsors in one badge template.");
  return {
    rows,
    guard: prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT json_group_array(json(source_json)) FROM (${sql}))=?`,
      bindings: [...bindings, JSON.stringify(rows.map((row) => JSON.parse(row.source_json)))],
    }),
  };
}
