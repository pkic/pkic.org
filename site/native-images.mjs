import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname } from "node:path";
import { getImage } from "astro:assets";
import { imageMetadata } from "astro/assets/utils";
import sharp from "sharp";
import { publicImageFile } from "../scripts/publication/public-image-source.mjs";
import { publicationStagingDirectory } from "../scripts/publication/build-context.mjs";
import { configureSiteImages } from "../assets/ts/site/SiteImage";

const sourceDirectory = resolve(publicationStagingDirectory(), "public");
const output = resolve("dist/astro");
const originals = new Map();
configureSiteImages(async (source, avatar) => {
  const file = publicImageFile(source, sourceDirectory, { allowSvg: true });
  if (!file) return null;
  // Preserve vector sources and expose intrinsic dimensions without rasterizing logos.
  if (/\.svg(?:[?#]|$)/i.test(source)) {
    if (!originals.has(file))
      originals.set(
        file,
        readFile(file).then((bytes) => imageMetadata(bytes, file)),
      );
    const metadata = await originals.get(file);
    return { src: source, width: metadata.width, height: metadata.height };
  }
  const maxWidth = avatar ? 384 : 1920;
  if (!originals.has(file))
    originals.set(
      file,
      readFile(file).then(async (bytes) => {
        const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
        if ((metadata.pages ?? 1) > 1) return null;
        const hash = createHash("sha256").update(bytes).digest("hex");
        const src = `/_assets/${hash}${extname(file).toLowerCase()}`;
        await mkdir(resolve(output, "_assets"), { recursive: true });
        await writeFile(resolve(output, src.slice(1)), bytes);
        const dimensions = metadata.autoOrient;
        return {
          src,
          width: dimensions.width,
          height: dimensions.height,
          format: metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format,
        };
      }),
    );
  const metadata = await originals.get(file);
  if (!metadata) return null;
  const width = Math.min(metadata.width, maxWidth);
  const widths = [64, 128, 256, 384, 640, 960, 1280].filter((value) => value < width).concat(width);
  const [webp, avif] = await Promise.all([
    getImage({ src: metadata, width, widths, format: "webp", quality: 82 }),
    getImage({ src: metadata, width, widths, format: "avif", quality: 55 }),
  ]);
  return {
    src: webp.src,
    srcSet: webp.srcSet.attribute,
    avifSrcSet: avif.srcSet.attribute,
    width,
    height: Math.round((metadata.height * width) / metadata.width),
  };
});
