import fontkit from "@pdf-lib/fontkit";

/** The raster and PDF scene callers measure the same actual font outlines. */
export function promotionFontMeasure(fonts: readonly Uint8Array[]) {
  const faces = [fontkit.create(fonts[0]!), fontkit.create(fonts[1]!)];
  return (text: string, size: number, bold: boolean) => {
    const face = faces[bold ? 1 : 0]!;
    return (
      (face.layout(text).positions.reduce((sum: number, position: { xAdvance: number }) => sum + position.xAdvance, 0) *
        size) /
      face.unitsPerEm
    );
  };
}

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
