import { registerLegacyAgendaSchemaResolution } from "../lib/legacy-agenda-runtime.mjs";
import { readFile, access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { installReleaseBytes, installReleaseFile, synchronizeReleaseDirectory } from "./synchronize-release-files.mjs";

// Register native TypeScript resolution before loading the canonical shared schema graph.
registerLegacyAgendaSchemaResolution();
const { prepareDocumentRetirement, readReleaseDocumentRoutes, validateDocumentRedirectRules } =
  await import("./collect-document-redirects.mjs");
const { sitePublicationReleaseSchema } = await import("../../assets/shared/schemas/site-publication-release.ts");
const { createReleaseIntegrity, verifyReleaseIntegrity, synchronizedPublicationDirectories } =
  await import("./release-integrity.mjs");

/** Merge a complete publication into the complete Worker build, never a partial asset upload. */
export async function assembleStaticRelease(source, destination, environment) {
  const release = sitePublicationReleaseSchema.parse(
    JSON.parse(await readFile(resolve(source, "publication.json"), "utf8")),
  );
  if (release.version !== 1 || release.environment !== environment)
    throw new Error("Publication environment does not match the Worker build");
  if (environment !== "local" && release.source !== "native")
    throw new Error("Remote deployments require a native publication snapshot");
  if (environment !== "local" && (release.sourceSequence === null || !release.integrity))
    throw new Error("Remote deployments require tracked publication provenance and integrity");
  if (release.integrity) await verifyReleaseIntegrity(source, release);
  const documentRoutes = await readReleaseDocumentRoutes(source, release);
  const previousPath = resolve(destination, "publication.json");
  let previous;
  try {
    previous = await readFile(previousPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = previous ? sitePublicationReleaseSchema.parse(JSON.parse(previous)) : null;
  const retired = new Set(documentRoutes.retiredPaths.map(({ path }) => path));
  const redirectPath = resolve(destination, "_redirects");
  let redirects = "";
  try {
    redirects = await readFile(redirectPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  redirects = redirects.replace(/\n# BEGIN PUBLICATION[\s\S]*?# END PUBLICATION\n?/g, "");
  const feedRedirects = ["/news/feed", "/news/feed/", "/news/feed/index.xml"].map((from) => ({
    from,
    to: "/news/feed.xml",
    status: 301,
  }));
  const installedRedirects = [...release.redirects, ...feedRedirects];
  validateDocumentRedirectRules(installedRedirects, documentRoutes, redirects);
  const retire = await prepareDocumentRetirement([source, destination], documentRoutes);
  await retire();
  // A repeated assembly replaces only the previous publication's owned files.
  // Normal fresh builds cannot derive prior document routes from this local destination.
  if (manifest) {
    const incoming = new Set(release.files);
    for (const file of manifest.files) {
      if (!incoming.has(file) && !retired.has(file)) await rm(resolve(destination, file), { force: true });
    }
  }
  for (const directory of synchronizedPublicationDirectories) {
    try {
      await access(resolve(source, directory));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await rm(resolve(destination, directory), { recursive: true, force: true });
      continue;
    }
    // HTML and lazy imports must use the same complete frontend build. In local
    // releases Astro can replace the earlier Vite development build with hashes.
    await synchronizeReleaseDirectory(resolve(source, directory), resolve(destination, directory));
  }
  // Install referenced assets before exposing the HTML that uses them.
  for (const file of release.files) {
    await installReleaseFile(resolve(source, file), resolve(destination, file));
  }
  // Asset responses carry the selected publication identity without running application code.
  const headerPath = resolve(destination, "_headers");
  let headers = "";
  try {
    headers = await readFile(headerPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  headers = headers
    .replace(/\n# BEGIN PUBLICATION[\s\S]*?# END PUBLICATION\n?/g, "")
    .replace(/ {4}# BEGIN PUBLICATION GLOBAL\n[\s\S]*? {4}# END PUBLICATION GLOBAL\n/g, "");
  const global = `    # BEGIN PUBLICATION GLOBAL\n    X-PKIC-Publication: static; snapshot=${release.snapshotId}\n    Cache-Control: public, max-age=0, must-revalidate\n${environment === "preview" ? "    X-Robots-Tag: noindex, nofollow, noarchive\n" : ""}    # END PUBLICATION GLOBAL\n`;
  // A duplicate /* block replaces security headers in Cloudflare's parser.
  // Add publication fields to the existing global rule instead.
  headers = /^\/\*\r?\n/m.test(headers)
    ? headers.replace(/^\/\*\r?\n/m, (rule) => rule + global)
    : `${headers}\n/*\n${global}`;
  const privateRules = release.privatePaths
    .map(
      (path) =>
        `\n${path}\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive\n`,
    )
    .join("");
  const conferenceRules = release.files
    .filter((file) =>
      /^(?:events\/.*\/(?:event-data\.json|agenda\.ics)|.*\/agenda\/(?:data\.json|calendar\.ics|calendar\/[^/]+\.ics))$/.test(
        file,
      ),
    )
    .map((file) => `\n/${file}\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive\n`)
    .join("");
  const immutableRules = [
    "/_assets/*",
    "/_published/media/*",
    "/_published/social/*.jpg",
    "/_published/assessment/*",
    "/_published/diagrams/*",
    "/_published/agenda/*",
  ]
    .map(
      (path) =>
        `\n${path}\n    ! Cache-Control\n    Cache-Control: public, max-age=31536000, immutable\n${path === "/_assets/*" ? "    Service-Worker-Allowed: /portal/\n" : ""}`,
    )
    .join("");
  const rules =
    immutableRules +
    "\n/_published/news/*\n    ! Cache-Control\n    Cache-Control: public, max-age=300, must-revalidate\n\n/feed/*\n    Content-Type: application/rss+xml; charset=UTF-8\n\n/ms/feed/*\n    Content-Type: application/rss+xml; charset=UTF-8\n\n/news/feed.xml\n    Content-Type: application/rss+xml; charset=UTF-8\n";
  await installReleaseBytes(
    `${headers}\n# BEGIN PUBLICATION${rules}${conferenceRules}${privateRules}# END PUBLICATION\n`,
    headerPath,
  );
  await installReleaseBytes(
    `${redirects}\n# BEGIN PUBLICATION\n${installedRedirects.map(({ from, to, status }) => `${from} ${to} ${status}`).join("\n")}\n# END PUBLICATION\n`,
    redirectPath,
  );
  const installed = {
    ...release,
    integrity: await createReleaseIntegrity(destination, [...release.files, "_headers", "_redirects"]),
  };
  if (release.integrity) {
    for (const [path, expected] of Object.entries(release.integrity.files)) {
      // These two policy files are deliberately generated for the complete
      // target Worker. Every incoming page and synchronized asset stays exact.
      if (path === "_headers" || path === "_redirects") continue;
      const actual = installed.integrity.files[path];
      if (!actual || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
        throw new Error(`Publication changed during installation: ${path}`);
    }
  }
  await installReleaseBytes(JSON.stringify(sitePublicationReleaseSchema.parse(installed)), previousPath);
  console.log(`[publication] assembled ${release.files.length} static pages from snapshot ${release.snapshotId}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await assembleStaticRelease(resolve("dist/astro"), resolve("dist/client"), process.env.CLOUDFLARE_ENV ?? "local");
}
