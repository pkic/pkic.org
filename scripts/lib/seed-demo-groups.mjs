import { NOW, RANDOM_ID, sqlString } from "./sql.mjs";
import { memberProfileId as stableId } from "./seed-ids.mjs";
/*
 * The groups the demo member sits in, created by this seed.
 *
 * The seed used to hang its seats, meetings and occurrences off the shipped
 * groups migration 0035 creates. That is how it came to write dozens of event
 * occurrences into the PQC group, which seven specs address by id and whose
 * event list portal-event-management asserts the contents of. Moving to a
 * different shipped group only moves the collision to whichever spec claims
 * that group next.
 *
 * So the seed owns its groups outright: it creates them, and everything it
 * writes hangs off one of them. A demo fixture adds no rows to a group it did
 * not create. Held and attended live beside the seat they belong to, so the
 * two can no longer be edited apart.
 */
export const DEMO_GROUPS = [
  {
    slug: "demo-cbom",
    name: "CBOM Profiles Working Group (demo)",
    type: "working_group",
    title: "Chair",
    held: 18,
    attended: 18,
  },
  {
    slug: "demo-cm",
    name: "Cryptographic Module Working Group (demo)",
    type: "working_group",
    title: "Delegate",
    held: 12,
    attended: 9,
  },
  {
    slug: "demo-council",
    name: "Executive Council (demo)",
    type: "board",
    title: null,
    held: 11,
    attended: 6,
  },
];

/**
 * The demo groups themselves.
 *
 * Neither roster nor leadership is public, so a fixture group never reaches a
 * public page; `participants` visibility keeps it to the people seated in it.
 */
export function demoGroupSql(group) {
  return `INSERT INTO groups
  (id, type_key, parent_group_id, name, slug, description, visibility,
   governance_inheritance_mode, eligibility_mode, automatic_enrollment_mode,
   allow_automatic_opt_out, public_leadership, public_roster,
   min_endorsers_for_ballot, active, created_at, updated_at)
VALUES (${sqlString(stableId(`group-${group.slug}`))}, ${sqlString(group.type)}, NULL,
        ${sqlString(group.name)}, ${sqlString(group.slug)},
        'Demo fixture group, seeded for the member record surface.',
        'participants', 'inherited', 'managed', 'none', 0, 0, 0, 0, 1, ${NOW}, ${NOW})
    ON CONFLICT(id) DO NOTHING;`;
}

/**
 * When the seeded seats began.
 *
 * A meeting counts as held only if it started on or after the day the person
 * joined the group — otherwise a new member would be charged for every call
 * held before they arrived. So the seat has to predate the oldest seeded
 * occurrence, which walks back one week at a time. Dated two years back, which
 * clears the longest seeded series with room to spare; a seat dated `now`
 * silently excludes every meeting and the record shows no attendance at all.
 */
const SEAT_JOINED_AT = "strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 years')";

export function seatSql(email, identityId, memberId, groupSlug, title) {
  return `INSERT INTO group_memberships
  (id, group_id, user_id, identity_id, member_id, source, title, joined_at, created_at, updated_at)
SELECT ${RANDOM_ID}, g.id, u.id, ${sqlString(identityId)}, ${sqlString(memberId)}, 'staff', ${sqlString(title)},
       ${SEAT_JOINED_AT}, ${SEAT_JOINED_AT}, ${NOW}
  FROM groups g JOIN users u ON u.email = ${sqlString(email)}
 WHERE g.slug = ${sqlString(groupSlug)}
   AND EXISTS (SELECT 1 FROM identities WHERE id = ${sqlString(identityId)})
   AND NOT EXISTS (
     SELECT 1 FROM group_memberships existing
      WHERE existing.group_id = g.id AND existing.user_id = u.id AND existing.left_at IS NULL
   );`;
}

/**
 * A group's meeting series and the occurrences behind an attendance rate.
 *
 * Every occurrence is dated into the past, and `SEAT_JOINED_AT` puts the seat
 * behind all of them, so each one counts as held.
 */
export function meetingsSql(groupSlug, index, held, attended, attendeeEmail) {
  const eventId = stableId(`event-${groupSlug}`);
  const seriesId = stableId(`series-${groupSlug}`);
  const statements = [
    `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json,
                     owner_group_id, visibility, created_at, updated_at)
SELECT ${sqlString(eventId)}, ${sqlString(`${groupSlug}-meetings`)}, g.name || ' meetings', 'UTC',
       'invite_or_open', 5, '{}', g.id, 'invitation_only', ${NOW}, ${NOW}
  FROM groups g WHERE g.slug = ${sqlString(groupSlug)}
   AND NOT EXISTS (SELECT 1 FROM events WHERE id = ${sqlString(eventId)});`,

    `INSERT INTO event_series (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes, active, created_at, updated_at)
SELECT ${sqlString(seriesId)}, ${sqlString(eventId)}, ${NOW}, 'FREQ=WEEKLY', 'UTC', 60, 1, ${NOW}, ${NOW}
 WHERE EXISTS (SELECT 1 FROM events WHERE id = ${sqlString(eventId)})
   AND NOT EXISTS (SELECT 1 FROM event_series WHERE id = ${sqlString(seriesId)});`,
  ];

  for (let n = 0; n < held; n += 1) {
    const occurrenceId = stableId(`occurrence-${groupSlug}-${String(n)}`);
    const joinId = stableId(`join-${groupSlug}-${String(n)}`);
    // Weekly, walking backwards from a week ago so every one is in the past.
    const daysAgo = 7 * (n + 1);
    statements.push(
      `INSERT INTO event_occurrences (id, series_id, starts_at, ends_at, status, created_at, updated_at)
SELECT ${sqlString(occurrenceId)}, ${sqlString(seriesId)},
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-${String(daysAgo)} days'),
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-${String(daysAgo)} days','+1 hour'),
       'scheduled', ${NOW}, ${NOW}
 WHERE EXISTS (SELECT 1 FROM event_series WHERE id = ${sqlString(seriesId)})
   AND NOT EXISTS (SELECT 1 FROM event_occurrences WHERE id = ${sqlString(occurrenceId)});`,
    );
    if (n < attended) {
      statements.push(
        `INSERT INTO event_occurrence_join_confirmations
  (id, occurrence_id, user_id, name_snapshot, join_count, confirmed_at, created_at, updated_at)
SELECT ${sqlString(joinId)}, ${sqlString(occurrenceId)}, u.id,
       'Seeded attendee', 1, ${NOW}, ${NOW}, ${NOW}
  FROM users u WHERE u.email = ${sqlString(attendeeEmail)}
   AND EXISTS (SELECT 1 FROM event_occurrences WHERE id = ${sqlString(occurrenceId)})
   AND NOT EXISTS (
     SELECT 1 FROM event_occurrence_join_confirmations WHERE id = ${sqlString(joinId)}
   );`,
      );
    }
  }
  return statements;
}

