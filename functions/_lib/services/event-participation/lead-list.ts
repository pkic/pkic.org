import { registrationJobTitleSql, registrationOrganizationSql } from "../registrations/selected-identity";
import {
  sponsorLeadListSchema,
  sponsorLeadDetailSchema,
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
import { sponsorLeadReadEvidence } from "./lead-scope";
import {
  activeLeadSponsorOfEventSql,
  sponsorLeadViewerPredicateSql,
} from "../../auth/sponsor-organization-lead-access";
import { activeSponsorLeadOriginSql } from "./sponsor-lead-active";
import { requireTokenPermission, tokenAllowsPermission } from "../../auth/permissions";
import type { UserBackedAuthAdmin } from "../../types";

type LeadReadScope = "all" | "mine";

/** Scope is chosen from live permissions, then rechecked in the page query. */
async function resolveSponsorLeadReadScope(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  actor: UserBackedAuthAdmin,
): Promise<LeadReadScope> {
  const canView = tokenAllowsPermission(actor, "agenda:leads_view");
  const canCapture = tokenAllowsPermission(actor, "agenda:leads_capture");
  if (!canView && !canCapture) requireTokenPermission(actor, "agenda:leads_view");
  const all = sponsorLeadReadEvidence(actor, "agenda:leads_view", "sponsor.id");
  const mine = sponsorLeadReadEvidence(actor, "agenda:leads_capture", "sponsor.id");
  const row = await first<{ scope: LeadReadScope | null }>(
    db,
    `SELECT CASE WHEN (${all.sql}) THEN 'all' WHEN (${mine.sql}) THEN 'mine' END AS scope
     FROM events scoped_event JOIN sponsorships sponsor ON sponsor.id=?
     WHERE scoped_event.id=? AND ${activeLeadSponsorOfEventSql("sponsor", "scoped_event.id")}`,
    [...all.bindings, ...mine.bindings, sponsorId, eventId],
  );
  if (!row) throw new AppError(404, "LEAD_SPONSOR_NOT_FOUND", "Active sponsorship not found in this event.");
  if (!row.scope)
    throw new AppError(403, "LEAD_VIEW_SCOPE_REQUIRED", "An active sponsor-specific lead relationship is required.");
  return row.scope;
}

/** Page and count recheck authorization and current consent in the same native D1 batch. */
export async function listSponsorLeads(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  actor: UserBackedAuthAdmin,
  query: SponsorLeadQuery,
  leadId?: string,
) {
  const operatorUserId = actor.id;
  const readScope = await resolveSponsorLeadReadScope(db, eventId, sponsorId, actor);
  await assertEventContactAccess(db, eventId);
  const permission = readScope === "all" ? "agenda:leads_view" : "agenda:leads_capture";
  const { sql: scope, bindings: scopeValues } = sponsorLeadReadEvidence(actor, permission, "sponsor.id");
  const ownCaptures =
    readScope === "mine"
      ? `JOIN (SELECT user_id,MAX(observed_at) AS captured_at FROM event_scan_attempts
          WHERE event_id=? AND sponsor_id=? AND operator_user_id=? AND action='lead' AND outcome='eligible'
          GROUP BY user_id) own ON own.user_id=lead.user_id`
      : "";
  const capturedAt = readScope === "mine" ? "own.captured_at" : activeSponsorLeadOriginSql("lead", "observed_at");
  const capturerId = readScope === "mine" ? "?" : activeSponsorLeadOriginSql("lead", "operator_user_id");
  const ownBindings = readScope === "mine" ? [eventId, sponsorId, operatorUserId, operatorUserId] : [];
  const name = "TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,''))";
  const organization = registrationOrganizationSql("reg");
  const search = query.q ? buildD1TextSearchFilter(query.q, [name, "u.email", organization]) : null;
  const { rows, total } = await queryPage<SponsorLead>(db, {
    source: {
      selectSql: `SELECT lead.id,${name} AS name,u.email,${organization} AS organization,
        ${registrationJobTitleSql("reg")} AS title,
        ${capturedAt} AS capturedAt,
        COALESCE((SELECT sponsor_org.name FROM organizations sponsor_org WHERE sponsor_org.id=sponsor.organization_id),sponsor.non_member_name,sponsor.contact_name,'Unspecified sponsor') AS sponsorName,
        TRIM(COALESCE(capturer.first_name,'') || ' ' || COALESCE(capturer.last_name,'')) AS operatorName,
        lead.note AS note`,
      fromSql: `FROM event_sponsor_leads lead ${ownCaptures} JOIN users u ON u.id=lead.user_id
        JOIN users capturer ON capturer.id=${capturerId}
        JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
        JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id
        WHERE lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND u.active=1
        AND ${activeLeadSponsorOfEventSql("sponsor", "lead.event_id")}
        AND ${sponsorConsentSql("reg")} AND (${scope}) AND ${eventContactAccessSql("lead.event_id")}
        ${leadId ? "AND lead.id=?" : ""} ${search ? `AND ${search.sql}` : ""}`,
      bindings: [
        ...ownBindings,
        eventId,
        sponsorId,
        ...scopeValues,
        ...(leadId ? [leadId] : []),
        ...(search?.bindings ?? []),
      ],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name, email: "u.email", organization, capturedAt },
      `${capturedAt} DESC`,
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

/** Detail uses the same live consent and operator scope as the collection. */
export async function getSponsorLead(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  actor: UserBackedAuthAdmin,
) {
  const result = await listSponsorLeads(db, eventId, sponsorId, actor, { limit: 1, offset: 0 }, leadId);
  const lead = result.leads[0];
  if (!lead) throw new AppError(404, "LEAD_NOT_FOUND", "Current consenting lead not found.");
  return sponsorLeadDetailSchema.parse({ lead, sponsorName: lead.sponsorName });
}

/** Discover only sponsor grants the signed-in operator can actually exercise. */
export async function listLeadSponsors(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: SponsorLeadSponsorsQuery,
) {
  const name = "COALESCE(org.name,sponsor.non_member_name,sponsor.contact_name,'Unspecified sponsor')";
  const search = query.q ? buildD1TextSearchFilter(query.q, [name]) : null;
  const permissions = ["agenda:leads_view", "agenda:leads_capture", "agenda:leads_export"] as const;
  const authority = permissions.map((permission) => sponsorLeadReadEvidence(actor, permission, "sponsor.id"));
  const expressions = authority.map(({ sql }) => sql);
  const values = authority.flatMap(({ bindings }) => bindings);
  const canRemoveAll = actor.scopeRestricted ? "0" : sponsorLeadViewerPredicateSql("?", "sponsor");
  const removeBindings = canRemoveAll === "0" ? [] : [actor.id];
  const { rows, total } = await queryPage<{
    id: string;
    name: string;
    canView: number;
    canCapture: number;
    canExport: number;
    canRemoveAll: number;
  }>(db, {
    source: {
      selectSql: `SELECT sponsor.id,${name} AS name,
        (${expressions[0]}) AS canView,(${expressions[1]}) AS canCapture,(${expressions[2]}) AS canExport,
        (${canRemoveAll}) AS canRemoveAll`,
      fromSql: `FROM events scoped_event
        JOIN sponsorships sponsor ON ${activeLeadSponsorOfEventSql("sponsor", "scoped_event.id")}
        LEFT JOIN organizations org ON org.id=sponsor.organization_id
        WHERE scoped_event.id=?
        ${query.sponsorId ? "AND sponsor.id=?" : ""}
        AND (${expressions.map((expression) => `(${expression})`).join(" OR ")}) ${search ? `AND ${search.sql}` : ""}`,
      bindings: [
        ...values,
        ...removeBindings,
        eventId,
        ...(query.sponsorId ? [query.sponsorId] : []),
        ...values,
        ...(search?.bindings ?? []),
      ],
      countBindings: [eventId, ...(query.sponsorId ? [query.sponsorId] : []), ...values, ...(search?.bindings ?? [])],
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
      canRemoveAll: !!row.canRemoveAll,
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
  actor: UserBackedAuthAdmin,
  query: SponsorLeadCapturesQuery,
) {
  const operatorUserId = actor.id;
  const readScope = await resolveSponsorLeadReadScope(db, eventId, sponsorId, actor);
  await assertEventContactAccess(db, eventId);
  const permission = readScope === "all" ? "agenda:leads_view" : "agenda:leads_capture";
  const { sql: scope, bindings: scopeValues } = sponsorLeadReadEvidence(actor, permission, "sponsor.id");
  const ownOnly = readScope === "mine" ? "AND attempt.operator_user_id=?" : "";
  const source = `FROM event_scan_attempts attempt
    JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
    JOIN users attendee ON attendee.id=lead.user_id JOIN users operator ON operator.id=attempt.operator_user_id
    JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
    JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id
    WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND attendee.active=1
    AND ${activeLeadSponsorOfEventSql("sponsor", "lead.event_id")} AND ${sponsorConsentSql("reg")}
    AND (${scope}) AND ${eventContactAccessSql("lead.event_id")}
    AND attempt.action='lead' AND attempt.outcome='eligible' ${ownOnly}`;
  const sourceBindings = [
    leadId,
    eventId,
    sponsorId,
    ...scopeValues,
    ...(readScope === "mine" ? [operatorUserId] : []),
  ];
  // Unknown, withdrawn, and another operator's lead expose no history.
  if (!(await first(db, `SELECT attempt.id ${source} LIMIT 1`, sourceBindings)))
    throw new AppError(404, "LEAD_NOT_FOUND", "Current consenting lead not found.");
  const name = "TRIM(COALESCE(operator.first_name,'') || ' ' || COALESCE(operator.last_name,''))";
  const search = query.q ? buildD1TextSearchFilter(query.q, [name]) : null;
  const { rows, total } = await queryPage<SponsorLeadCapture>(db, {
    source: {
      selectSql: `SELECT attempt.id,${name} AS operatorName,attempt.observed_at AS observedAt,attempt.created_at AS receivedAt`,
      fromSql: `${source} ${search ? `AND ${search.sql}` : ""}`,
      bindings: [...sourceBindings, ...(search?.bindings ?? [])],
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
