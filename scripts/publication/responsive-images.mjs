import { createHash, randomUUID } from "node:crypto";
import { mkdir, access, writeFile, copyFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const WIDTHS = [64, 128, 256, 384, 640, 960, 1280, 1920];
const FORMATS = { avif: { quality: 55, effort: 2 }, webp: { quality: 82, effort: 4 } };

/** Inspect SVG coordinate spaces at a density bounded by their rendering target. */
export async function boundedImageSource(bytes, { maxWidth, maxHeight, limitInputPixels }) {
  let input = { limitInputPixels };
  let metadata;
  try {
    metadata = await sharp(bytes, input).metadata();
  } catch (cause) {
    // SVG coordinate units need not be pixels. Inspect an oversized vector at
    // low density, keeping the same pixel limit rather than disabling it.
    const probe = { limitInputPixels, density: 1 };
    try {
      metadata = await sharp(bytes, probe).metadata();
    } catch {
      throw cause;
    }
    if (metadata.format !== "svg") throw cause;
    input = probe;
  }
  if (metadata.format === "svg") {
    const scale = Math.min(maxWidth / metadata.width, maxHeight ? maxHeight / metadata.height : 1);
    input = { ...input, density: Math.min(72, Math.max(1, Math.ceil((input.density ?? 72) * scale))) };
    metadata = await sharp(bytes, input).metadata();
  }
  return { input, metadata };
}

/**
 * Build immutable, metadata-free derivatives once per source and encoding policy.
 * @param {Buffer} bytes
 * @param {string} output
 * @param {{maxWidth?: number, maxHeight?: number, preserveAnimation?: boolean, limitInputPixels?: number}} options
 */
export async function publishResponsiveImage(
  bytes,
  output,
  { maxWidth = 1920, maxHeight, preserveAnimation = true, limitInputPixels = 40_000_000 } = {},
) {
  const { input, metadata } = await boundedImageSource(bytes, { maxWidth, maxHeight, limitInputPixels });
  if (
    !["svg", "png", "jpeg", "gif", "webp", "avif"].includes(metadata.format) &&
    !(metadata.format === "heif" && metadata.compression === "av1")
  )
    throw new Error("A published image has an unsupported file format");
  if (preserveAnimation && (metadata.pages ?? 1) > 1) return null; // Preserve authored animation.
  const dimensions = metadata.autoOrient;
  const scale = Math.min(1, maxWidth / dimensions.width, maxHeight ? maxHeight / dimensions.height : 1);
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const widths = [...WIDTHS.filter((candidate) => candidate < width), width];
  const policy = JSON.stringify({
    version: 1,
    widths,
    FORMATS,
    encoder: sharp.versions.sharp,
    vips: sharp.versions.vips,
    density: input.density,
  });
  const sourceHash = createHash("sha256").update(bytes).update(policy).digest("hex");
  // Workers Builds retains Astro's documented cache directory when build caching is enabled.
  const cache = resolve(
    process.env.PKIC_PUBLICATION_IMAGE_CACHE ?? "node_modules/.astro/publication-images",
    sourceHash,
  );
  const destination = resolve(output, "_published", "images");
  await Promise.all([mkdir(cache, { recursive: true }), mkdir(destination, { recursive: true })]);
  const formats = {};
  // Keep encoding sequential: AVIF encoders already use libvips' bounded thread pool.
  for (const [format, options] of Object.entries(FORMATS)) {
    formats[format] = [];
    for (const targetWidth of widths) {
      const filename = `${sourceHash}-${targetWidth}.${format}`;
      const cached = resolve(cache, filename);
      try {
        await access(cached);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const derivative = await sharp(bytes, input)
          .rotate()
          .resize({ width: targetWidth, withoutEnlargement: true })
          .toFormat(format, options)
          .toBuffer();
        const temporary = `${cached}.${randomUUID()}.tmp`;
        await writeFile(temporary, derivative);
        await rename(temporary, cached);
      }
      await copyFile(cached, resolve(destination, filename));
      formats[format].push({ src: `/_published/images/${filename}`, width: targetWidth });
    }
  }
  return { width, height, formats, src: formats.webp.at(-1).src };
}
