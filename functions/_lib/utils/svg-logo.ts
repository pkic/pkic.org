/**
 * Organization logos are SVG-only, and every upload is rebuilt server-side:
 * the file is parsed by resvg's usvg tree and re-serialized, so scripts,
 * event handlers, metadata, comments, DOCTYPEs, and editor cruft cannot
 * survive by construction (sanitization by reconstruction, not by
 * blocklist). On top of that the logo is normalized for embedding anywhere:
 * full-canvas background fills are dropped, the viewBox is tightened to the
 * painted pixels inside the original viewBox, and the root width/height are
 * removed so the logo scales with its container.
 */
import { AppError } from "../errors";
import { ensureResvgWasm } from "./resvg";

type ResvgConstructor = Awaited<ReturnType<typeof ensureResvgWasm>>;

export const SVG_LOGO_CONTENT_TYPE = "image/svg+xml";

export const SVG_LOGO_LIVE_TEXT_MESSAGE =
  "This logo uses live text. Export it with text converted to outlines (paths) and upload it again.";

/** `<text>`, `<tspan>`, and `<textPath>`, with or without a namespace prefix. */
const LIVE_TEXT_ELEMENT = /<(?:[\w-]+:)?(?:text|tspan|textpath)\b/i;

const DRAWABLE_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "use"]);

function invalid(message: string): AppError {
  return new AppError(415, "INVALID_SVG_LOGO", message);
}

function decodeSvgText(buffer: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw invalid("The logo must be a UTF-8 encoded SVG file.");
  }
  return text.replace(/^\uFEFF/, "").trim();
}

function rootCanvas(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const viewBox = /viewBox\s*=\s*["']\s*([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(
    root,
  );
  if (viewBox) return { width: Number(viewBox[3]), height: Number(viewBox[4]) };
  const width = /[\s"']width\s*=\s*["']([\d.]+)(?:px)?["']/.exec(root);
  const height = /[\s"']height\s*=\s*["']([\d.]+)(?:px)?["']/.exec(root);
  if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  return null;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`[\\s"']${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return match ? match[1] : null;
}

function coversCanvas(rectTag: string, canvas: { width: number; height: number }): boolean {
  const length = (value: string | null, full: number): number | null => {
    if (value === null) return null;
    if (value.trim().endsWith("%")) return (Number.parseFloat(value) / 100) * full;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const x = length(attribute(rectTag, "x"), canvas.width) ?? 0;
  const y = length(attribute(rectTag, "y"), canvas.height) ?? 0;
  const width = length(attribute(rectTag, "width"), canvas.width);
  const height = length(attribute(rectTag, "height"), canvas.height);
  if (width === null || height === null) return false;
  const epsilonX = canvas.width * 0.02;
  const epsilonY = canvas.height * 0.02;
  return (
    x <= epsilonX && y <= epsilonY && width >= canvas.width - epsilonX * 2 && height >= canvas.height - epsilonY * 2
  );
}

const NON_PAINTED_CONTAINERS = new Set([
  "defs",
  "clippath",
  "mask",
  "symbol",
  "pattern",
  "lineargradient",
  "radialgradient",
  "filter",
]);

/**
 * Drops a decorative background: a full-canvas <rect> that is the first
 * PAINTED drawable in document order. Rects inside non-painted containers
 * (defs, clipPath, masks, gradients…) are ignored, and only paint-order-first
 * rects qualify, so a rectangle that is part of the artwork is never touched.
 */
function stripBackgroundRects(svg: string): string {
  const canvas = rootCanvas(svg);
  if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)) return svg;
  let output = svg;
  for (let round = 0; round < 3; round += 1) {
    const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
    let nonPaintedDepth = 0;
    let removed = false;
    let sawDrawable = false;
    for (let match = tagPattern.exec(output); match; match = tagPattern.exec(output)) {
      const [tag, closing, rawName, selfClose] = [match[0], match[1] === "/", match[2].toLowerCase(), match[3] === "/"];
      if (NON_PAINTED_CONTAINERS.has(rawName)) {
        if (!selfClose) nonPaintedDepth += closing ? -1 : 1;
        continue;
      }
      if (closing || nonPaintedDepth > 0 || !DRAWABLE_TAGS.has(rawName)) continue;
      sawDrawable = true;
      if (rawName === "rect" && coversCanvas(tag, canvas)) {
        const end = selfClose ? match.index + tag.length : output.indexOf("</rect>", match.index) + "</rect>".length;
        if (end > match.index) {
          output = output.slice(0, match.index) + output.slice(end);
          removed = true;
        }
      }
      break;
    }
    if (!removed || !sawDrawable) break;
  }
  return output;
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longest side, in pixels, of the coverage raster that measures the painted extent. */
const COVERAGE_RASTER_SIZE = 1024;

function serializedViewBox(svg: string): CanvasRect | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  const values = root
    ? attribute(root, "viewBox")
        ?.trim()
        .split(/[\s,]+/)
        .map(Number)
    : undefined;
  if (!values || values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/**
 * Measures the painted extent by rasterizing the parsed tree inside its own
 * viewBox. resvg's geometric bounding boxes are not reliable enough to crop
 * by: `innerBBox()` tests each top-level element against the viewBox in the
 * element's untransformed coordinates, so transformed artwork is dropped or
 * clipped, and `getBBox()` underestimates miter joins and ignores filters.
 * Coverage is what the logo actually shows (transforms, strokes, markers,
 * clip paths, and filter effects included), and every partially covered
 * edge pixel counts, so the result never cuts visible content. Content that
 * reaches a raster edge keeps the original viewBox edge on that side.
 */
function paintedExtent(Resvg: ResvgConstructor, normalizedSvg: string, canvas: CanvasRect): CanvasRect | null {
  const fitTo =
    canvas.width >= canvas.height
      ? { mode: "width" as const, value: COVERAGE_RASTER_SIZE }
      : { mode: "height" as const, value: COVERAGE_RASTER_SIZE };
  const measure = new Resvg(stripRootDimensions(normalizedSvg), { fitTo });
  try {
    const image = measure.render();
    try {
      const { width, height, pixels } = image;
      let [minX, minY, maxX, maxY] = [width, height, -1, -1];
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          if (pixels[(row * width + column) * 4 + 3] === 0) continue;
          if (column < minX) minX = column;
          if (column > maxX) maxX = column;
          if (row < minY) minY = row;
          maxY = row;
        }
      }
      if (maxX < 0) return null;
      const unitsPerPixel = fitTo.mode === "width" ? canvas.width / width : canvas.height / height;
      const right = canvas.x + canvas.width;
      const bottom = canvas.y + canvas.height;
      const x = minX === 0 ? canvas.x : canvas.x + minX * unitsPerPixel;
      const y = minY === 0 ? canvas.y : canvas.y + minY * unitsPerPixel;
      const x2 = maxX === width - 1 ? right : Math.min(right, canvas.x + (maxX + 1) * unitsPerPixel);
      const y2 = maxY === height - 1 ? bottom : Math.min(bottom, canvas.y + (maxY + 1) * unitsPerPixel);
      return { x, y, width: x2 - x, height: y2 - y };
    } finally {
      image.free();
    }
  } finally {
    measure.free();
  }
}

/** Removes fixed dimensions from the root element so the logo fills its container. */
function stripRootDimensions(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (root) =>
    root.replace(/\s(?:width|height)\s*=\s*["'][^"']*["']/g, "").replace(/\sstyle\s*=\s*["'][^"']*["']/g, ""),
  );
}

export interface SanitizedSvgLogo {
  buffer: ArrayBuffer;
  contentType: typeof SVG_LOGO_CONTENT_TYPE;
}

export async function sanitizeSvgLogo(buffer: ArrayBuffer): Promise<SanitizedSvgLogo> {
  const text = decodeSvgText(buffer);
  if (!/<svg\b/i.test(text)) {
    throw invalid("Only SVG logos are accepted.");
  }
  // XML entities and DOCTYPEs enable XXE-style tricks; a logo needs neither.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw invalid("The SVG must not contain a DOCTYPE or entity declarations.");
  }
  // A logo must be pure vector: embedded rasters defeat the point of SVG and
  // are the usual base64 payload carrier.
  if (/<image\b/i.test(text) || /data:image\//i.test(text)) {
    throw invalid("The SVG must be pure vector artwork — embedded raster images are not allowed.");
  }
  // The sanitizer loads no fonts, so live text would be silently dropped from
  // the rebuilt logo. Refuse it instead of storing a logo without lettering.
  if (LIVE_TEXT_ELEMENT.test(text.replace(/<!--[\s\S]*?-->/g, ""))) {
    throw invalid(SVG_LOGO_LIVE_TEXT_MESSAGE);
  }

  const withoutBackground = stripBackgroundRects(text);

  const Resvg = await ensureResvgWasm();
  let resvg: InstanceType<typeof Resvg>;
  try {
    resvg = new Resvg(withoutBackground);
  } catch {
    throw invalid("The SVG could not be parsed.");
  }
  try {
    const parsed = resvg.toString();
    const canvas = serializedViewBox(parsed);
    // Without a measurable canvas the original viewBox is kept untightened.
    if (canvas) {
      const extent = paintedExtent(Resvg, parsed, canvas);
      // getBBox() only supplies the wasm BBox handle that cropByBBox accepts.
      const bbox = extent && extent.width > 0 && extent.height > 0 ? resvg.getBBox() : undefined;
      if (!extent || !bbox) {
        throw invalid("The SVG has no visible content.");
      }
      try {
        Object.assign(bbox, extent);
        resvg.cropByBBox(bbox);
      } finally {
        bbox.free();
      }
    }
    const normalized = stripRootDimensions(resvg.toString());
    if (!/<svg\b/i.test(normalized)) {
      throw invalid("The SVG could not be normalized.");
    }
    return { buffer: new TextEncoder().encode(normalized).buffer as ArrayBuffer, contentType: SVG_LOGO_CONTENT_TYPE };
  } finally {
    resvg.free();
  }
}
