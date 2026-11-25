import { sessionHistoryMetadataSchema } from "../../../assets/shared/schemas/event-session-history.ts";
import { buildAgenda, resolveRooms } from "./agenda.mjs";
import { buildPersonas } from "./personas.mjs";
import { buildPopulation, buildSavedSessions, buildSponsorships } from "./population.mjs";
import { seededStream } from "./random.mjs";
import { sessionHistoryMetadata } from "./statements.mjs";

/**
 * Everything the seed writes, derived from a fixed seed and the event's days,
 * so a re-run produces identical rows. Each person, the organizations and the
 * agenda draw from their own stream, so a different volume adds or removes
 * rows without changing the ones already seeded. Persona roles missing on the target database (a role a pending
 * migration adds) are left out and reported. Without headshot uploads, no
 * speaker points at a headshot.
 */
export function buildPreviewScalePlan({ attendees, speakers, context, roster, skipHeadshots = false }) {
  const seed = 20261201;
  const population = buildPopulation({ attendees, speakers, seed, days: context.days });
  if (skipHeadshots) for (const speaker of population.speakers) speaker.hasHeadshot = false;
  const rooms = resolveRooms(context.rooms ?? []);
  const sessions = buildAgenda({
    days: context.days.map((day) => day.date),
    timeZone: context.timeZone,
    rooms,
    speakers: population.speakers,
    random: seededStream(seed, "agenda"),
  });
  const speakersById = new Map(population.speakers.map((speaker) => [speaker.userId, speaker]));
  for (const session of sessions)
    if (session.speakerUserIds.length > 0) sessionHistoryMetadataSchema.parse(sessionHistoryMetadata(session, speakersById));
  const allPersonas = buildPersonas(roster);
  const personas = allPersonas.filter((persona) => !persona.roleId || context.roles.has(persona.roleId));
  const skippedRoles = [...new Set(allPersonas.filter((persona) => !personas.includes(persona)).map((persona) => persona.roleId))];
  return {
    population,
    sessions,
    rooms,
    saved: buildSavedSessions({ registrations: population.registrations, sessions, seed }),
    sponsorships: buildSponsorships(population.organizations),
    personas,
    skippedRoles,
  };
}
