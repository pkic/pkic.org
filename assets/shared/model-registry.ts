import { z } from "zod";
import { contentContributionSchema } from "./content-contribution.ts";
import { modelVersionSchema, modelVersionRootSchema } from "./model-versions.ts";

const modelRegistryEntrySchema = contentContributionSchema.extend({
  sourcePath: z.string().min(1),
  root: modelVersionRootSchema,
  sections: z.array(z.string()),
  versions: z.array(modelVersionSchema).default([]),
  defaultVersion: z.string().optional(),
});

export const modelRegistrySchema = z
  .object({ models: z.array(modelRegistryEntrySchema) })
  .superRefine(({ models }, context) => {
    try {
      validateModelRegistry(models);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid model registry" });
    }
  });

function validateModelRegistry(modelContributionEntries: z.infer<typeof modelRegistryEntrySchema>[]) {
  for (const entry of modelContributionEntries) {
    if (entry.defaultVersion && !entry.versions.some((v) => v.id === entry.defaultVersion && v.status === "released"))
      throw new Error("The default model version must be an explicitly registered release");
    for (const version of entry.versions) {
      const suffix = version.root.slice(entry.root.length);
      const draftPath = (path: string) => /^(?:versions\/)?drafts\/[a-z0-9][a-z0-9.-]*\/$/.test(path);
      const releasePath = (path: string) => /^versions\/\d+\.\d+\.\d+\/$/.test(path);
      const rootValid =
        version.root.startsWith(entry.root) &&
        (version.status === "draft"
          ? suffix.startsWith("versions/") && draftPath(suffix)
          : suffix === `versions/${version.version}/`);
      const aliasesValid = version.aliases.every((alias) => {
        if (!alias.startsWith(entry.root)) return false;
        const path = alias.slice(entry.root.length);
        // A released edition may retain its former draft URLs as permanent redirects.
        return draftPath(path) || (version.status === "released" && releasePath(path));
      });
      if (!rootValid || !aliasesValid)
        throw new Error("Model version paths must remain inside their release or draft namespace");
      if (version.status === "released" && version.tag !== `v${version.version}`)
        throw new Error("Release tag and version disagree");
    }
    const ids = entry.versions.map((v) => v.id);
    const paths = entry.versions.flatMap((v) => [v.root, ...v.aliases]);
    if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length)
      throw new Error("Duplicate model version identity or path");
  }
}
