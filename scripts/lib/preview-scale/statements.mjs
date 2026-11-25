import { sqlString, NOW } from "../sql.mjs";
import { individualIdentityFallbackSql } from "../individual-identity-sql.mjs";
import { insertStatements, rawSql } from "./sql.mjs";
import { TEAM_ORGANIZATION_NAMES_SQL } from "./personas.mjs";
import { sponsorLeadStatements } from "./leads.mjs";

/**
 * A fixed approval instant after every seeded profile change (the population's
 * instants end on 2026-11-20), so the speaker profile review counts as current
 * and a re-run writes the same history.
 */
const APPROVED_AT = "2026-11-21T00:00:00.000Z";
const NEW_SECRET = rawSql("lower(hex(randomblob(32)))");
const now = rawSql(NOW);

export function headshotKey(userId) {
  return `headshots/${userId}/preview-scale.webp`;
}

function headshotUrl(userId) {
  return `/api/v1/users/${userId}/headshots/preview-scale.webp`;
}

function peopleStatements(people) {
  const users = people.map((person) => [
    person.userId,
    person.email,
    person.email,
    person.firstName,
    person.lastName,
    1,
    person.hasHeadshot ? headshotKey(person.userId) : null,
    person.hasHeadshot ? person.createdAt : null,
    person.createdAt,
    "registration_confirmation",
    person.createdAt,
    person.createdAt,
  ]);
  // The organization identity is the default when there is one; otherwise the individual one.
  const identity = (id, person, organization, biography, isDefault) => [
    id,
    person.userId,
    organization?.organizationId ?? null,
    organization?.jobTitle ?? null,
    biography,
    "migration",
    organization ? 1 : 0,
    isDefault ? 1 : 0,
    person.createdAt,
    person.createdAt,
    person.createdAt,
    person.createdAt,
  ];
  const identities = people.flatMap((person) => [
    identity(person.individualIdentityId, person, null, person.organizationIdentity ? null : (person.biography ?? null), !person.organizationIdentity),
    ...(person.organizationIdentity
      ? [identity(person.organizationIdentity.id, person, person.organizationIdentity, person.biography ?? null, true)]
      : []),
  ]);
  return [
    ...insertStatements(
      "users",
      ["id", "email", "normalized_email", "first_name", "last_name", "active", "headshot_r2_key", "headshot_updated_at", "email_verified_at", "email_verification_method", "created_at", "updated_at"],
      users,
      // The seed owns its users' headshots, so a re-run with or without uploads keeps them in step.
      "ON CONFLICT(id) DO UPDATE SET headshot_r2_key = excluded.headshot_r2_key, headshot_updated_at = excluded.headshot_updated_at",
    ),
    ...insertStatements(
      "identities",
      ["id", "user_id", "organization_id", "job_title", "biography", "source", "show_on_organization_profile", "is_default", "invited_at", "started_at", "created_at", "updated_at"],
      identities,
    ),
  ];
}

function registrationStatements(context, registrations) {
  const registered = registrations.filter((registration) => registration.status === "registered");
  return [
    ...insertStatements(
      "registrations",
      ["id", "event_id", "user_id", "status", "source_type", "manage_link_secret", "confirmed_at", "cancelled_at", "registration_identity_id", "created_at", "updated_at"],
      registrations.map((registration) => [
        registration.id,
        context.eventId,
        registration.userId,
        registration.status,
        "preview_scale_seed",
        NEW_SECRET,
        registration.createdAt,
        registration.cancelledAt,
        registration.identityId,
        registration.createdAt,
        registration.createdAt,
      ]),
    ),
    ...insertStatements(
      "registration_day_attendance",
      ["id", "registration_id", "event_day_id", "attendance_type", "created_at", "updated_at"],
      registered.flatMap((registration) =>
        registration.days.map((day) => [day.id, registration.id, day.dayId, day.type, registration.createdAt, registration.createdAt]),
      ),
    ),
    ...insertStatements(
      "event_badge_credentials",
      ["id", "event_id", "user_id", "credential_hash", "created_at", "expires_at"],
      registered
        .filter((registration) => registration.badge)
        .map((registration) => [registration.badge.id, context.eventId, registration.userId, registration.badge.credentialHash, registration.createdAt, context.eventEndsAt]),
    ),
  ];
}

function appearance(person) {
  const organization = person.organizationIdentity;
  return {
    userId: person.userId,
    displayName: `${person.firstName} ${person.lastName}`,
    affiliations: [
      organization
        ? { identityId: organization.id, title: organization.jobTitle, organizationId: organization.organizationId, organizationName: organization.organizationName }
        : { identityId: person.individualIdentityId, title: null, organizationId: null, organizationName: null },
    ],
    biography: person.biography,
    photoUrl: person.hasHeadshot ? headshotUrl(person.userId) : null,
    links: [],
    approvedAt: APPROVED_AT,
  };
}

/** The session history the publish check reads: one approved appearance per speaker. */
export function sessionHistoryMetadata(session, speakersById) {
  return { appearances: session.speakerUserIds.map((userId) => appearance(speakersById.get(userId))) };
}

/**
 * Seeded sessions converge on the current plan: their content is overwritten
 * and their speakers replaced, so a re-run with another speaker count never
 * leaves extra or double-booked speakers behind.
 */
function agendaStatements(context, sessions, rooms, speakers) {
  const speakersById = new Map(speakers.map((speaker) => [speaker.userId, speaker]));
  const seededIds = sessions.map((session) => sqlString(session.id)).join(", ");
  const roomIds = rooms.map((room) => room.id);
  const unstaffed = sessions.filter((session) => session.speakerUserIds.length === 0).map((session) => sqlString(session.id));
  const roomOrder = [...roomIds, ...context.roomOrder.filter((id) => !roomIds.includes(id))];
  return [
    ...insertStatements(
      "event_agenda_rooms",
      ["id", "event_id", "name", "capacity"],
      rooms.filter((room) => !room.existing).map((room) => [room.id, context.eventId, room.name, room.capacity]),
    ),
    ...insertStatements(
      "event_agenda_occurrences",
      ["id", "event_id", "title", "description", "start_at", "end_at", "room_id", "kind", "track", "format", "visibility", "admission_policy"],
      sessions.map((session) => [session.id, context.eventId, session.title, session.description, session.startAt, session.endAt, session.roomId, session.kind, session.track, session.format, "public", "preference"]),
      `ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, start_at = excluded.start_at,
  end_at = excluded.end_at, room_id = excluded.room_id, kind = excluded.kind, track = excluded.track, format = excluded.format,
  visibility = excluded.visibility`,
    ),
    `DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id IN (${seededIds});`,
    // A seeded session left without speakers keeps no appearances from an earlier run.
    ...(unstaffed.length ? [`DELETE FROM event_agenda_session_history WHERE occurrence_id IN (${unstaffed.join(", ")});`] : []),
    ...insertStatements(
      "event_agenda_occurrence_speakers",
      ["occurrence_id", "user_id", "role", "attendance_mode"],
      sessions.flatMap((session) => session.speakerUserIds.map((userId) => [session.id, userId, "speaker", "physical"])),
    ),
    ...insertStatements(
      "event_agenda_session_history",
      ["occurrence_id", "metadata_json", "updated_by", "updated_at"],
      sessions
        .filter((session) => session.speakerUserIds.length > 0)
        .map((session) => [session.id, JSON.stringify(sessionHistoryMetadata(session, speakersById)), context.actorUserId, APPROVED_AT]),
      "ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at",
    ),
    // The earlier preview program leaves the public agenda but keeps its history and scans.
    `UPDATE event_agenda_occurrences SET visibility = 'private' WHERE event_id = ${sqlString(context.eventId)} AND visibility <> 'private' AND id NOT IN (${seededIds});`,
    `UPDATE events SET settings_json = json_set(COALESCE(settings_json, '{}'), '$.agenda.roomOrder', json(${sqlString(JSON.stringify(roomOrder))})) WHERE id = ${sqlString(context.eventId)};`,
    // A draft newer than the published revision, so an organizer can publish it.
    `INSERT INTO event_agenda_state (event_id, revision, updated_at) VALUES (${sqlString(context.eventId)}, 1, ${NOW})
ON CONFLICT(event_id) DO UPDATE SET revision = MAX(revision, COALESCE(published_revision, 0) + 1), updated_at = excluded.updated_at;`,
  ];
}

function savedSessionStatements(context, saved) {
  return insertStatements(
    "agenda_session_participations",
    ["id", "event_id", "occurrence_id", "user_id", "attendance_mode", "status", "saved", "attendance_day_date", "created_at", "updated_at"],
    saved.map((row) => [row.id, context.eventId, row.occurrenceId, row.userId, row.attendanceMode, "saved", 1, row.dayDate, row.createdAt, row.createdAt]),
  );
}

function sponsorshipStatements(context, sponsorships) {
  return insertStatements(
    "sponsorships",
    ["id", "sponsor_type", "organization_id", "event_id", "tier", "pipeline_stage", "start_date", "created_at", "updated_at"],
    sponsorships.map((sponsorship) => [sponsorship.id, "event", sponsorship.organizationId, context.eventId, sponsorship.tier, "active", "2026-09-01", now, now]),
  );
}

/**
 * The persona's organization identity, so the first sign-in asks nothing: staff
 * personas at PKI Consortium, the sponsor persona at its sponsor. It becomes the
 * default unless the account already marks one.
 */
function organizationIdentitySql(persona, userIdSql) {
  const organizationSql = persona.sponsorship
    ? `SELECT ${sqlString(persona.sponsorship.organizationId)} AS id`
    : `SELECT id FROM organizations WHERE normalized_name IN ${TEAM_ORGANIZATION_NAMES_SQL} ORDER BY created_at, id LIMIT 1`;
  return `INSERT INTO identities (id, user_id, organization_id, job_title, source, show_on_organization_profile, is_default, invited_at, started_at, created_at, updated_at)
SELECT ${sqlString(persona.organizationIdentityId)}, person.id, organization.id, ${sqlString(persona.jobTitle)}, ${sqlString(persona.sponsorship ? "organization_contact" : "staff")}, 0,
  NOT EXISTS (SELECT 1 FROM identities marked WHERE marked.user_id = person.id AND marked.is_default = 1), ${NOW}, ${NOW}, ${NOW}, ${NOW}
FROM users person, (${organizationSql}) organization
WHERE person.id = ${userIdSql} AND NOT EXISTS (
  SELECT 1 FROM identities held WHERE held.user_id = person.id AND held.organization_id = organization.id
    AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL)
ON CONFLICT DO NOTHING;`;
}

/** Persona accounts resolve by address, so an account that already exists is reused. */
function personaStatements(context, personas) {
  return personas.flatMap((persona) => {
    const email = sqlString(persona.email);
    const userIdSql = `(SELECT id FROM users WHERE normalized_email = ${email})`;
    const statements = [
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, active, email_verified_at, email_verification_method, created_at, updated_at)
VALUES (${sqlString(persona.userId)}, ${email}, ${email}, ${sqlString(persona.firstName)}, ${sqlString(persona.lastName)}, 1, ${NOW}, 'magic_link', ${NOW}, ${NOW})
ON CONFLICT(normalized_email) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, updated_at = excluded.updated_at
WHERE users.first_name IS NOT excluded.first_name OR users.last_name IS NOT excluded.last_name;`,
      organizationIdentitySql(persona, userIdSql),
      individualIdentityFallbackSql(userIdSql, "staff").trim(),
      // An earlier run gave the account a personal identity; with two, every sign-in asks which to act as.
      `UPDATE identities SET ended_at = ${NOW}, updated_at = ${NOW}
WHERE user_id = ${userIdSql} AND organization_id IS NULL AND source = 'staff' AND ended_at IS NULL
  AND EXISTS (SELECT 1 FROM identities held WHERE held.user_id = identities.user_id AND held.organization_id IS NOT NULL
    AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL);`,
    ];
    if (persona.sponsorship)
      statements.push(`UPDATE sponsorships SET contact_email = ${email}, updated_at = ${NOW}
WHERE id = ${sqlString(persona.sponsorship.id)} AND contact_email IS NOT ${email};`);
    if (persona.roleId)
      statements.push(`INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
SELECT ${sqlString(persona.roleAssignmentId)}, person.id, role.id, 'event', ${sqlString(context.eventId)}, role.single_holder_per_context, ${NOW}
FROM users person JOIN roles role ON role.id = ${sqlString(persona.roleId)}
WHERE person.normalized_email = ${email} AND NOT EXISTS (
  SELECT 1 FROM user_roles held WHERE held.user_id = person.id AND held.role_id = role.id
    AND held.context_type = 'event' AND held.context_id = ${sqlString(context.eventId)} AND held.revoked_at IS NULL)
ON CONFLICT DO NOTHING;`);
    if (persona.registers)
      statements.push(
        `INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, confirmed_at, created_at, updated_at)
SELECT ${sqlString(persona.registrationId)}, ${sqlString(context.eventId)}, person.id, 'registered', 'preview_scale_seed', lower(hex(randomblob(32))), ${NOW}, ${NOW}, ${NOW}
FROM users person WHERE person.normalized_email = ${email}
ON CONFLICT DO NOTHING;`,
        `INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
SELECT lower(hex(randomblob(16))), registration.id, day.id, 'in_person', ${NOW}, ${NOW}
FROM registrations registration JOIN event_days day ON day.event_id = registration.event_id
WHERE registration.event_id = ${sqlString(context.eventId)} AND registration.user_id = ${userIdSql}
ON CONFLICT DO NOTHING;`,
      );
    return statements;
  });
}

/**
 * The complete, re-runnable seed for one event.
 * @param {{eventId:string, eventEndsAt:string, actorUserId:string, roomOrder:string[]}} context
 */
export function seedStatements(context, plan) {
  const people = [...plan.population.speakers, ...plan.population.attendees];
  return [
    ...insertStatements(
      "organizations",
      ["id", "name", "normalized_name", "created_at", "updated_at"],
      plan.population.organizations.map((organization) => [organization.id, organization.name, organization.name.toLowerCase(), organization.createdAt, organization.createdAt]),
    ),
    ...peopleStatements(people),
    ...registrationStatements(context, plan.population.registrations),
    ...agendaStatements(context, plan.sessions, plan.rooms, plan.population.speakers),
    ...savedSessionStatements(context, plan.saved),
    ...sponsorshipStatements(context, plan.sponsorships),
    ...personaStatements(context, plan.personas),
    ...sponsorLeadStatements(context, plan.leads),
  ];
}
