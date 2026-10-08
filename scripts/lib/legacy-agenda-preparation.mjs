import { relative, resolve, sep } from "node:path";
import { parseFrontMatter } from "../../functions/_lib/services/site-markdown.ts";
import YAML from "yaml";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer.ts";
/** One repository-relative source identity regardless of the CLI's spelling. */
export function legacyAgendaSourcePath(sourcePath, repositoryRoot) {
  const normalized = relative(resolve(repositoryRoot), resolve(sourcePath)).split(sep).join("/");
  if (!normalized || normalized === ".." || normalized.startsWith("../"))
    throw new Error("Choose an authored source inside the repository root.");
  return normalized;
}
export function readLegacyAgendaSource(text, sourcePath) {
  const metadata = sourcePath.endsWith(".md") ? parseFrontMatter(text).data : YAML.parse(text);
  const source = metadata?.data ?? metadata;
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("The source must contain an agenda object, directly or below data.");
  return { source, metadata };
}
export function legacyAgendaDocuments(document) {
  const documents = [];
  for (let offset = 0; offset < document.occurrences.length; offset += 100) {
    const occurrences = document.occurrences.slice(offset, offset + 100);
    const people = new Set(occurrences.flatMap((row) => row.personRefs));
    const rooms = new Set(occurrences.flatMap((row) => row.roomRefs));
    documents.push({
      ...document,
      occurrences,
      people: document.people.filter((person) => people.has(person.ref)),
      rooms: document.rooms.filter((room) => rooms.has(room.ref)),
    });
  }
  return documents.length ? documents : [document];
}
export function validateLegacyAgendaDocument(document) {
  return legacyAgendaDocuments(document).flatMap((part, index) => {
    const result = agendaTransferSchema.safeParse(part);
    return result.success
      ? []
      : result.error.issues.map((issue) => ({
          kind: "contract",
          part: index + 1,
          path: issue.path.join("."),
          message: issue.message,
        }));
  });
}
/** Preparation never creates an event or assumes a supplied mapping exists in D1. */
export function legacyAgendaEventReport(metadata, source, sourcePath, mappings) {
  const dates = Object.keys(source.agenda ?? {}).sort();
  const target = mappings.event ?? null;
  return {
    sourcePath,
    authored: {
      title: metadata.title ?? source.title ?? null,
      timeZone: source.timezone ?? null,
      firstAgendaDate: dates[0] ?? null,
      lastAgendaDate: dates.at(-1) ?? null,
      locations: source.locations ?? null,
    },
    target,
    state: target?.eventId && target?.eventSlug ? "mapped_unverified" : "mapping_required",
    action:
      target?.eventId && target?.eventSlug
        ? "Verify the existing event and canonical rooms before backend review."
        : "Create or map the event through the existing event foundation before backend review.",
    applied: false,
  };
}
