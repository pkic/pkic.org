import { z } from "zod";
import { sameOriginPathSchema } from "./urls";
import { legacyAgendaDownloadSchema } from "./event-agenda-legacy-fragments";
import { agendaSnapshotSchema } from "./event-agenda";

/** Public authored source identity; no host paths, private keys or personal identity data. */
export const authoredAgendaSourceSchema = z
  .object({
    sourcePath: legacyAgendaDownloadSchema.shape.sourcePath.refine(
      (path) =>
        path.startsWith("content/events/") &&
        /\/_?index\.md$/u.test(path) &&
        path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\\?#\p{Cc}]/u.test(part)),
      "Use an exact authored event-bundle source",
    ),
    sourceDigest: legacyAgendaDownloadSchema.shape.sourceDigest,
    route: sameOriginPathSchema.refine(
      (route) =>
        route.startsWith("/events/") &&
        route.endsWith("/") &&
        !/[?#\\\s\p{Cc}]/u.test(route) &&
        new URL(route, "https://pkic.org").pathname === route,
      "Use the exact authored event root",
    ),
  })
  .strict();
export const authoredAgendaSourcesSchema = z.array(authoredAgendaSourceSchema).max(1000);
export const publicationAuthoredAgendaRouteSchema = authoredAgendaSourceSchema
  .extend({ eventSlug: agendaSnapshotSchema.shape.eventSlug })
  .strict();
export const publicationAuthoredAgendaRoutesSchema = z.array(publicationAuthoredAgendaRouteSchema).max(1000);
export type AuthoredAgendaSource = z.infer<typeof authoredAgendaSourceSchema>;
export type PublicationAuthoredAgendaRoute = z.infer<typeof publicationAuthoredAgendaRouteSchema>;
