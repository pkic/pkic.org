import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { validateDocumentRoutes } from "../../scripts/publication/collect-document-redirects.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { createReleaseIntegrity, verifyReleaseIntegrity } from "../../scripts/publication/release-integrity.mjs";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import {
  PUBLICATION_DOCUMENT_ROUTES_PATH,
  sitePublicationReleaseSchema,
} from "../../assets/shared/schemas/site-publication-release";

it("binds all lazy imports and generated page bytes and refuses tampering before replacing a good release", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-integrity-"));
  const source = resolve(root, "source");
  const destination = resolve(root, "installed");
  try {
    await mkdir(resolve(source, "_assets"), { recursive: true });
    await mkdir(destination);
    await writeFile(resolve(source, "index.html"), "Approved page");
    await writeFile(resolve(source, "_assets/editor.js"), "Approved lazy import");
    await writeFile(resolve(destination, "index.html"), "Last good page");
    const integrity = await createReleaseIntegrity(source, ["index.html"]);
    expect(integrity.files["_assets/editor.js"].bytes).toBe(20);
    const release = sitePublicationReleaseSchema.parse({
      version: 1,
      source: "native",
      environment: "production",
      sourceSequence: 17,
      snapshotId: "a".repeat(64),
      files: ["index.html"],
      integrity,
    });
    await writeFile(resolve(source, "publication.json"), JSON.stringify(release));
    await writeFile(resolve(source, "_assets/editor.js"), "Tampered lazy import");
    await expect(assembleStaticRelease(source, destination, "production")).rejects.toThrow("integrity");
    expect(await readFile(resolve(destination, "index.html"), "utf8")).toBe("Last good page");
    await writeFile(resolve(source, "_assets/editor.js"), "Approved lazy import");
    await assembleStaticRelease(source, destination, "production");
    const installed = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    expect(installed.sourceSequence).toBe(17);
    expect(installed.integrity?.files).toHaveProperty("_headers");
    expect(installed.integrity?.files).toHaveProperty("_redirects");
    await verifyReleaseIntegrity(destination, installed);
    await writeFile(resolve(source, "_assets/untracked.js"), "Untracked import");
    await expect(verifyReleaseIntegrity(source, release)).rejects.toThrow("integrity");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps local legacy fixtures explicit and refuses untracked native provenance remotely", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-integrity-fixture-"));
  try {
    const legacy = {
      version: 1,
      source: "fixture",
      environment: "local",
      snapshotId: "b".repeat(64),
      files: ["index.html"],
    };
    await writeFile(resolve(root, "index.html"), "Synthetic fixture");
    await writeFile(resolve(root, "publication.json"), JSON.stringify(legacy));
    await assembleStaticRelease(root, resolve(root, "installed"), "local");
    const installed = JSON.parse(await readFile(resolve(root, "installed/publication.json"), "utf8"));
    expect(installed.sourceSequence).toBeNull();
    expect(installed.source).toBe("fixture");
    await writeFile(
      resolve(root, "publication.json"),
      JSON.stringify({ ...legacy, source: "native", environment: "production" }),
    );
    await expect(assembleStaticRelease(root, resolve(root, "remote"), "production")).rejects.toThrow(
      "tracked publication provenance",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("hashes deterministically and excludes symlinked source assets", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-integrity-links-"));
  try {
    await mkdir(resolve(root, "_assets"));
    await writeFile(resolve(root, "index.html"), "Same bytes");
    await writeFile(resolve(root, "_assets/one.js"), "One");
    const first = await createReleaseIntegrity(root, ["index.html"]);
    expect(await createReleaseIntegrity(root, ["index.html"])).toEqual(first);
    await symlink(resolve(root, "index.html"), resolve(root, "_assets/linked.js"));
    await expect(createReleaseIntegrity(root, ["index.html"])).rejects.toThrow("symlinks");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function documentRelease() {
  const root = await createTemporaryDirectory("document-route-integrity");
  const source = resolve(root, "source"),
    destination = resolve(root, "installed");
  const bytes = Buffer.from("%PDF-1.7\nExact retired historical bytes\n%%EOF");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const canonical = sessionPresentationPublicUrl({
    eventSlug: "destination",
    occurrenceId: "1".repeat(32),
    versionId: "2".repeat(32),
    digest,
  });
  const routes = validateDocumentRoutes({
    version: 1,
    snapshotId: "c".repeat(64),
    sourceSequence: 8,
    redirects: ["/events/old-folder/Exact%C2%A0PDF.pdf", "/content-media/events/old-folder/Exact%C2%A0PDF.pdf"].map(
      (from) => ({ from, to: canonical, status: 302 }),
    ),
    retiredPaths: ["events/old-folder/Exact\u00a0PDF.pdf", "content-media/events/old-folder/Exact\u00a0PDF.pdf"].map(
      (path) => ({ path, sha256: digest, bytes: bytes.length }),
    ),
  });
  const put = async (directory: string, file: string, value: string | Buffer) => {
    await mkdir(dirname(resolve(directory, file)), { recursive: true });
    await writeFile(resolve(directory, file), value);
  };
  for (const directory of [source, destination]) {
    for (const { path } of routes.retiredPaths) await put(directory, path, bytes);
    await put(directory, "unrelated/brochure.pdf", "%PDF-unrelated");
  }
  await put(source, "index.html", "New approved page");
  await put(destination, "index.html", "Last good page");
  await put(source, PUBLICATION_DOCUMENT_ROUTES_PATH, JSON.stringify(routes));
  const release = sitePublicationReleaseSchema.parse({
    version: 1,
    source: "native",
    environment: "production",
    snapshotId: routes.snapshotId,
    sourceSequence: routes.sourceSequence,
    files: ["index.html", PUBLICATION_DOCUMENT_ROUTES_PATH],
    redirects: routes.redirects,
    integrity: await createReleaseIntegrity(source, ["index.html", PUBLICATION_DOCUMENT_ROUTES_PATH]),
  });
  await put(source, "publication.json", JSON.stringify(release));
  // The prior event-root copy may be owned, while its content-media counterpart is a generic residual.
  await put(
    destination,
    "publication.json",
    JSON.stringify({
      ...release,
      integrity: undefined,
      files: ["index.html", routes.retiredPaths[0].path],
      redirects: [],
    }),
  );
  return { root, source, destination, routes, release, put, bytes, canonical };
}

it("retires only exact bound incoming and prior static copies, installs paired redirects and preserves unrelated PDFs", async () => {
  const fixture = await documentRelease();
  const { root, source, destination, routes, canonical } = fixture;
  try {
    await assembleStaticRelease(source, destination, "production");
    for (const directory of [source, destination]) {
      for (const { path } of routes.retiredPaths)
        await expect(readFile(resolve(directory, path))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(resolve(directory, "unrelated/brochure.pdf"), "utf8")).toBe("%PDF-unrelated");
    }
    const redirects = await readFile(resolve(destination, "_redirects"), "utf8");
    for (const { from } of routes.redirects) expect(redirects).toContain(`${from} ${canonical} 302`);
    expect(redirects).not.toContain("Exact PDF.pdf");
    const installed = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    expect(installed.files).not.toContain(routes.retiredPaths[0].path);
    await verifyReleaseIntegrity(destination, installed);
    await assembleStaticRelease(source, destination, "production");
    await verifyReleaseIntegrity(destination, installed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["artifact", "redirect", "different bytes", "symlink", "prior manifest"])(
  "refuses %s before removing copies or replacing the previous page",
  async (change) => {
    const { root, source, destination, routes, release, put, bytes, canonical } = await documentRelease();
    try {
      if (change === "prior manifest") await put(destination, "publication.json", "{invalid-json");
      if (change === "artifact")
        await put(source, PUBLICATION_DOCUMENT_ROUTES_PATH, JSON.stringify({ ...routes, retiredPaths: [] }));
      if (change === "redirect")
        await put(
          source,
          "publication.json",
          JSON.stringify({
            ...release,
            redirects: routes.redirects.map((entry: { from: string; to: string; status: number }) => ({
              ...entry,
              to: canonical.replace("/destination/", "/foreign/"),
            })),
          }),
        );
      if (change === "different bytes") await put(destination, routes.retiredPaths[0].path, "%PDF-unknown-owned-file");
      if (change === "symlink") {
        const path = resolve(destination, routes.retiredPaths[0].path);
        await rm(path);
        await symlink(resolve(source, routes.retiredPaths[0].path), path);
      }
      await expect(assembleStaticRelease(source, destination, "production")).rejects.toThrow();
      expect(await readFile(resolve(destination, "index.html"), "utf8")).toBe("Last good page");
      // Preflight checks every candidate before deleting the first one.
      expect(await readFile(resolve(source, routes.retiredPaths[0].path))).toEqual(bytes);
      expect(await readFile(resolve(destination, routes.retiredPaths[1].path))).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("installs retained canonical redirects in a fresh destination without relying on a prior release artifact", async () => {
  const { root, source, destination, routes, canonical } = await documentRelease();
  try {
    await rm(resolve(destination, "publication.json"));
    await assembleStaticRelease(source, destination, "production");
    const installed = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    expect(installed.redirects).toEqual(routes.redirects);
    expect(await readFile(resolve(destination, "_redirects"), "utf8")).toContain(
      `${routes.redirects[0].from} ${canonical} 302`,
    );
    for (const directory of [source, destination]) {
      for (const { path } of routes.retiredPaths)
        await expect(readFile(resolve(directory, path))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await verifyReleaseIntegrity(destination, installed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("runs the actual publication assembler in direct Node with canonical TypeScript imports and byte retirement", async () => {
  const { root, source, destination, routes, canonical } = await documentRelease();
  const entrypoint = resolve(process.cwd(), "scripts/publication/assemble-static-release.mjs");
  const incoming = resolve(root, "dist/astro"),
    installed = resolve(root, "dist/client");
  try {
    await mkdir(resolve(root, "dist"));
    await rename(source, incoming);
    await rename(destination, installed);
    const output = execFileSync(process.execPath, ["--experimental-strip-types", entrypoint], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, CLOUDFLARE_ENV: "production", NODE_OPTIONS: "" },
    });
    expect(output).toContain("assembled");
    const release = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(installed, "publication.json"), "utf8")),
    );
    expect(release.redirects).toEqual(routes.redirects);
    expect(await readFile(resolve(installed, "_redirects"), "utf8")).toContain(
      `${routes.redirects[0].from} ${canonical} 302`,
    );
    for (const directory of [incoming, installed]) {
      for (const { path } of routes.retiredPaths)
        await expect(readFile(resolve(directory, path))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await verifyReleaseIntegrity(installed, release);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
