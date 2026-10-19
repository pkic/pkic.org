import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { expect, it } from "vitest";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { preparePublicationPublicAssets } from "../../scripts/publication/prepare-public-assets.mjs";
import { publicationBindingConfig } from "../../scripts/publication/binding-config.mjs";
import { createReleaseIntegrity } from "../../scripts/publication/release-integrity.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";
import { createTestHarness, unstable_readConfig as readConfig } from "wrangler";

it("protects the generic error asset and its canonical path without adding application routes", async () => {
  const root = await createTemporaryDirectory("publication-error-headers");
  const source = resolve(root, "source"),
    destination = resolve(root, "destination");
  const files = ["index.html", "404.html"];
  const privatePaths = ["/404.html"];
  try {
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, "index.html"), "Approved home");
    await writeFile(resolve(source, "404.html"), "Generic page not found");
    const release = sitePublicationReleaseSchema.parse({
      version: 1,
      source: "native",
      snapshotId: "4".repeat(64),
      sourceSequence: 1,
      environment: "production",
      files,
      privatePaths,
      integrity: await createReleaseIntegrity(source, files),
    });
    await writeFile(resolve(source, "publication.json"), JSON.stringify(release));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assembleStaticRelease(source, destination, "production");
      const headers = await readFile(resolve(destination, "_headers"), "utf8");
      const rules = headers.split(/\r?\n/).filter((line) => line && !/^(?:\s|#)/.test(line));
      expect(rules.length).toBeLessThanOrEqual(100);
      for (const path of ["/404.html", "/404"]) {
        expect(rules.filter((rule) => rule === path)).toHaveLength(1);
        expect(headers).toContain(
          `${path}\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive`,
        );
      }
      const installed = sitePublicationReleaseSchema.parse(
        JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
      );
      expect(installed.privatePaths).toEqual(privatePaths);
      expect(installed.redirects).not.toContainEqual(expect.objectContaining({ from: "/404" }));
      expect(await readFile(resolve(destination, "404.html"), "utf8")).toBe("Generic page not found");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("moves retired PKIMM model tool links to the 1.0.0 release tools", async () => {
  const root = await createTemporaryDirectory("publication-pkimm-tools");
  const source = resolve(root, "source"),
    destination = resolve(root, "destination");
  const files = [
    "wg/pkimm/1.0.0/tools/index.html",
    "wg/pkimm/1.0.0/tools/self-assessment/index.html",
    "wg/pkimm/1.0.0/tools/PKI_Maturity_Assessment_Tool_v240318.xlsx",
  ];
  const main = resolve(root, "worker.mjs");
  const config = readConfig({ config: resolve("wrangler.jsonc"), env: "local" });
  const server = createTestHarness({
    workers: [
      {
        config: {
          name: "pkimm-tool-redirects",
          main,
          compatibility_date: config.compatibility_date,
          assets: { ...config.assets, directory: destination },
        },
      },
    ],
  });
  try {
    for (const file of files) {
      await mkdir(dirname(resolve(source, file)), { recursive: true });
      await writeFile(resolve(source, file), `Published ${file}`);
    }
    const release = sitePublicationReleaseSchema.parse({
      version: 1,
      source: "native",
      snapshotId: "5".repeat(64),
      sourceSequence: 1,
      environment: "production",
      files,
      integrity: await createReleaseIntegrity(source, files),
    });
    await writeFile(resolve(source, "publication.json"), JSON.stringify(release));
    await assembleStaticRelease(source, destination, "production");
    await writeFile(main, 'export default { fetch() { return new Response("Worker invoked", { status: 599 }); } };');
    await server.listen();
    for (const [from, to] of [
      ["/wg/pkimm/model/tools", "/wg/pkimm/1.0.0/tools/"],
      ["/wg/pkimm/model/tools/", "/wg/pkimm/1.0.0/tools/"],
      ["/wg/pkimm/model/tools/self-assessment/", "/wg/pkimm/1.0.0/tools/self-assessment/"],
      [
        "/wg/pkimm/model/tools/PKI_Maturity_Assessment_Tool_v240318.xlsx",
        "/wg/pkimm/1.0.0/tools/PKI_Maturity_Assessment_Tool_v240318.xlsx",
      ],
    ]) {
      const moved = await server.fetch(from, { redirect: "manual" });
      expect(moved.status, from).toBe(301);
      const target = new URL(moved.headers.get("location")!, "https://pkic.org").pathname;
      expect(target, from).toBe(to);
      expect((await server.fetch(target)).status, to).toBe(200);
    }
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("replaces withdrawn pages and media without removing unrelated Vite assets", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-release-"));
  const source = resolve(root, "source");
  const destination = resolve(root, "destination");
  const put = async (directory: string, file: string, value: string) => {
    await mkdir(dirname(resolve(directory, file)), { recursive: true });
    await writeFile(resolve(directory, file), value);
  };
  const manifest = (files: string[]) =>
    JSON.stringify({
      version: 1,
      source: "native",
      snapshotId: "2".repeat(64),
      environment: "preview",
      files,
      redirects: [{ from: "/legacy/", to: "/members/current/" }],
    });
  try {
    await put(
      destination,
      "publication.json",
      manifest(["members/withdrawn/index.html", "events/withdrawn/slides.pdf"]),
    );
    await put(destination, "events/withdrawn/slides.pdf", "withdrawn slides");
    await put(destination, "members/withdrawn/index.html", "withdrawn profile");
    await put(destination, "_published/media/withdrawn.webp", "withdrawn image");
    await put(destination, "_assets/shared.css", "body{color:black}");
    await put(destination, "_assets/withdrawn.css", "obsolete styles");
    const sharedStylesheet = resolve(destination, "_assets/shared.css");
    const stylesheetIdentity = await stat(sharedStylesheet);
    await put(destination, "js/portal.js", "existing portal");
    await put(destination, "js/built/loader.js", "previous development loader");
    await put(destination, "feed/blog/index.xml", "complete feed");
    await put(
      source,
      "publication.json",
      manifest(["members/current/index.html", "news/feed.xml", "img/logo.svg", "sponsors/brochure.pdf"]),
    );
    await put(source, "img/logo.svg", '<svg viewBox="0 0 1 1"/>');
    await put(source, "sponsors/brochure.pdf", "%PDF-synthetic");
    await put(source, "members/current/index.html", "approved current profile");
    await put(source, "news/feed.xml", "<rss><channel/></rss>");
    await put(source, "_published/media/current.webp", "current image");
    await put(source, "_assets/shared.css", "body{color:black}");
    await put(source, "js/built/loader.release.js", 'import("./form.release.js")');
    await put(source, "js/built/form.release.js", "published form");
    await put(source, "js/built/manifest.json", '{"loader":{"url":"/js/built/loader.release.js"}}');
    const incoming = JSON.parse(await readFile(resolve(source, "publication.json"), "utf8"));
    await put(
      source,
      "publication.json",
      JSON.stringify({
        ...incoming,
        sourceSequence: 0,
        integrity: await createReleaseIntegrity(source, incoming.files),
      }),
    );
    await assembleStaticRelease(source, destination, "preview");
    expect((await stat(sharedStylesheet)).ino).toBe(stylesheetIdentity.ino);
    await expect(readFile(resolve(destination, "_assets/withdrawn.css"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(destination, "members/current/index.html"), "utf8")).toBe("approved current profile");
    expect(await readFile(resolve(destination, "img/logo.svg"), "utf8")).toBe('<svg viewBox="0 0 1 1"/>');
    expect(await readFile(resolve(destination, "sponsors/brochure.pdf"), "utf8")).toBe("%PDF-synthetic");
    await expect(readFile(resolve(destination, "events/withdrawn/slides.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(resolve(destination, "members/withdrawn/index.html"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(resolve(destination, "_published/media/withdrawn.webp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(destination, "js/portal.js"), "utf8")).toBe("existing portal");
    expect(await readFile(resolve(destination, "js/built/loader.release.js"), "utf8")).toContain("form.release.js");
    expect(await readFile(resolve(destination, "js/built/form.release.js"), "utf8")).toBe("published form");
    expect(await readFile(resolve(destination, "js/built/manifest.json"), "utf8")).toContain("loader.release.js");
    await expect(readFile(resolve(destination, "js/built/loader.js"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(destination, "feed/blog/index.xml"), "utf8")).toBe("complete feed");
    expect(await readFile(resolve(destination, "_headers"), "utf8")).toContain("X-Robots-Tag: noindex");
    await assembleStaticRelease(source, destination, "preview");
    expect((await stat(sharedStylesheet)).ino).toBe(stylesheetIdentity.ino);
    expect(await readFile(resolve(destination, "members/current/index.html"), "utf8")).toBe("approved current profile");
    const headers = await readFile(resolve(destination, "_headers"), "utf8");
    expect(headers.match(/X-PKIC-Publication/g)).toHaveLength(1);
    expect(await readFile(resolve(destination, "news/feed.xml"), "utf8")).toContain("<rss>");
    expect(headers).not.toContain("/members/withdrawn/");
    expect(headers).toContain("max-age=31536000, immutable");
    expect(headers).toContain(
      "/_assets/*\n    ! Cache-Control\n    Cache-Control: public, max-age=31536000, immutable",
    );
    expect(headers).toContain(
      "/_published/news/*\n    ! Cache-Control\n    Cache-Control: public, max-age=300, must-revalidate",
    );
    expect(await readFile(resolve(destination, "_redirects"), "utf8")).toContain("/legacy/ /members/current/ 301");
    expect((await readFile(resolve(destination, "_redirects"), "utf8")).match(/\/news\/feed\/ /g)).toHaveLength(1);
    const input = resolve(root, "next-build-input");
    await preparePublicationPublicAssets(destination, input);
    await expect(readFile(resolve(input, "members/current/index.html"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(resolve(input, "_published/media/current.webp"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(input, "js/portal.js"), "utf8")).toBe("existing portal");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects synthetic remote releases before writing assets", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-release-"));
  try {
    await writeFile(
      resolve(root, "publication.json"),
      JSON.stringify({
        version: 1,
        source: "fixture",
        snapshotId: "1".repeat(64),
        environment: "production",
        files: ["members/index.html"],
      }),
    );
    await expect(assembleStaticRelease(root, resolve(root, "output"), "production")).rejects.toThrow(
      "native publication",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("uses only the target's native D1 and public-source R2 bindings", () => {
  const config = {
    account_id: "synthetic-account",
    compatibility_date: "2026-09-30",
    d1_databases: [{ binding: "DB", database_id: "local-db" }],
    r2_buckets: [
      { binding: "ASSETS_BUCKET", bucket_name: "local-assets" },
      { binding: "SPEAKER_UPLOADS_BUCKET", bucket_name: "local-portraits" },
      { binding: "PRIVATE_UPLOADS", bucket_name: "private" },
    ],
  };
  expect(publicationBindingConfig(config, "local")).toMatchObject({
    d1_databases: [{ database_id: "local-db", remote: false }],
    r2_buckets: [
      { bucket_name: "local-assets", remote: false },
      { bucket_name: "local-portraits", remote: false },
    ],
  });
});

it("publishes a preview from the production Worker's previews bindings only", () => {
  const config = {
    account_id: "synthetic-account",
    compatibility_date: "2026-09-30",
    d1_databases: [{ binding: "DB", database_id: "production-db" }],
    r2_buckets: [{ binding: "ASSETS_BUCKET", bucket_name: "production-assets" }],
    previews: {
      d1_databases: [{ binding: "DB", database_name: "preview-database", database_id: "preview-db" }],
      r2_buckets: [
        { binding: "ASSETS_BUCKET", bucket_name: "preview-assets" },
        { binding: "SPEAKER_UPLOADS_BUCKET", bucket_name: "preview-portraits" },
      ],
    },
  };
  const bindings = publicationBindingConfig(config, "preview");
  expect(bindings).toMatchObject({
    d1_databases: [{ database_id: "preview-db", remote: true }],
    r2_buckets: [
      { bucket_name: "preview-assets", remote: true },
      { bucket_name: "preview-portraits", remote: true },
    ],
  });
  expect(JSON.stringify(bindings)).not.toContain("production");
  expect(() => publicationBindingConfig({ ...config, previews: undefined }, "preview")).toThrow(/previews bindings/);
});

it("keeps production publication on its deployment resources", () => {
  const environment = "production";
  const config = {
    account_id: "synthetic-account",
    compatibility_date: "2026-09-30",
    d1_databases: [
      {
        binding: "DB",
        database_name: `${environment}-database`,
        database_id: `${environment}-database-id`,
        preview_database_id: "development-database-id",
      },
    ],
    r2_buckets: [
      {
        binding: "ASSETS_BUCKET",
        bucket_name: `${environment}-assets`,
        preview_bucket_name: "development-assets",
        jurisdiction: "eu",
      },
    ],
  };
  const bindings = publicationBindingConfig(config, environment);
  expect(bindings.d1_databases[0]).toMatchObject({ database_id: `${environment}-database-id`, remote: true });
  expect(bindings.d1_databases[0]).not.toHaveProperty("preview_database_id");
  expect(bindings.r2_buckets[0]).toMatchObject({ bucket_name: `${environment}-assets`, jurisdiction: "eu" });
  expect(bindings.r2_buckets[0]).not.toHaveProperty("preview_bucket_name");
});

it.each(
  [
    [{ from: "/old/", to: "javascript:alert(1)" }],
    [{ from: "/old/", to: "/safe/\n/other https://example.com 302" }],
    [{ from: "/old path/", to: "/safe/" }],
    [
      { from: "/old/", to: "/safe/" },
      { from: "/old/", to: "/other/" },
    ],
  ].map((redirects) => ({ redirects })),
)("rejects redirect rules that cannot safely enter an edge release: %j", ({ redirects }) => {
  expect(
    sitePublicationReleaseSchema.safeParse({
      version: 1,
      source: "native",
      snapshotId: "2".repeat(64),
      environment: "preview",
      files: ["index.html"],
      redirects,
    }).success,
  ).toBe(false);
});

it("keeps conference exports public while excluding them from indexing and removes withdrawn header rules", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-conference-release-"));
  const source = resolve(root, "source");
  const destination = resolve(root, "destination");
  const files = ["events/conference/event-data.json", "events/conference/agenda.ics"];
  const publish = async (ownedFiles: string[]) => {
    await writeFile(
      resolve(source, "publication.json"),
      JSON.stringify({
        version: 1,
        source: "native",
        snapshotId: "3".repeat(64),
        sourceSequence: 0,
        integrity: await createReleaseIntegrity(source, ownedFiles),
        environment: "production",
        files: ownedFiles,
        redirects: [],
      }),
    );
    await assembleStaticRelease(source, destination, "production");
    return readFile(resolve(destination, "_headers"), "utf8");
  };
  try {
    await mkdir(resolve(source, "events/conference"), { recursive: true });
    await writeFile(resolve(source, files[0]), "{}");
    await writeFile(resolve(source, files[1]), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    const headers = await publish(files);
    expect(headers).toContain("Cache-Control: public, max-age=0, must-revalidate");
    for (const file of files) {
      expect(headers).toContain(`/${file}\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive`);
    }
    await writeFile(resolve(source, "index.html"), "current home");
    const withdrawnHeaders = await publish(["index.html"]);
    for (const file of files) {
      expect(withdrawnHeaders).not.toContain(`/${file}`);
      await expect(readFile(resolve(destination, file))).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
