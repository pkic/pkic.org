import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import * as pagefind from "pagefind";
import { gunzipSync } from "node:zlib";
import { indexPublicPages } from "../../scripts/publication/index-public-pages.mjs";

afterAll(async () => {
  await pagefind.close();
});

it("excludes noindex workflow content marked by the shared page layout", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-publication-search-"));
  try {
    await writeFile(
      resolve(output, "index.html"),
      '<html lang="en"><body><main data-pagefind-body><h1>Public event overview</h1></main></body></html>',
    );
    await writeFile(
      resolve(output, "registration.html"),
      '<html lang="en"><head><meta name="robots" content="noindex"></head><body><main data-pagefind-ignore="all"><div data-pagefind-body><h1>Event registration</h1><p>Manage this registration</p></div></main></body></html>',
    );
    expect(await indexPublicPages(output)).toEqual({ indexedPages: 1 });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

it("indexes published member HTML and excludes a withdrawn member from a clean release", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-publication-search-"));
  try {
    const member = resolve(output, "members", "synthetic");
    await mkdir(member, { recursive: true });
    await writeFile(
      resolve(member, "index.html"),
      '<html lang="en"><head><title>Synthetic member</title><meta name="pagefind:image" content="/img/member-logo.svg" data-pagefind-meta="image[content]"></head><body><main data-pagefind-body><h1>Synthetic member</h1><p>Published database content</p><img src="/img/representative-headshot.jpg" alt="Representative"></main></body></html>',
    );
    expect(await indexPublicPages(output)).toEqual({ indexedPages: 1 });
    const firstEntry = await readFile(resolve(output, "pagefind", "pagefind-entry.json"), "utf8");
    expect(JSON.parse(firstEntry).languages.en.page_count).toBe(1);
    const searchDirectory = resolve(output, "pagefind");
    const searchFiles = await readdir(searchDirectory, { recursive: true, withFileTypes: true });
    expect(searchFiles.some((file) => file.name === "pagefind.js")).toBe(true);
    expect(searchFiles.some((file) => file.name.endsWith(".pf_fragment"))).toBe(true);
    const fragment = searchFiles.find((file) => file.name.endsWith(".pf_fragment"))!;
    const serialized = gunzipSync(await readFile(resolve(fragment.parentPath, fragment.name))).toString("utf8");
    const indexed = JSON.parse(serialized.slice("pagefind_dcd".length));
    expect(indexed.meta.image).toBe("/img/member-logo.svg");
    for (const file of searchFiles.filter((file) => file.isFile())) {
      expect((await readFile(resolve(file.parentPath, file.name))).byteLength, file.name).toBeGreaterThan(0);
    }

    await rm(member, { recursive: true });
    await writeFile(
      resolve(output, "index.html"),
      '<html lang="en"><head><title>Home</title></head><body><main data-pagefind-body><h1>Home</h1></main></body></html>',
    );
    expect(await indexPublicPages(output)).toEqual({ indexedPages: 1 });
    const secondEntry = await readFile(resolve(output, "pagefind", "pagefind-entry.json"), "utf8");
    expect(secondEntry).not.toBe(firstEntry);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
