import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { privatePageHeaderRules } from "../../scripts/publication/private-page-header-rules.mjs";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { createReleaseIntegrity, verifyReleaseIntegrity } from "../../scripts/publication/release-integrity.mjs";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

const endpoints = [
  "register/confirm",
  "register/manage",
  "propose/manage",
  "propose/speaker",
  "propose/presentation",
  "invite/decline",
  "virtual",
];
function matches(pattern: string, route: string) {
  return new RegExp(
    "^" +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/:[A-Za-z]\w*/g, "[^/]+")
        .replace(/\*/g, ".*") +
      "$",
  ).test(route);
}
function effectiveHeaders(text: string, route: string) {
  const headers = new Map<string, string>();
  let active = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      active = matches(line, route);
      continue;
    }
    if (!active) continue;
    const value = line.trim();
    if (value.startsWith("! ")) {
      headers.delete(value.slice(2).toLowerCase());
      continue;
    }
    const colon = value.indexOf(":");
    if (colon < 0) continue;
    const name = value.slice(0, colon).toLowerCase(),
      next = value.slice(colon + 1).trim();
    headers.set(name, headers.has(name) ? headers.get(name) + ", " + next : next);
  }
  return headers;
}
it("keeps more than 200 events' private endpoints protected without changing public entries or agenda pages", async () => {
  const root = await createTemporaryDirectory("private-page-headers");
  const source = resolve(root, "source"),
    destination = resolve(root, "release");
  const privatePaths = Array.from({ length: 201 }, (_, i) =>
    endpoints.map((e) => `/events/2027/event-${i}/${e}/`),
  ).flat();
  const publicPaths = Array.from({ length: 201 }, (_, i) =>
    ["register", "propose", "agenda", "sessions/session"].map((e) => `/events/2027/event-${i}/${e}/`),
  ).flat();
  const files = ["index.html", ...privatePaths.concat(publicPaths).map((p) => p.slice(1) + "index.html")];
  try {
    await Promise.all(
      files.map(async (file) => {
        const path = resolve(source, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "<!doctype html><title>Synthetic</title>");
      }),
    );
    const release = sitePublicationReleaseSchema.parse({
      version: 1,
      source: "native",
      environment: "local",
      snapshotId: createHash("sha256").update("synthetic-private-endpoints").digest("hex"),
      sourceSequence: 1,
      privatePaths,
      files,
      integrity: await createReleaseIntegrity(source, files),
    });
    await writeFile(resolve(source, "publication.json"), JSON.stringify(release));
    await assembleStaticRelease(source, destination, "local");
    const headers = await readFile(resolve(destination, "_headers"), "utf8");
    expect(headers.split(/\r?\n/).filter((l) => l && !/^(?:\s|#)/.test(l)).length).toBeLessThanOrEqual(100);
    for (const path of privatePaths) {
      const actual = effectiveHeaders(headers, path);
      expect(actual.get("cache-control"), path).toBe("no-store, max-age=0");
      expect(actual.get("referrer-policy"), path).toBe("no-referrer");
      expect(actual.get("x-robots-tag"), path).toBe("noindex, nofollow, noarchive");
    }
    for (const path of publicPaths) {
      const actual = effectiveHeaders(headers, path);
      expect(actual.get("cache-control"), path).toBe("public, max-age=0, must-revalidate");
      expect(actual.get("x-robots-tag"), path).toBeUndefined();
    }
    expect(effectiveHeaders(headers, "/events/2027/event-0/agenda/").get("content-security-policy")).toContain(
      "default-src",
    );
    const installed = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    await verifyReleaseIntegrity(destination, installed);
    await assembleStaticRelease(source, destination, "local");
    expect(await readFile(resolve(destination, "_headers"), "utf8")).toBe(headers);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("leaves a family exact when even one generated matching page is public", () => {
  const paths = ["/events/2027/first/register/manage/", "/events/2027/second/register/manage/"];
  const files = [...paths.map((p) => p.slice(1) + "index.html"), "events/2028/public/register/manage/index.html"];
  expect(privatePageHeaderRules(paths, files)).toEqual(paths);
});
it("does not generalize private event roots, entry forms, or arbitrary authored child paths", () => {
  const paths = [
    "/events/2027/first/register/",
    "/events/2027/second/register/",
    "/events/2027/first/event-speakers/",
    "/portal/",
    "/404.html",
  ];
  expect(
    privatePageHeaderRules(
      paths,
      paths.map((p) => p.slice(1) + "index.html"),
    ),
  ).toEqual([...paths, "/404"]);
});
