import { createHash } from "node:crypto";
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
 * @param {{ attendees: number, speakers: number, seed: number, days: Array<{id:string,date:string}> }} options
 */
export function buildPopulation({ attendees, speakers, seed, days }) {
  const organizationStream = seededStream(seed, "organizations");
  const takenNames = new Set();
  const organizations = Array.from({ length: PRODUCTION_SHAPE.organizations }, (_, index) => ({
    id: previewScaleId(`organization:${index + 1}`),
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
  const registrations = attendeeStreams.map(({ random, ...person }) => {
    const cancelled = random() < PRODUCTION_SHAPE.cancelledShare;
    const registeredAt = person.createdAt;
    return {
      id: previewScaleId(`registration:${person.key}`),
      userId: person.userId,
      status: cancelled ? "cancelled" : "registered",
      identityId:
        person.organizationIdentity && random() < PRODUCTION_SHAPE.registrationIdentityShare / PRODUCTION_SHAPE.organizationIdentityShare
          ? person.organizationIdentity.id
          : null,
      createdAt: registeredAt,
      cancelledAt: cancelled ? registeredAt : null,
      days: days.map((day) => ({
        id: previewScaleId(`attendance:${person.key}:${day.date}`),
        dayId: day.id,
        dayDate: day.date,
        type: weighted(random, PRODUCTION_SHAPE.attendance),
      })),
      badge:
        random() < PRODUCTION_SHAPE.badgeShare
          ? { id: previewScaleId(`badge:${person.key}`), credentialHash: badgeCredentialHash(seededBadgeCredential(person.key)) }
          : null,
    };
  });
  return { organizations, speakers: speakerPeople, attendees: attendeePeople, registrations };
}

/** Saved sessions: about one per registration, in person when the attendee is there that day. */
export function buildSavedSessions({ registrations, sessions, seed }) {
  const bookable = sessions.filter((session) => session.kind !== "break");
  const saved = [];
  for (const registration of registrations) {
    if (registration.status !== "registered") continue;
    const random = seededStream(seed, `saved:${registration.id}`);
    const count = Math.floor(random() * PRODUCTION_SHAPE.savedSessionsPerRegistration * 2 + 0.5);
    const chosen = new Set();
    for (let index = 0; index < count; index += 1) chosen.add(pick(random, bookable));
    for (const session of chosen) {
      const dayDate = session.startAt.slice(0, 10);
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
export function buildSponsorships(organizations) {
  return SPONSOR_TIERS.map((tier, index) => ({
    id: previewScaleId(`sponsorship:${index + 1}`),
    organizationId: organizations[index].id,
    tier,
  }));
}
