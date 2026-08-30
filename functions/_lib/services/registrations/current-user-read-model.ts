/**
 * Identity-first participation feed: every registration matched to the
 * caller's own user id (see IMPLEMENTATION_TRACKER.md section 13). Mirrors
 * the shape of `event-series/member-read-model.ts`'s
 * `listUpcomingMeetingsForMember`.
 *
 * `registrations.user_id` is `NOT NULL` (find-or-create always resolves an
 * auto-provisioned user row before a registration is written — see
 * `attendee-registration.ts`) and `users.normalized_email` is globally
 * unique, so a distinct row can never exist under a different user id for
 * the same email. Matching on `user_id` alone is therefore complete; there
 * is no email-fallback branch to write, unlike `donations` below. This
 * mirrors `events/visibility.ts`'s `buildEventAudiencePredicate`, which
 * matches `registrations` the same way.
 */
import {
  currentUserRegistrationSchema,
  type CurrentUserRegistration,
  type CurrentUserRegistrationsListQuery,
} from "../../../../assets/shared/schemas/current-user-registrations";
import type { OffsetPageQuery } from "../../db/pagination";
import { queryPage } from "../../db/pagination";
import type { DatabaseLike } from "../../types";

interface CurrentUserRegistrationRow {
  id: string;
  status: string;
  attendance_type: string;
  created_at: string;
  waitlisted: number;
  event_id: string;
  event_slug: string;
  event_name: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_timezone: string;
}

function toCurrentUserRegistration(row: CurrentUserRegistrationRow): CurrentUserRegistration {
  return currentUserRegistrationSchema.parse({
    id: row.id,
    event: {
      id: row.event_id,
      slug: row.event_slug,
      name: row.event_name,
      startsAt: row.event_starts_at,
      endsAt: row.event_ends_at,
      timezone: row.event_timezone,
    },
    status: row.status,
    attendanceType: row.attendance_type,
    waitlisted: Boolean(row.waitlisted),
    createdAt: row.created_at,
  });
}

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildCurrentUserRegistrationsPageQuery(
  userId: string,
  query: CurrentUserRegistrationsListQuery,
): OffsetPageQuery {
  const conditions = ["r.user_id = ?"];
  const bindings: unknown[] = [userId];
  if (query.from) {
    conditions.push("e.starts_at >= ?");
    bindings.push(query.from);
  }
  if (query.to) {
    conditions.push("e.starts_at <= ?");
    bindings.push(query.to);
  }
  return {
    sql: `SELECT r.id AS id, r.status AS status, r.attendance_type AS attendance_type, r.created_at AS created_at,
            e.id AS event_id, e.slug AS event_slug, e.name AS event_name,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.timezone AS event_timezone,
            EXISTS (
              SELECT 1 FROM event_day_waitlist_entries w
               WHERE w.registration_id = r.id
                 AND w.status IN ('waiting', 'offered', 'accepted')
            ) AS waitlisted
          FROM registrations r
          JOIN events e ON e.id = r.event_id
          WHERE ${conditions.join(" AND ")}`,
    bindings,
    // events.starts_at is nullable; SQLite sorts NULLs first in ASC order,
    // which surfaces dateless events ahead of scheduled ones. Acceptable —
    // every event a registration can exist for has been at least drafted.
    orderBy: "ORDER BY e.starts_at ASC, r.id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listCurrentUserRegistrations(
  db: DatabaseLike,
  userId: string,
  query: CurrentUserRegistrationsListQuery,
): Promise<{ registrations: CurrentUserRegistration[]; total: number }> {
  const { rows, total } = await queryPage<CurrentUserRegistrationRow>(
    db,
    buildCurrentUserRegistrationsPageQuery(userId, query),
  );
  return { registrations: rows.map(toCurrentUserRegistration), total };
}
