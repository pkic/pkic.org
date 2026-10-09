import { readDocumentRepairAliases } from "../scripts/publication/read-document-repair-aliases.mjs";
import { resolveRetainedPublicationRepairAliases } from "../functions/_lib/services/site-publication-repair-aliases";
import {
  resolvePublishedRecordings,
  recordPublishedRecordings,
} from "../functions/_lib/services/site-publication-recordings";
import { verifyPublicRecordings } from "../scripts/publication/verify-public-recordings.mjs";
import {
  resolvePublishedDocuments,
  resolveRetainedPublishedDocuments,
  recordPublishedDocuments,
} from "../functions/_lib/services/site-publication-documents";
import { collectDocumentRedirects } from "../scripts/publication/collect-document-redirects.mjs";
import { verifyPublicDocuments } from "../scripts/publication/verify-public-documents.mjs";
import { writePublicationDocumentAllow } from "../functions/_lib/services/site-publication-document-projection";
import { publicationDocumentAllowSchema } from "../assets/shared/schemas/site-publication-documents";
import { requirePresentationBucket } from "../functions/_lib/services/presentation-upload";
import { assertPublicationMachineExtraction } from "../functions/_lib/services/site-publication-machine-extraction";
import { parseEventFlowPath } from "../assets/shared/event-flow-paths";
import { publicationStagingDirectory, wranglerEnvironment } from "../scripts/publication/build-context.mjs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlatformProxy, unstable_readConfig as readConfig } from "wrangler";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import {
  createRemappedSitePublicationSnapshot,
  assertSitePublicationSourceUnchanged,
} from "../functions/_lib/services/site-publication-snapshot-identity";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";
import { requireProfileImageBucket } from "../functions/_lib/services/profile-image-storage";
import type { Env } from "../functions/_lib/types";
import { publicationBindingConfig } from "../scripts/publication/binding-config.mjs";
import { listPublicMedia } from "../scripts/publication/list-public-media.mjs";
import { copyPublicMedia } from "../scripts/publication/copy-public-media.mjs";
import { siteDiscoveryRedirectEntries } from "../functions/_lib/services/site-discovery";
import {
  publishedSiteRoutes,
  siteAuthoredAgendaSources,
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
  const repairs = await readDocumentRepairAliases(process.env.PKIC_PUBLICATION_REPAIR_ALIASES, [
    resolve("public"),
    resolve("static"),
    resolve("content"),
    output,
  ]);
  const source = process.env.PKIC_PUBLICATION_SNAPSHOT;
  const environment = process.env.CLOUDFLARE_ENV;
  if (source) {
    if (repairs.length) throw new Error("Repair aliases require verified native document bytes");
    if (environment === "preview" || environment === "production")
      throw new Error("Remote publication builds cannot use synthetic snapshot files");
    const fixture = sitePublicationSnapshotSchema.parse(JSON.parse(await readFile(resolve(source), "utf8")));
    for (const selection of siteSponsorSelections()) fixture.sponsors[sponsorPublicationKey(selection)] ??= [];
    await writeFile(
      resolve(output, "document-routes.json"),
      JSON.stringify(collectDocumentRedirects({ ...fixture, sourceSequence: null }, [])),
    );
    await writeFile(resolve(output, "retained-documents.json"), "[]");
    await writeFile(resolve(output, "repair-aliases.json"), "[]");
    await writeFile(resolve(output, "retained-repair-aliases.json"), "[]");
    return fixture;
  }
  if (!environment) throw new Error("Select CLOUDFLARE_ENV or provide a synthetic publication snapshot");
  const config = readConfig({ config: resolve("wrangler.jsonc"), env: wranglerEnvironment(environment) });
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
    const machine = await assertPublicationMachineExtraction(platform.env.DB, process.env);
    const selections = siteSponsorSelections();
    const authoredEventSlugs = [
      ...new Set(
        publishedSiteRoutes().flatMap((route) => {
          const flow = parseEventFlowPath(route);
          return flow?.flow === "registration" ? [flow.eventSlug] : [];
        }),
      ),
    ];
    const authoredAgendaSources = await siteAuthoredAgendaSources();
    const snapshot = await readSitePublicationSnapshot(
      platform.env.DB,
      selections,
      authoredEventSlugs,
      authoredAgendaSources,
    );
    if (machine && snapshot.sourceSequence !== machine.sourceSequence)
      throw new Error("PUBLICATION_EXTRACTION_SOURCE_CHANGED");
    const retainedDocuments = await resolveRetainedPublishedDocuments(platform.env.DB);
    const retainedRepairs = await resolveRetainedPublicationRepairAliases(platform.env.DB);
    const documents = await resolvePublishedDocuments(platform.env.DB, snapshot, repairs);
    const verifiedObjects = await verifyPublicDocuments(documents, (key) =>
      requirePresentationBucket(platform.env).get(key),
    );
    const activeRepairs = verifiedObjects.flatMap((document) => document.repairAliases ?? []);
    const recordings = await resolvePublishedRecordings(platform.env.DB, snapshot);
    const verifiedRecordings = await verifyPublicRecordings(recordings, (key, options) =>
      requirePresentationBucket(platform.env).get(key, options),
    );
    const references = publishedMediaReferences(snapshot);
    if (references.length && !platform.env.ASSETS_BUCKET)
      throw new Error("Public media requires the native R2 binding");
    await mkdir(resolve(output, "media", "_published"), { recursive: true });
    const keys = await resolvePublishedMediaKeys(platform.env.DB, references);
    const manifest = await listPublicMedia(Object.values(keys), (key: string) =>
      requireProfileImageBucket(platform.env, key),
    );
    const published = await createRemappedSitePublicationSnapshot(
      snapshot,
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
    const verified = await readSitePublicationSnapshot(
      platform.env.DB,
      selections,
      authoredEventSlugs,
      await siteAuthoredAgendaSources(),
    );
    const verifiedRetainedDocuments = await resolveRetainedPublishedDocuments(platform.env.DB);
    if (
      JSON.stringify(retainedRepairs) !== JSON.stringify(await resolveRetainedPublicationRepairAliases(platform.env.DB))
    )
      throw new Error("Retained repair alias evidence changed during extraction");
    if (JSON.stringify(retainedDocuments) !== JSON.stringify(verifiedRetainedDocuments))
      throw new Error("Retained PDF provenance changed during extraction");
    const verifiedDocuments = await resolvePublishedDocuments(platform.env.DB, verified, repairs);
    if (JSON.stringify(documents) !== JSON.stringify(verifiedDocuments))
      throw new Error("Published PDF sources changed during extraction");
    const currentRecordings = await resolvePublishedRecordings(platform.env.DB, verified);
    if (JSON.stringify(recordings) !== JSON.stringify(currentRecordings))
      throw new Error("Published recording sources changed during extraction");
    const verifiedKeys = await resolvePublishedMediaKeys(platform.env.DB, publishedMediaReferences(verified));
    const mediaChanged =
      Object.keys(keys).length !== Object.keys(verifiedKeys).length ||
      Object.entries(keys).some(([reference, key]) => verifiedKeys[reference] !== key);
    assertSitePublicationSourceUnchanged(snapshot, verified);
    if (mediaChanged)
      throw new Error("Public content or selected media changed during export; rebuild the publication");
    await assertPublicationMachineExtraction(platform.env.DB, process.env);
    await recordPublishedDocuments(platform.env.DB, published, verifiedObjects, process.env);
    await recordPublishedRecordings(platform.env.DB, published, verifiedRecordings, process.env);
    if ((verifiedObjects.length || verifiedRecordings.length) && !machine)
      throw new Error("Published PDF projections require the attested native publication coordinator");
    for (const document of [...verifiedObjects, ...verifiedRecordings]) {
      const projection = { ...document };
      if ("legacyDownload" in projection) delete projection.legacyDownload;
      if ("repairAliases" in projection) delete projection.repairAliases;
      await writePublicationDocumentAllow(
        requirePresentationBucket(platform.env),
        publicationDocumentAllowSchema.parse({ ...projection, version: 1 }),
      );
    }
    await writeFile(
      resolve(output, "document-routes.json"),
      JSON.stringify(
        collectDocumentRedirects(
          published,
          verifiedObjects,
          retainedDocuments,
          verifiedRecordings,
          activeRepairs,
          retainedRepairs,
        ),
      ),
    );
    await writeFile(resolve(output, "retained-documents.json"), JSON.stringify(retainedDocuments));
    await writeFile(resolve(output, "repair-aliases.json"), JSON.stringify(activeRepairs));
    await writeFile(resolve(output, "retained-repair-aliases.json"), JSON.stringify(retainedRepairs));
    await writeFile(resolve(output, "snapshot.json"), JSON.stringify(published));
    console.log(
      `[publication] snapshot ${published.snapshotId}: ${published.members.length} public profiles, ${references.length} images`,
    );
    return published;
  } finally {
    await platform.dispose();
  }
}
