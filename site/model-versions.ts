import { readFile } from "node:fs/promises";
import { loadModelVersion } from "./model-version-source";
import { modelLevelSlug } from "./model-version-markdown";
import { parse } from "yaml";
import source from "../data/model-versions.yaml?raw";
import { modelVersionLinks } from "../assets/shared/model-versions";
import { modelRegistrySchema } from "../assets/shared/model-registry";
import { contentContributionSchema } from "../assets/shared/content-contribution";

const registrySource = process.env.PKIC_MODEL_REGISTRY_PATH
  ? await readFile(process.env.PKIC_MODEL_REGISTRY_PATH, "utf8")
  : source;
export const modelContributionEntries = modelRegistrySchema.parse(parse(registrySource)).models;

export function modelVersionContributionForRoute(route: string) {
  const versionEntry = modelContributionEntries.flatMap((entry) =>
    entry.versions.flatMap((v) =>
      route.startsWith(v.root)
        ? [
            {
              ...entry,
              contributionBranch: v.branch ?? entry.contributionBranch,
              sourceVersion: v.version,
              sourceRevision: v.commit,
            },
          ]
        : [],
    ),
  )[0];
  if (versionEntry) return contentContributionSchema.parse(versionEntry);
  const entry = modelContributionEntries.find(
    (entry) => route === entry.root || entry.sections.some((section) => route.startsWith(`${entry.root}${section}`)),
  );
  if (!entry) return undefined;
  const released = entry.versions.find((v) => v.id === entry.defaultVersion);
  return contentContributionSchema.parse({ ...entry, sourceVersion: entry.sourceVersion ?? released?.version });
}

export async function modelVersionsForRoute(route: string, publishedRoutes: readonly string[]) {
  const entry = modelContributionEntries.find((e) => route.startsWith(e.root));
  if (!entry?.versions.length) return undefined;
  const available = new Set(publishedRoutes);
  for (const version of entry.versions) {
    const model = await loadModelVersion(entry.repository, version.sourcePath ?? entry.sourcePath, version);
    available.add(version.root);
    for (const level of model.levels) available.add(`${version.root}levels/${modelLevelSlug(level)}/`);
  }
  const defaultVersion = entry.versions.find((v) => v.id === entry.defaultVersion);
  const hasVersionPath = entry.versions.some((v) => route.startsWith(v.root));
  const selectedRoute =
    !hasVersionPath && defaultVersion ? `${defaultVersion.root}${route.slice(entry.root.length)}` : route;
  return {
    ...modelVersionLinks(entry.versions, selectedRoute, available),
    root: entry.root,
    label: "Switch PQCMM model version",
    latestId: defaultVersion?.id,
    releasesUrl: `https://github.com/${entry.repository}/releases`,
  };
}
