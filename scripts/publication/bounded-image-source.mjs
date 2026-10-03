import sharp from "sharp";

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
