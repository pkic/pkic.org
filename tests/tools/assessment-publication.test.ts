import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { publishAssessmentScripts } from "../../scripts/publication/publish-assessment-scripts.mjs";

const script = "/* synthetic assessment */";
const license = "Synthetic license";
const integrity = (text: string) => `sha384-${createHash("sha384").update(text).digest("base64")}`;
const release = {
  url: "/_published/assessment/v-test/self-assessment.js",
  sourceUrl: "https://example.test/self-assessment.js",
  integrity: integrity(script),
  licenseIntegrity: integrity(license),
};

it("publishes approved SDK bytes and licenses and rebuilds without contacting upstream", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-assessment-"));
  try {
    const download = vi.fn(async (url: string) => new Response(url.endsWith(".txt") ? license : script));
    const options = { releases: [release], cache: resolve(root, "cache"), download };
    await publishAssessmentScripts(resolve(root, "first"), options);
    await publishAssessmentScripts(resolve(root, "second"), options);
    expect(download).toHaveBeenCalledTimes(2);
    expect(await readFile(resolve(root, `second${release.url}`), "utf8")).toBe(script);
    expect(await readFile(resolve(root, `second${release.url}.LICENSE.txt`), "utf8")).toBe(license);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("replaces a corrupt cached dependency only after verifying its downloaded replacement", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-assessment-"));
  try {
    const cache = resolve(root, "cache");
    const download = vi.fn(async (url: string) => new Response(url.endsWith(".txt") ? license : script));
    const options = { releases: [release], cache, download };
    await publishAssessmentScripts(resolve(root, "first"), options);
    const cachedScript = resolve(cache, createHash("sha256").update(release.integrity).digest("hex"));
    await writeFile(cachedScript, "corrupt cached bytes");
    await publishAssessmentScripts(resolve(root, "second"), options);
    expect(download).toHaveBeenCalledTimes(3);
    expect(await readFile(cachedScript, "utf8")).toBe(script);
    expect(await readFile(resolve(root, `second${release.url}`), "utf8")).toBe(script);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "rejects changed upstream bytes, including after cache corruption (%s)",
  async (corruptCache) => {
    const root = await mkdtemp(resolve(tmpdir(), "pkic-assessment-"));
    try {
      const cache = resolve(root, "cache");
      if (corruptCache) {
        await mkdir(cache);
        await writeFile(resolve(cache, createHash("sha256").update(release.integrity).digest("hex")), "corrupt cache");
      }
      await expect(
        publishAssessmentScripts(resolve(root, "output"), {
          releases: [release],
          cache,
          download: async () => new Response("changed bundle"),
        }),
      ).rejects.toThrow("integrity verification");
      await expect(readFile(resolve(root, `output${release.url}`))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
