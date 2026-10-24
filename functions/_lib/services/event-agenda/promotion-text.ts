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
