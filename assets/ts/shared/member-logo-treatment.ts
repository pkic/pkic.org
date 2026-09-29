/** Choose whether monochrome artwork needs inversion, preserving its internal contrast. */
export type LogoInk = "light" | "dark";

export function classifyLogoInk(pixels: Uint8ClampedArray, width: number): LogoInk {
  const luminance = (offset: number) =>
    0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
  let transparent = false;
  let ink = 0;
  let coverage = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255;
    transparent ||= alpha < 1;
    ink += luminance(offset) * alpha;
    coverage += alpha;
  }
  if (transparent) return coverage && ink / coverage >= 128 ? "light" : "dark";
  // An opaque asset carries a background. Its corners determine which ink
  // treatment removes that ground through the theme's multiply/screen blend.
  const corners = [0, (width - 1) * 4, pixels.length - width * 4, pixels.length - 4];
  const background = corners.reduce((sum, offset) => sum + luminance(offset), 0) / corners.length;
  return background >= 128 ? "dark" : "light";
}

const treatments = new Map<string, LogoInk>();

/** Analyze a small thumbnail once per URL; cross-origin assets retain the default. */
export function prepareMemberLogo(image: HTMLImageElement): void {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const key = image.currentSrc || image.src;
  const cached = treatments.get(key);
  if (cached) {
    image.dataset.logoInk = cached;
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  try {
    context.drawImage(image, 0, 0, 16, 16);
    const treatment = classifyLogoInk(context.getImageData(0, 0, 16, 16).data, 16);
    treatments.set(key, treatment);
    image.dataset.logoInk = treatment;
  } catch {
    // A remote logo without CORS permission still uses the theme's default filter.
  }
}
