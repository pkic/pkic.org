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
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
/** Eligibility shared by attendee selection and the all-matching print population. */
export function badgeAttendeeEligibilitySql(registrationAlias: string, userAlias: string): string {
  return `${registrationAlias}.status='registered' AND ${userAlias}.active=1`;
}
export async function badgeAttendees(db: DatabaseLike, eventId: string, raw: unknown) {
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
  const from = `FROM registrations reg JOIN users u ON u.id=reg.user_id WHERE reg.event_id=? AND ${badgeAttendeeEligibilitySql("reg", "u")} ${searchSql ? `AND ${searchSql}` : ""}`;
  const bindings = [eventId, ...(search?.bindings ?? []), ...(badgeHash && search ? [badgeHash] : [])];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from}`, bindings);
  const users = await all<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT u.id,u.email,u.first_name,u.last_name,${registrationOrganizationSql("reg")} AS organization_name, ${registrationJobTitleSql("reg")} AS job_title, u.headshot_r2_key ${from} ORDER BY u.email ${query.sort === "-email" ? "DESC" : "ASC"},u.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return badgeAttendeesResponseSchema.parse({
    users: users.map(({ headshot_r2_key, ...user }) => ({
      ...user,
      headshotUrl: publicUserHeadshotPath(user.id, headshot_r2_key),
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, users.length),
  });
}
