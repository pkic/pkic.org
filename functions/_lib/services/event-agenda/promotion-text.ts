import fontkit from "@pdf-lib/fontkit";

/** Use the same pinned font outlines for horizontal measures and CSS line-box baselines. */
export function promotionFontMeasure(
  fonts: readonly Uint8Array[],
  extra: { mono?: Uint8Array; monoBold?: Uint8Array; medium?: Uint8Array } = {},
) {
  const faces = [fontkit.create(fonts[0]!), fontkit.create(fonts[1]!)];
  const optional = (bytes?: Uint8Array) => (bytes?.length ? fontkit.create(bytes) : null);
  const mono = optional(extra.mono),
    monoBold = optional(extra.monoBold),
    medium = optional(extra.medium);
  const faceFor = (bold: boolean, monospaced = false, weight?: number) =>
    (monospaced ? (bold ? (monoBold ?? mono) : mono) : weight === 500 ? medium : null) ?? faces[bold ? 1 : 0]!;
  const measure = (text: string, size: number, bold: boolean, monospaced = false, weight?: number) => {
    const face = faceFor(bold, monospaced, weight);
    return (
      (face.layout(text).positions.reduce((sum: number, position: { xAdvance: number }) => sum + position.xAdvance, 0) *
        size) /
      face.unitsPerEm
    );
  };
  return Object.assign(measure, {
    metrics(size: number, bold: boolean, monospaced = false, weight?: number) {
      const face = faceFor(bold, monospaced, weight);
      return {
        ascent: (face.ascent * size) / face.unitsPerEm,
        descent: (face.descent * size) / face.unitsPerEm,
        lineGap: (face.lineGap * size) / face.unitsPerEm,
      };
    },
  });
}

/** Wrap complete text to measured line widths, splitting an oversized word only when necessary. */
export function promotionMeasuredLines(text: string, width: number, measure: (text: string) => number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      result.push(line);
      line = "";
    }
    for (const glyph of Array.from(word)) {
      if (line && measure(line + glyph) > width) {
        result.push(line);
        line = "";
      }
      line += glyph;
    }
  }
  if (line) result.push(line);
  return result;
}

/** CSS text-wrap:balance keeps the line count while distributing whole words. */
export function promotionBalancedLines(text: string, width: number, measure: (text: string) => number): string[] {
  const initial = promotionMeasuredLines(text, width, measure);
  if (initial.length < 2) return initial;
  let low = Math.min(width, Math.max(...text.trim().split(/\s+/u).map(measure))),
    high = width;
  for (let step = 0; step < 16; step++) {
    const trial = (low + high) / 2;
    if (promotionMeasuredLines(text, trial, measure).length <= initial.length) high = trial;
    else low = trial;
  }
  return promotionMeasuredLines(text, high, measure);
}

/** Prefer breaks between complete metadata fields, preserving short room names and clock labels. */
export function promotionSegmentLines(segments: string[], width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const segment of segments.map((value) => value.trim()).filter(Boolean)) {
    const candidate = line ? `${line} · ${segment}` : segment;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    const wrapped = promotionMeasuredLines(segment, width, measure);
    lines.push(...wrapped.slice(0, -1));
    line = wrapped.at(-1) ?? "";
  }
  if (line) lines.push(line);
  return lines;
}

/** Make a bounded image label visibly abbreviated rather than spilling onto another image. */
export function promotionEllipsisLines(
  lines: string[],
  maxLines: number,
  width: number,
  measure: (text: string) => number,
): string[] {
  if (lines.length <= maxLines) return lines;
  if (maxLines < 1) return [];
  const result = lines.slice(0, maxLines);
  let last = result.at(-1)!;
  while (last && measure(`${last}…`) > width) last = Array.from(last).slice(0, -1).join("");
  result[result.length - 1] = `${last.trimEnd()}…`;
  return result;
}
