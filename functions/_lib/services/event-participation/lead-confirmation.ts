import { sponsorLeadConfirmationSchema } from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { prepareUserBackedAdminFromRequest, requireUserBackedAdminFromRequest } from "../../auth/admin";
import { requirePermission } from "../../auth/permissions";
import { batchFirst } from "../../db/pagination";
import { getEventBySlug } from "../events";
import { registrationJobTitleSql, registrationOrganizationSql } from "../registrations/selected-identity";
import { eventContactAccessSql } from "./evidence-retention";
import { sponsorLeadPermissionBindings, sponsorLeadPermissionSql } from "./lead-scope";
import { activeLeadSponsorOfEventSql } from "../../auth/sponsor-organization-lead-access";

type LeadConfirmationRow = {
  leadId: string;
  name: string | null;
  title: string | null;
  organization: string | null;
  note: string | null;
};

/** Resolves only a successful capture by this operator; no attendee or badge lookup accepts a search term. */
function prepareSponsorLeadConfirmation(
  db: DatabaseLike,
  eventSlug: string,
  sponsorId: string,
  operatorUserId: string,
  operationId: string,
) {
  return db
    .prepare(`SELECT lead.id AS leadId,lead.note AS note,
      NULLIF(TRIM(COALESCE(person.first_name,'') || ' ' || COALESCE(person.last_name,'')),'') AS name,
      NULLIF(TRIM(${registrationJobTitleSql("reg")}), '') AS title,
      NULLIF(TRIM(${registrationOrganizationSql("reg")}), '') AS organization
    FROM event_scan_attempts attempt
    JOIN events event ON event.id=attempt.event_id AND event.slug=?
    JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
    JOIN sponsorships sponsor ON sponsor.id=attempt.sponsor_id
    JOIN registrations reg ON reg.event_id=attempt.event_id AND reg.user_id=attempt.user_id
    JOIN users person ON person.id=attempt.user_id
    WHERE attempt.sponsor_id=? AND attempt.operator_user_id=? AND attempt.operation_id=?
      AND attempt.action='lead' AND attempt.outcome='eligible' AND reg.status='registered'
      AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
      AND ${activeLeadSponsorOfEventSql("sponsor", "attempt.event_id", "read")}
      AND ${eventContactAccessSql("attempt.event_id")}
      AND (${sponsorLeadPermissionSql("agenda:leads_capture", "sponsor.id")})`)
    .bind(
      eventSlug,
      sponsorId,
      operatorUserId,
      operationId,
      ...sponsorLeadPermissionBindings("agenda:leads_capture", operatorUserId),
    );
}

function decodeSponsorLeadConfirmation(row: LeadConfirmationRow | null) {
  if (!row) throw new AppError(404, "LEAD_CONFIRMATION_NOT_FOUND", "A confirmed lead is unavailable for this scan.");
  return sponsorLeadConfirmationSchema.parse(row);
}

async function readSponsorLeadConfirmation(
  db: DatabaseLike,
  eventSlug: string,
  sponsorId: string,
  operatorUserId: string,
  operationId: string,
) {
  const row = await prepareSponsorLeadConfirmation(
    db,
    eventSlug,
    sponsorId,
    operatorUserId,
    operationId,
  ).first<LeadConfirmationRow>();
  return decodeSponsorLeadConfirmation(row);
}

/** Compose live operator authority with this exact confirmation in one D1 batch for human sessions. */
export async function readSponsorLeadConfirmationForRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  sponsorId: string,
  operationId: string,
) {
  const prepared = await prepareUserBackedAdminFromRequest(db, request, env);
  if (!prepared) {
    const actor = await requireUserBackedAdminFromRequest(db, request, env);
    await getEventBySlug(db, eventSlug);
    requirePermission(actor, "agenda:leads_capture", { type: "event_sponsor", id: sponsorId });
    return readSponsorLeadConfirmation(db, eventSlug, sponsorId, actor.id, operationId);
  }
  const statement = prepareSponsorLeadConfirmation(db, eventSlug, sponsorId, prepared.subjectId, operationId);
  const results = await db.batch([...prepared.statements, statement]);
  const actor = await prepared.decode(results.slice(0, prepared.statements.length));
  requirePermission(actor, "agenda:leads_capture", { type: "event_sponsor", id: sponsorId });
  return decodeSponsorLeadConfirmation(batchFirst<LeadConfirmationRow>(results[prepared.statements.length]));
}
