import { parseEventFlowPath } from "../assets/shared/event-flow-paths";
import { publicationStagingDirectory } from "../scripts/publication/build-context.mjs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlatformProxy, unstable_readConfig as readConfig } from "wrangler";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import {
  createSitePublicationSnapshot,
  readSitePublicationSnapshot,
} from "../functions/_lib/services/site-publication-snapshot";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";
import { requireProfileImageBucket } from "../functions/_lib/services/profile-image-storage";
import type { Env } from "../functions/_lib/types";
import { publicationBindingConfig } from "../scripts/publication/binding-config.mjs";
import { listPublicMedia } from "../scripts/publication/list-public-media.mjs";
import { copyPublicMedia } from "../scripts/publication/copy-public-media.mjs";
import { siteDiscoveryRedirectEntries } from "../functions/_lib/services/site-discovery";
import {
  publishedSiteRoutes,
  siteRedirectEntries,
  siteSponsorSelections,
} from "../functions/_lib/services/site-content";
import { sponsorPublicationKey } from "../assets/shared/sponsor-publication-query";

/** The build uses the same native bindings as the target, without public export APIs. */
export async function readPublicationSource() {
  const output = publicationStagingDirectory();
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "redirects.json"),
    JSON.stringify([
      ...new Map(
        [...siteRedirectEntries(), ...siteDiscoveryRedirectEntries()].flatMap((entry) =>
          (entry.from !== "/" && entry.from.endsWith("/")
            ? [entry, { ...entry, from: entry.from.slice(0, -1) }]
            : [entry]
          ).map((redirect) => [redirect.from, redirect] as const),
        ),
      ).values(),
    ]),
  );
  const source = process.env.PKIC_PUBLICATION_SNAPSHOT;
  const environment = process.env.CLOUDFLARE_ENV;
  if (source) {
    if (environment === "preview" || environment === "production")
      throw new Error("Remote publication builds cannot use synthetic snapshot files");
    const fixture = sitePublicationSnapshotSchema.parse(JSON.parse(await readFile(resolve(source), "utf8")));
    for (const selection of siteSponsorSelections()) fixture.sponsors[sponsorPublicationKey(selection)] ??= [];
    return fixture;
  }
  if (!environment) throw new Error("Select CLOUDFLARE_ENV or provide a synthetic publication snapshot");
  const config = readConfig({ config: resolve("wrangler.jsonc"), env: environment });
  const configPath = resolve(output, "bindings.json");
  await writeFile(configPath, JSON.stringify(publicationBindingConfig(config, environment)));
  const platform = await getPlatformProxy<Pick<Env, "DB" | "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">>({
    configPath,
    persist:
      environment === "local"
        ? { path: resolve(process.env.PKIC_PUBLICATION_LOCAL_STATE ?? ".wrangler/state/v3") }
        : false,
    envFiles: [],
  });
  try {
    const selections = siteSponsorSelections();
    const authoredEventSlugs = [
      ...new Set(
        publishedSiteRoutes().flatMap((route) => {
          const flow = parseEventFlowPath(route);
          return flow?.flow === "registration" ? [flow.eventSlug] : [];
        }),
      ),
    ];
    const snapshot = await readSitePublicationSnapshot(platform.env.DB, selections, authoredEventSlugs);
    const references = publishedMediaReferences(snapshot);
    if (references.length && !platform.env.ASSETS_BUCKET)
      throw new Error("Public media requires the native R2 binding");
    await mkdir(resolve(output, "media", "_published"), { recursive: true });
    const keys = await resolvePublishedMediaKeys(platform.env.DB, references);
    const manifest = await listPublicMedia(Object.values(keys), (key: string) =>
      requireProfileImageBucket(platform.env, key),
    );
    const published = await createSitePublicationSnapshot(
      await copyPublicMedia({
        snapshot,
        keys,
        manifest,
        getObject: (key: string, options?: R2GetOptions) =>
          requireProfileImageBucket(platform.env, key).get(key, options),
        output: resolve(output, "media"),
      }),
    );
    await cp(resolve(output, "media", "_published"), resolve(output, "public", "_published"), { recursive: true });
    const verified = await readSitePublicationSnapshot(platform.env.DB, selections, authoredEventSlugs);
    const verifiedKeys = await resolvePublishedMediaKeys(platform.env.DB, publishedMediaReferences(verified));
    const mediaChanged =
      Object.keys(keys).length !== Object.keys(verifiedKeys).length ||
      Object.entries(keys).some(([reference, key]) => verifiedKeys[reference] !== key);
    if (verified.snapshotId !== snapshot.snapshotId || mediaChanged)
      throw new Error("Public content or selected media changed during export; rebuild the publication");
    await writeFile(resolve(output, "snapshot.json"), JSON.stringify(published));
    console.log(
      `[publication] snapshot ${published.snapshotId}: ${published.members.length} public profiles, ${references.length} images`,
    );
    return published;
  } finally {
    await platform.dispose();
  }
}
