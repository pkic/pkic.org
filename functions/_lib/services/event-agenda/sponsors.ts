import type { z } from "zod";
import { BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT } from "../../../../assets/shared/schemas/event-badge-template";
import {
  agendaSponsorChoicesQuerySchema,
  agendaBreakSponsorDisplaySchema,
} from "../../../../assets/shared/schemas/event-agenda-sponsors";
import { buildPublicSponsorReadModel, publicSponsorFromRow, type SponsorRow } from "../public-sponsors";
import { buildD1TextSearchFilter } from "../../db/search";
import { queryPage, batchRows } from "../../db/pagination";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult } from "../../types";
import type { AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { AgendaOccurrenceSelection } from "./occurrence-selection";

export interface AgendaSponsorRow extends SponsorRow {
  sponsor_id: string;
  source_json: string;
}
function source(eventId: EventReadSelection, occurrences?: AgendaOccurrenceSelection) {
  const scope = eventReadIdSql(eventId);
  const read = buildPublicSponsorReadModel(
    typeof eventId === "string" ? { eventId } : { eventSlug: eventId.slug },
    occurrences
      ? { sql: `agenda_sponsor_page AS MATERIALIZED(${occurrences.sql})`, bindings: occurrences.bindings }
      : undefined,
  );
  return {
    sql: `${read.sql} SELECT public.id,public.name,public.website,public.logo_r2_key,public.sponsorship_logo_r2_key,
      public.tier,public.event_tier,public.effective_tier,public.effective_weight,sp.id AS sponsor_id,
      json_object('sponsorId',sp.id,'updatedAt',sp.updated_at,'publicId',public.id,'name',public.name,'website',public.website,
        'logo',public.logo_r2_key,'sponsorLogo',public.sponsorship_logo_r2_key,'tier',public.tier,'eventTier',public.event_tier,
        'weight',public.effective_weight) AS source_json FROM sponsorships sp JOIN enriched_sponsors public
        ON public.id=COALESCE(sp.organization_id,sp.id)
      WHERE sp.event_id=${scope.sql} AND sp.sponsor_type='event' AND sp.pipeline_stage='active'
        AND public.event_tier IS NOT NULL AND public.effective_weight>0
        AND EXISTS(SELECT 1 FROM sponsorship_tier_catalog event_catalog
          WHERE event_catalog.sponsor_type='event' AND event_catalog.tier=public.event_tier
            AND event_catalog.active=1 AND event_catalog.display_weight>0)`,
    bindings: [...read.bindings, ...scope.bindings],
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

export function prepareAgendaSponsorRead(
  db: DatabaseLike,
  eventId: EventReadSelection,
  sponsorIds?: readonly string[],
  occurrences?: AgendaOccurrenceSelection,
) {
  const scope = eventReadIdSql(eventId);
  const read = source(eventId, occurrences);
  const selection =
    sponsorIds === undefined
      ? `SELECT selected.value FROM events event
       JOIN json_each(event.settings_json,'$.agenda.sessionSponsors') source
       JOIN event_agenda_occurrences occurrence ON occurrence.id=source.key AND occurrence.event_id=event.id
       JOIN json_each(source.value,'$.sponsorIds') selected
       WHERE event.id=${scope.sql} AND occurrence.kind='break'${occurrences ? " AND occurrence.id IN(SELECT id FROM agenda_sponsor_page)" : ""}`
      : "SELECT value FROM json_each(?)";
  return db
    .prepare(`${read.sql} AND sp.id IN(${selection}) ORDER BY sp.id LIMIT 20001`)
    .bind(...read.bindings, ...(sponsorIds === undefined ? scope.bindings : [JSON.stringify(sponsorIds)]));
}

export async function readAgendaSponsorRows(db: DatabaseLike, eventId: string, sponsorIds: readonly string[]) {
  if (!sponsorIds.length) return [];
  return (await prepareAgendaSponsorRead(db, eventId, sponsorIds).all<AgendaSponsorRow>()).results;
}

export function agendaSponsorDisplay(row: AgendaSponsorRow) {
  return agendaBreakSponsorDisplaySchema.parse(publicSponsorFromRow(row));
}

/** Selection is presentation-only and never grants sponsor access, membership, or attendee data. */
/** Prepare selection evidence alongside the agenda snapshot; primary guards still own the final branding check. */
export function prepareAgendaSponsorSelectionRead(
  db: DatabaseLike,
  eventId: EventReadSelection,
  sponsorIds: readonly string[],
) {
  return {
    statements: sponsorIds.length ? [prepareAgendaSponsorRead(db, eventId, sponsorIds)] : [],
    decode(loaded: D1StatementResult[], canonicalEventId: string) {
      return sponsorIds.length
        ? prepareSponsorRowsGuard(db, canonicalEventId, sponsorIds, batchRows<AgendaSponsorRow>(loaded[0]))
        : [];
    },
  };
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
export function prepareAgendaSponsorApprovalRead(
  db: DatabaseLike,
  eventId: string,
  occurrences: readonly AgendaOccurrence[],
) {
  const selected = occurrences.filter((occurrence) => occurrence.kind === "break" && occurrence.sponsorIds?.length);
  const ids = [...new Set(selected.flatMap((occurrence) => occurrence.sponsorIds ?? []))];
  return {
    statements: ids.length ? [prepareAgendaSponsorRead(db, eventId, ids)] : [],
    decode(loaded: D1StatementResult[]) {
      if (!ids.length) return [];
      const rows = batchRows<AgendaSponsorRow>(loaded[0]);
      const display = new Map(rows.map((row) => [row.sponsor_id, agendaSponsorDisplay(row)]));
      if (
        selected.some(
          (occurrence) =>
            JSON.stringify(occurrence.sponsors ?? []) !==
            JSON.stringify(occurrence.sponsorIds!.flatMap((id) => (display.has(id) ? [display.get(id)!] : []))),
        )
      )
        throw new AppError(
          409,
          "AGENDA_SPONSOR_CHANGED",
          "Sponsor branding changed. Refresh before approving the agenda.",
        );
      return prepareSponsorRowsGuard(db, eventId, ids, rows);
    },
  };
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

/**
 * Current PKI Consortium sponsors of the given consortium tiers for badge branding: exactly the public sponsor
 * wall's consortium population (an organization's active consortium tier, or an active non-member consortium
 * sponsorship) limited to visible catalog tiers. Event sponsorships never enter this population.
 */
export async function prepareConsortiumSponsorTierRead(db: DatabaseLike, eventId: string, tiers: readonly string[]) {
  const read = buildPublicSponsorReadModel({ eventId });
  return prepareSponsorBrandingRead(
    db,
    `${read.sql} SELECT public.id,public.name,public.website,public.logo_r2_key,public.sponsorship_logo_r2_key,
      public.tier,public.event_tier,public.effective_tier,consortium_catalog.display_weight AS effective_weight,
      public.id AS sponsor_id,
      json_object('publicId',public.id,'name',public.name,'website',public.website,'logo',public.logo_r2_key,
        'sponsorLogo',public.sponsorship_logo_r2_key,'tier',public.tier,'weight',consortium_catalog.display_weight)
        AS source_json
      FROM enriched_sponsors public
      JOIN sponsorship_tier_catalog consortium_catalog
        ON consortium_catalog.sponsor_type='consortium' AND consortium_catalog.tier=public.tier
       AND consortium_catalog.active=1 AND consortium_catalog.display_weight>0
     WHERE public.tier IN(SELECT value FROM json_each(?)) ORDER BY public.name,public.id`,
    [...read.bindings, JSON.stringify([...new Set(tiers)])],
  );
}

/** Generic event badges discover actual visible event tiers from the same canonical population. */
export async function prepareAgendaSponsorBrandingRead(db: DatabaseLike, eventId: string) {
  const read = source(eventId);
  return prepareSponsorBrandingRead(db, `${read.sql} ORDER BY sp.id`, read.bindings);
}

async function prepareSponsorBrandingRead(db: DatabaseLike, sql: string, bindings: readonly unknown[]) {
  const read = prepareSponsorBrandingSnapshot(db, sql, bindings);
  return read.decode(await db.batch(read.statements));
}
function prepareSponsorBrandingSnapshot(db: DatabaseLike, sql: string, bindings: readonly unknown[]) {
  return {
    statements: [db.prepare(`${sql} LIMIT ${BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT + 1}`).bind(...bindings)],
    decode(loaded: D1StatementResult[]) {
      const rows = batchRows<AgendaSponsorRow>(loaded[0]);
      if (rows.length > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT)
        throw new AppError(422, "BADGE_SPONSOR_LIMIT", "Use at most 40 sponsors in one badge template.");
      return {
        rows,
        guard: prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE (SELECT json_group_array(json(source_json)) FROM (${sql}))=?`,
          bindings: [...bindings, JSON.stringify(rows.map((row) => JSON.parse(row.source_json)))],
        }),
      };
    },
  };
}

/** The configured tier selection is SQL-owned so it composes with an unresolved event slug. */
export function prepareConfiguredSponsorBranding(db: DatabaseLike, eventId: EventReadSelection, consortium = false) {
  const scope = eventReadIdSql(eventId);
  const selected = `SELECT json_extract(value,'$.tierName') FROM events configured, json_each(COALESCE(json_extract(configured.settings_json,'$.promotionDesign.sponsorGroups'),json_extract(configured.settings_json,'$.badgeTemplate.sponsorGroups'),'[]')) WHERE configured.id=${scope.sql} AND COALESCE(json_extract(value,'$.source'),'event')=?`;
  if (!consortium) {
    const read = source(eventId);
    return prepareSponsorBrandingSnapshot(
      db,
      `${read.sql} AND (EXISTS(SELECT 1 FROM events configured WHERE configured.id=${scope.sql} AND COALESCE(json_extract(configured.settings_json,'$.promotionDesign.sponsorSource'),'event')='event') OR public.event_tier IN(${selected})) ORDER BY sp.id`,
      [...read.bindings, ...scope.bindings, ...scope.bindings, "event"],
    );
  }
  const read = buildPublicSponsorReadModel(typeof eventId === "string" ? { eventId } : { eventSlug: eventId.slug });
  return prepareSponsorBrandingSnapshot(
    db,
    `${read.sql} SELECT public.id,public.name,public.website,public.logo_r2_key,public.sponsorship_logo_r2_key,public.tier,public.event_tier,public.effective_tier,catalog.display_weight AS effective_weight, public.id AS sponsor_id,
    json_object('publicId',public.id,'name',public.name,'website',public.website,'logo',public.logo_r2_key,'sponsorLogo',public.sponsorship_logo_r2_key,'tier',public.tier,'weight',catalog.display_weight) AS source_json
    FROM enriched_sponsors public JOIN sponsorship_tier_catalog catalog ON catalog.sponsor_type='consortium' AND catalog.tier=public.tier AND catalog.active=1 AND catalog.display_weight>0 WHERE public.tier IN(${selected}) ORDER BY public.name,public.id`,
    [...read.bindings, ...scope.bindings, "consortium"],
  );
}
