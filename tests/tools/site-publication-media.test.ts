import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { copyPublicMedia } from "../../scripts/publication/copy-public-media.mjs";

it.each([true, false])(
  "publishes normalized vectors with or without a legacy SVG namespace (%s)",
  async (namespace) => {
    const output = await mkdtemp(resolve(tmpdir(), "pkic-public-media-"));
    try {
      const source = new TextEncoder().encode(
        `<svg ${namespace ? 'xmlns="http://www.w3.org/2000/svg"' : ""} viewBox="0 0 8890 5080"><script>alert(1)</script><rect width="8890" height="5080" fill="green"/></svg>`,
      );
      const result = await copyPublicMedia({
        output,
        snapshot: { logoUrl: "/api/v1/members/synthetic/logo" },
        keys: { "/api/v1/members/synthetic/logo": "private/source-key.svg" },
        getObject: async () => ({ size: source.byteLength, arrayBuffer: async () => source.buffer }),
      });
      expect(result.logoUrl).toMatch(/^\/_published\/media\/[a-f0-9]{64}\.svg$/);
      expect(JSON.stringify(result)).not.toContain("private/source-key");
      const image = await readFile(resolve(output, result.logoUrl.slice(1)));
      expect(image.toString()).toContain("<svg");
      expect(image.toString()).toContain('viewBox="0 0 8890 5080"');
      expect(image.includes(Buffer.from("<script>"))).toBe(false);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);

it("rejects embedded bitmaps in vector artwork", async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
  );
  await expect(
    copyPublicMedia({
      output: "unused",
      snapshot: { imageUrl: "/img/invalid-artwork.svg" },
      keys: { "/img/invalid-artwork.svg": "private/logo.svg" },
      getObject: async () => ({ size: source.length, arrayBuffer: async () => source }),
    }),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining("pure vector") } });
});

it.each([
  Buffer.from("&#xfffd;PNG\r\n"),
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>'),
])("keeps a member with an unusable legacy logo while retaining missing-object failures", async (original) => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-public-media-"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const reference = "/api/v1/members/synthetic/logo";
    const request = {
      output,
      snapshot: { member: { name: "Synthetic member", logoUrl: reference }, memberWall: [{ logoUrl: reference }] },
      keys: { [reference]: "private/damaged.png" },
      getObject: async () => ({ size: original.length, arrayBuffer: async () => original }),
    };
    const result = await copyPublicMedia(request);
    expect(result.member).toEqual({ name: "Synthetic member", logoUrl: null });
    expect(result.memberWall).toEqual([{ logoUrl: "/img/logo.svg" }]);
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private/");
    await expect(copyPublicMedia({ ...request, getObject: async () => null })).rejects.toThrow("missing from R2");
  } finally {
    warning.mockRestore();
    await rm(output, { recursive: true, force: true });
  }
});

it("publishes a bounded optimized derivative while leaving the original intact", async () => {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-public-media-"));
  try {
    const original = await sharp({ create: { width: 2400, height: 1800, channels: 4, background: "green" } })
      .png()
      .toBuffer();
    const before = Buffer.from(original);
    const result = await copyPublicMedia({
      output,
      snapshot: { logoUrl: "/api/v1/members/synthetic/logo" },
      keys: { "/api/v1/members/synthetic/logo": "private/original.png" },
      getObject: async () => ({ size: original.byteLength, arrayBuffer: async () => original }),
    });
    const derivative = await readFile(resolve(output, result.logoUrl.slice(1)));
    const metadata = await sharp(derivative).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1200, height: 900 });
    expect(derivative.length).toBeLessThan(original.length);
    expect(original).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("private/original.png");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
