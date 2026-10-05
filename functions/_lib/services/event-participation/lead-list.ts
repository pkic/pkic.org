import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  type SponsorLead,
  type SponsorLeadQuery,
  type SponsorLeadSponsorsQuery,
} from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../db/types";
import { AppError } from "../../errors";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import { sponsorConsentSql } from "./sponsor-consent";
import { sponsorLeadPermissionSql } from "./lead-scope";

/** Page and count recheck authorization and current consent in the same native D1 batch. */
export async function listSponsorLeads(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  operatorUserId: string,
  query: SponsorLeadQuery,
) {
  const scope = sponsorLeadPermissionSql("agenda:leads_view");
  const scopeValues = [operatorUserId, sponsorId, operatorUserId, sponsorId];
  if (
    !(await first(
      db,
      "SELECT id FROM sponsorships WHERE id=? AND event_id=? AND sponsor_type='event' AND pipeline_stage='active'",
      [sponsorId, eventId],
    ))
  )
    throw new AppError(404, "LEAD_SPONSOR_NOT_FOUND", "Active sponsorship not found in this event.");
  if (!(await first(db, `SELECT 1 WHERE (${scope})`, scopeValues)))
    throw new AppError(403, "LEAD_VIEW_SCOPE_REQUIRED", "An active sponsor-specific lead viewing grant is required.");
  await assertEventContactAccess(db, eventId);
  const name = "TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,''))";
  const search = query.q ? buildD1TextSearchFilter(query.q, [name, "u.email", "u.organization_name"]) : null;
  const { rows, total } = await queryPage<SponsorLead>(db, {
    source: {
      selectSql: `SELECT lead.id,lead.user_id AS userId,${name} AS name,u.email,u.organization_name AS organization,
        lead.observed_at AS capturedAt,lead.operator_user_id AS operatorUserId,
        TRIM(COALESCE(capturer.first_name,'') || ' ' || COALESCE(capturer.last_name,'')) AS operatorName`,
      fromSql: `FROM event_sponsor_leads lead JOIN users u ON u.id=lead.user_id
        JOIN users capturer ON capturer.id=lead.operator_user_id
        JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
        JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
        WHERE lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND u.active=1
        AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active'
        AND ${sponsorConsentSql("reg")} AND (${scope}) AND ${eventContactAccessSql("lead.event_id")} ${search ? `AND ${search.sql}` : ""}`,
      bindings: [eventId, sponsorId, ...scopeValues, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name, email: "u.email", organization: "u.organization_name", capturedAt: "lead.observed_at" },
      "lead.observed_at DESC",
      "lead.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return sponsorLeadListSchema.parse({
    leads: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

/** Discover only sponsor grants the signed-in operator can actually exercise. */
export async function listLeadSponsors(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  query: SponsorLeadSponsorsQuery,
) {
  const name = "COALESCE(org.name,sponsor.non_member_name,sponsor.contact_name,'Unspecified sponsor')";
  const search = query.q ? buildD1TextSearchFilter(query.q, [name]) : null;
  const permissions = ["agenda:leads_view", "agenda:leads_capture", "agenda:leads_export"] as const;
  const expressions = permissions.map((permission) => sponsorLeadPermissionSql(permission, "sponsor.id"));
  const values = permissions.flatMap(() => [operatorUserId, operatorUserId]);
  const { rows, total } = await queryPage<{
    id: string;
    name: string;
    canView: number;
    canCapture: number;
    canExport: number;
  }>(db, {
    source: {
      selectSql: `SELECT sponsor.id,${name} AS name,(${expressions[0]}) AS canView,(${expressions[1]}) AS canCapture,(${expressions[2]}) AS canExport`,
      fromSql: `FROM sponsorships sponsor LEFT JOIN organizations org ON org.id=sponsor.organization_id
        WHERE sponsor.event_id=? AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active'
        AND (${expressions.map((expression) => `(${expression})`).join(" OR ")}) ${search ? `AND ${search.sql}` : ""}`,
      bindings: [...values, eventId, ...values, ...(search?.bindings ?? [])],
      countBindings: [eventId, ...values, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(query.sort, { name }, `${name} ASC`, "sponsor.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  return sponsorLeadSponsorsSchema.parse({
    sponsors: rows.map((row) => ({
      ...row,
      canView: !!row.canView,
      canCapture: !!row.canCapture,
      canExport: !!row.canExport,
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

import {
  sponsorLeadCapturesSchema,
  type SponsorLeadCapture,
  type SponsorLeadCapturesQuery,
} from "../../../../assets/shared/schemas/event-sponsor-lead-list";
/** A consent withdrawal removes access to both live contacts and capture provenance. */
export async function listSponsorLeadCaptures(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  operatorUserId: string,
  query: SponsorLeadCapturesQuery,
) {
  await assertEventContactAccess(db, eventId);
  const scope = sponsorLeadPermissionSql("agenda:leads_view");
  const source = `FROM event_scan_attempts attempt
    JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
    JOIN users attendee ON attendee.id=lead.user_id JOIN users operator ON operator.id=attempt.operator_user_id
    JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
    JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
    WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND attendee.active=1
    AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active' AND ${sponsorConsentSql("reg")}
    AND (${scope}) AND ${eventContactAccessSql("lead.event_id")} AND attempt.action='lead' AND attempt.outcome='eligible'`;
  // Reuse the live-contact guard and predicates; an unknown/withdrawn lead yields no metadata.
  if (
    !(await first(
      db,
      `SELECT lead.id FROM event_sponsor_leads lead JOIN users attendee ON attendee.id=lead.user_id JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
    WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND attendee.active=1 AND reg.status='registered' AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active' AND ${sponsorConsentSql("reg")} AND (${scope}) AND ${eventContactAccessSql("lead.event_id")}`,
      [leadId, eventId, sponsorId, operatorUserId, sponsorId, operatorUserId, sponsorId],
    ))
  )
    throw new AppError(404, "LEAD_NOT_FOUND", "Current consenting lead not found.");
  const name = "TRIM(COALESCE(operator.first_name,'') || ' ' || COALESCE(operator.last_name,''))";
  const search = query.q ? buildD1TextSearchFilter(query.q, [name]) : null;
  const { rows, total } = await queryPage<SponsorLeadCapture>(db, {
    source: {
      selectSql: `SELECT attempt.id,attempt.operator_user_id AS operatorUserId,${name} AS operatorName,attempt.observed_at AS observedAt,attempt.created_at AS receivedAt`,
      fromSql: `${source} ${search ? `AND ${search.sql}` : ""}`,
      bindings: [
        leadId,
        eventId,
        sponsorId,
        operatorUserId,
        sponsorId,
        operatorUserId,
        sponsorId,
        ...(search?.bindings ?? []),
      ],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { observedAt: "attempt.observed_at", receivedAt: "attempt.created_at" },
      "attempt.created_at DESC",
      "attempt.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return sponsorLeadCapturesSchema.parse({
    captures: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
