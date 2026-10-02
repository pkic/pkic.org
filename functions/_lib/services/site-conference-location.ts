import type { ConferenceProgram } from "../../../assets/shared/schemas/conference-program";

/** Day-specific room metadata overrides the conference-wide definition. */
export function conferenceLocation(program: ConferenceProgram, date: string, id: string) {
  const day = program.locations[date];
  const definition = day && typeof day === "object" ? (day as Record<string, unknown>)[id] : undefined;
  const location = definition ?? program.locations[id];
  const fields = location && typeof location === "object" ? (location as Record<string, unknown>) : {};
  return {
    name:
      typeof fields.name === "string"
        ? fields.name
        : id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    color: typeof fields.color === "string" ? fields.color : undefined,
    livestream: typeof fields.livestream === "string" ? fields.livestream : undefined,
  };
}
