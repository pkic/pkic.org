import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { expect, it } from "vitest";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { preparePublicationPublicAssets } from "../../scripts/publication/prepare-public-assets.mjs";
import { publicationBindingConfig } from "../../scripts/publication/binding-config.mjs";

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
    d1_databases: [{ binding: "DB", database_id: "preview-db" }],
    r2_buckets: [
      { binding: "ASSETS_BUCKET", bucket_name: "preview-assets" },
      { binding: "SPEAKER_UPLOADS_BUCKET", bucket_name: "preview-portraits" },
      { binding: "PRIVATE_UPLOADS", bucket_name: "private" },
    ],
  };
  expect(publicationBindingConfig(config, "preview")).toMatchObject({
    d1_databases: [{ database_id: "preview-db", remote: true }],
    r2_buckets: [
      { bucket_name: "preview-assets", remote: true },
      { bucket_name: "preview-portraits", remote: true },
    ],
  });
  expect(publicationBindingConfig(config, "local").d1_databases[0].remote).toBe(false);
});

it.each(["preview", "production"])("keeps %s publication on its deployment resources", (environment) => {
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
