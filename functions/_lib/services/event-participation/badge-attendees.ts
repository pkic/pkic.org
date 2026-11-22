import { badgeCredentialSchema } from "../../../../assets/shared/schemas/badge-credential";
import { hashBadgeCredential } from "./badge-hash";
import { buildD1TextSearchFilter } from "../../db/search";
import { publicUserHeadshotPath } from "../user-headshot";
import { registrationJobTitleSql, registrationOrganizationSql } from "../registrations/selected-identity";
import {
  badgeAttendeeQuerySchema,
  badgeAttendeesResponseSchema,
} from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { scannerAttendeesResponseSchema } from "../../../../assets/shared/schemas/event-scanner-lookup";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { eventContactAccessSql } from "./evidence-retention";
import type { D1StatementResult } from "../../types";
import type { DatabaseLike } from "../../types";
import { ticketPaymentNeedsReviewSql } from "../event-tickets/payment-review";
/**
 * A registration's ticket is settled when it holds none, or one that is free
 * or paid. One that awaits payment, or was refunded or canceled, admits nobody.
 */
export function registrationTicketSettledSql(registrationAlias: string): string {
  return `NOT EXISTS(SELECT 1 FROM registration_tickets unsettled WHERE unsettled.registration_id=${registrationAlias}.id
    AND (unsettled.status NOT IN ('free','paid') OR
         (unsettled.payment_intent_id IS NOT NULL AND ${ticketPaymentNeedsReviewSql("unsettled.payment_intent_id")})))`;
}
/** Eligibility shared by attendee selection and the all-matching print population. */
export function badgeAttendeeEligibilitySql(registrationAlias: string, userAlias: string): string {
  return `${registrationAlias}.status='registered' AND ${userAlias}.active=1 AND ${registrationTicketSettledSql(registrationAlias)}`;
}
export async function badgeAttendees(db: DatabaseLike, eventId: string, raw: unknown) {
  const read = await prepareBadgeAttendees(db, eventId, raw);
  return read.decode(await db.batch(read.statements));
}

/**
 * Who a search matches: the attendees a badge is printed for, or, at the scanner desk, every registration with
 * its status.
 */
type BadgeAttendeePopulation = "badge_eligible" | "all_registrations";

/** Reuse this bounded projection in a complete authorized request batch. */
export async function prepareBadgeAttendees(
  db: DatabaseLike,
  event: EventReadSelection,
  raw: unknown,
  population: BadgeAttendeePopulation = "badge_eligible",
) {
  const scope = eventReadIdSql(event);
  const query = badgeAttendeeQuerySchema.parse(raw);
  const name = "TRIM(COALESCE(u.preferred_name,u.first_name,'') || ' ' || COALESCE(u.last_name,''))";
  const search = query.q?.trim()
    ? buildD1TextSearchFilter(query.q, [name, "u.email", registrationOrganizationSql("reg")])
    : null;
  const parsedBadge = badgeCredentialSchema.safeParse(query.q);
  const badgeHash = parsedBadge.success ? await hashBadgeCredential(parsedBadge.data) : null;
  const searchSql = search
    ? badgeHash
      ? `(${search.sql} OR EXISTS(SELECT 1 FROM event_badge_credentials badge WHERE badge.event_id=reg.event_id AND badge.user_id=u.id AND badge.credential_hash=? AND badge.revoked_at IS NULL AND badge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
      : search.sql
    : "";
  const from = `FROM registrations reg JOIN users u ON u.id=reg.user_id
    WHERE reg.event_id=${scope.sql} AND ${eventContactAccessSql("reg.event_id")}
    AND ${population === "badge_eligible" ? badgeAttendeeEligibilitySql("reg", "u") : "u.active=1"}
    ${searchSql ? `AND ${searchSql}` : ""}`;
  const bindings = [...scope.bindings, ...(search?.bindings ?? []), ...(badgeHash && search ? [badgeHash] : [])];
  const statements = buildOffsetPageStatements(db, {
    source: {
      selectSql: `SELECT u.id,u.email,u.first_name,u.last_name,${registrationOrganizationSql("reg")} AS organization_name,${registrationJobTitleSql("reg")} AS job_title,u.headshot_r2_key,reg.status AS registration_status`,
      fromSql: from,
      bindings,
    },
    orderBy: `ORDER BY u.email ${query.sort === "-email" ? "DESC" : "ASC"},u.id`,
    limit: query.limit,
    offset: query.offset,
  });
  return {
    statements,
    decode(results: D1StatementResult[]) {
      const { rows: users, total } = decodeOffsetPageResults<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        organization_name: string | null;
        job_title: string | null;
        headshot_r2_key: string | null;
        registration_status: string;
      }>(results[0]!, results[1]!);
      const page = buildPageInfo(query.limit, query.offset, total, users.length);
      const items = users.map(({ headshot_r2_key, registration_status, ...user }) => ({
        ...user,
        headshotUrl: publicUserHeadshotPath(user.id, headshot_r2_key),
        registrationStatus: registration_status,
      }));
      if (population === "all_registrations") return scannerAttendeesResponseSchema.parse({ users: items, page });
      return badgeAttendeesResponseSchema.parse({
        users: items.map(({ registrationStatus: _status, ...user }) => user),
        page,
      });
    },
  };
}
