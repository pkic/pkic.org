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
  const from = `FROM registrations reg JOIN users u ON u.id=reg.user_id WHERE reg.event_id=? AND ${badgeAttendeeEligibilitySql("reg", "u")} AND INSTR(LOWER(COALESCE(u.email,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0`;
  const bindings = [eventId, query.q ?? ""];
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
