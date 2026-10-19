import { z } from "zod";
import { databaseIdSchema } from "./identifiers.ts";
import { utcInstantSchema } from "./api-common.ts";
import { presentationByteCountSchema, legacyAgendaDownloadSchema } from "./event-agenda-legacy-fragments.ts";
import { sessionPresentationReleaseParamsSchema } from "../session-presentation-public-url.ts";
import { publicationDocumentFilePath, publicationRepairAliasSourceRoute } from "../publication-document-path.ts";

/** Exact encoded PDF path. No filename substitution or normalization occurs here. */
export const publicationRepairAliasUrlSchema = z
  .string()
  .max(1024)
  .refine((value) => {
    try {
      publicationDocumentFilePath(value);
      return value.startsWith("/events/");
    } catch {
      return false;
    }
  }, "Repair aliases require exact encoded event PDF paths");

/** Reviewed repair evidence is distinct from an observed historical download receipt. */
export const publicationRepairAliasSchema = sessionPresentationReleaseParamsSchema
  .extend({
    eventId: databaseIdSchema,
    materialId: z.string().min(1).max(300),
    bytes: presentationByteCountSchema,
    sourcePath: legacyAgendaDownloadSchema.shape.sourcePath,
    sourceDigest: legacyAgendaDownloadSchema.shape.sourceDigest,
    sourceKey: legacyAgendaDownloadSchema.shape.sourceLocator,
    sourceRef: legacyAgendaDownloadSchema.shape.sourceLocator,
    reviewedAt: utcInstantSchema,
    urls: z
      .array(publicationRepairAliasUrlSchema)
      .min(1)
      .max(10)
      .refine((urls) => new Set(urls).size === urls.length, "Duplicate repair alias"),
  })
  .strict()
  .superRefine((alias, ctx) => {
    try {
      const prefix = `${publicationRepairAliasSourceRoute(alias.sourcePath)}/`;
      for (const [index, url] of alias.urls.entries())
        if (!url.startsWith(prefix))
          ctx.addIssue({
            code: "custom",
            path: ["urls", index],
            message: "Repair alias is outside its authored event route",
          });
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["sourcePath"],
        message: "Repair alias requires an authored event-bundle source",
      });
    }
  });
export const publicationRepairAliasesSchema = z
  .array(publicationRepairAliasSchema)
  .max(1000)
  .superRefine((aliases, ctx) => {
    const owners = new Set<string>();
    const paths = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
      const owner = JSON.stringify([alias.eventId, alias.occurrenceId, alias.materialId]);
      if (owners.has(owner)) ctx.addIssue({ code: "custom", path: [index], message: "Duplicate repair owner" });
      owners.add(owner);
      for (const url of alias.urls) {
        const path = decodeURIComponent(url).toLowerCase();
        if (paths.has(path))
          ctx.addIssue({ code: "custom", path: [index, "urls"], message: "Colliding repair aliases" });
        paths.add(path);
      }
    }
  });
export type PublicationRepairAlias = z.infer<typeof publicationRepairAliasSchema>;

/** Each explicitly reviewed spelling preserves both existing public URL families. */
export function publicationRepairAliasPaths(alias: PublicationRepairAlias): string[] {
  return alias.urls.flatMap((url) => [url, `/content-media${url}`]);
}
