import { createHash } from "node:crypto";
import { instantToCalendarDate } from "../../../assets/shared/timezone.ts";
import { BADGE_CREDENTIAL_ALPHABET, BADGE_CREDENTIAL_LENGTH } from "../../../assets/shared/schemas/badge-credential.ts";
import { previewScaleId } from "../seed-ids.mjs";
import { inventJobTitle, inventOrganization, inventPerson, pick, seededStream, weighted } from "./random.mjs";
import { inventBiography } from "./text.mjs";

/**
 * Production's aggregate shape, measured from counts only (no rows): per event
 * day roughly a third attend in person, two fifths online, a quarter on demand;
 * 6% of registrations are cancelled; nine in ten registrations hold a badge;
 * about four saved sessions per five registrations, 85% of them in person.
 */
export const PRODUCTION_SHAPE = {
  attendance: { in_person: 32, virtual: 42, on_demand: 25, livestream_lounge: 1 },
  cancelledShare: 0.06,
  badgeShare: 0.9,
  organizationIdentityShare: 0.6,
  registrationIdentityShare: 0.15,
  organizations: 900,
  savedSessionsPerRegistration: 0.8,
  speakerHeadshotShare: 0.9,
};

const SEEDED_FROM = Date.parse("2026-09-01T00:00:00.000Z");
const SEEDED_SPAN_MS = 80 * 24 * 60 * 60 * 1000;

/** A fixed instant inside the registration window, so re-runs write identical rows. */
function seededInstant(random) {
  return new Date(SEEDED_FROM + Math.floor(random() * SEEDED_SPAN_MS)).toISOString();
}

/** The typed badge code for a seeded badge; the scanner accepts it in place of the QR code. */
export function seededBadgeCredential(key) {
  const bytes = createHash("sha256").update(`pkic-preview-scale-badge:${key}`).digest();
  return Array.from(bytes.subarray(0, BADGE_CREDENTIAL_LENGTH), (value) => BADGE_CREDENTIAL_ALPHABET[value & 31]).join(
    "",
  );
}

export function badgeCredentialHash(credential) {
  return createHash("sha256").update(credential).digest("hex");
}

function badgeFor(eventId, personKey) {
  const code = seededBadgeCredential(`${eventId}:${personKey}`);
  return { id: previewScaleId(`${eventId}:badge:${personKey}`), code, credentialHash: badgeCredentialHash(code) };
}

/**
 * Each person draws from a stream of their own, so their name, organization,
 * registration and badge never depend on how many others are seeded.
 */
function inventPeople(seed, prefix, count, organizations) {
  return Array.from({ length: count }, (_, index) => {
    const key = `${prefix}:${index + 1}`;
    const random = seededStream(seed, key);
    const instant = () => seededInstant(random);
    const person = inventPerson(random, `${prefix}${index + 1}`);
    const userId = previewScaleId(`user:${key}`);
    const createdAt = instant();
    const organization =
      random() < PRODUCTION_SHAPE.organizationIdentityShare ? pick(random, organizations) : null;
    return {
      key,
      random,
      userId,
      ...person,
      createdAt,
      individualIdentityId: previewScaleId(`identity:${key}:individual`),
      organizationIdentity: organization
        ? { id: previewScaleId(`identity:${key}:organization`), organizationId: organization.id, organizationName: organization.name, jobTitle: inventJobTitle(random) }
        : null,
    };
  });
}

/**
 * The synthetic people and their event records, as plain rows.
 * The organization list has a fixed size, so it is the same at any volume.
 * People and organizations are shared by every seeded event; registrations,
 * attendance and badges are keyed by the event, so several events can be seeded
 * on one database.
 * Names an unrelated organization on the database already holds are skipped,
 * since organization names are unique.
 * @param {{ attendees: number, speakers: number, seed: number, eventId: string, days: Array<{id:string,date:string}>, existingOrganizations?: Array<{id:string,name:string}> }} options
 */
export function buildPopulation({ attendees, speakers, seed, eventId, days, existingOrganizations = [] }) {
  const organizationStream = seededStream(seed, "organizations");
  const ids = Array.from({ length: PRODUCTION_SHAPE.organizations }, (_, index) => previewScaleId(`organization:${index + 1}`));
  const seededIds = new Set(ids);
  const takenNames = new Set(
    existingOrganizations.filter((organization) => !seededIds.has(organization.id)).map((organization) => organization.name.toLowerCase()),
  );
  const organizations = ids.map((id) => ({
    id,
    name: inventOrganization(organizationStream, takenNames),
    createdAt: seededInstant(organizationStream),
  }));
  const speakerPeople = inventPeople(seed, "speaker", speakers, organizations).map(({ random, ...person }) => ({
    ...person,
    biography: inventBiography(random, person),
    hasHeadshot: random() < PRODUCTION_SHAPE.speakerHeadshotShare,
  }));
  const attendeeStreams = inventPeople(seed, "attendee", attendees, organizations);
  const attendeePeople = attendeeStreams.map(({ random: _stream, ...person }) => person);
  const registrations = attendeePeople.map((person) => {
    const random = seededStream(seed, `${eventId}:${person.key}`);
    const cancelled = random() < PRODUCTION_SHAPE.cancelledShare;
    const registeredAt = person.createdAt;
    return {
      id: previewScaleId(`${eventId}:registration:${person.key}`),
      userId: person.userId,
      status: cancelled ? "cancelled" : "registered",
      identityId:
        person.organizationIdentity && random() < PRODUCTION_SHAPE.registrationIdentityShare / PRODUCTION_SHAPE.organizationIdentityShare
          ? person.organizationIdentity.id
          : null,
      createdAt: registeredAt,
      cancelledAt: cancelled ? registeredAt : null,
      days: days.map((day) => ({
        id: previewScaleId(`${eventId}:attendance:${person.key}:${day.date}`),
        dayId: day.id,
        dayDate: day.date,
        type: weighted(random, PRODUCTION_SHAPE.attendance),
      })),
      badge:
        random() < PRODUCTION_SHAPE.badgeShare
          ? badgeFor(eventId, person.key)
          : null,
    };
  });
  return { organizations, speakers: speakerPeople, attendees: attendeePeople, registrations };
}

/** Saved sessions: about one per registration, in person when the attendee is there that day (the event's own calendar day). */
export function buildSavedSessions({ registrations, sessions, seed, timeZone }) {
  const bookable = sessions.filter((session) => session.kind !== "break");
  const saved = [];
  for (const registration of registrations) {
    if (registration.status !== "registered") continue;
    const random = seededStream(seed, `saved:${registration.id}`);
    const count = Math.floor(random() * PRODUCTION_SHAPE.savedSessionsPerRegistration * 2 + 0.5);
    const chosen = new Set();
    for (let index = 0; index < count; index += 1) chosen.add(pick(random, bookable));
    for (const session of chosen) {
      const dayDate = instantToCalendarDate(session.startAt, timeZone);
      const attendance = registration.days.find((day) => day.dayDate === dayDate);
      saved.push({
        id: previewScaleId(`saved:${registration.id}:${session.id}`),
        occurrenceId: session.id,
        userId: registration.userId,
        attendanceMode: attendance?.type === "in_person" ? "physical" : "remote",
        dayDate,
        createdAt: registration.createdAt,
      });
    }
  }
  return saved;
}

const SPONSOR_TIERS = ["Leader", "Leader", "Inspirator", "Inspirator", "Inspirator", "Innovator", "Innovator", "Innovator", "Ambassador", "Ambassador", "Ambassador", "Ambassador"];

/** Twelve active event sponsorships drawn from the synthetic organizations. */
export function buildSponsorships(organizations, eventId) {
  return SPONSOR_TIERS.map((tier, index) => ({
    id: previewScaleId(`${eventId}:sponsorship:${index + 1}`),
    organizationId: organizations[index].id,
    tier,
  }));
}
