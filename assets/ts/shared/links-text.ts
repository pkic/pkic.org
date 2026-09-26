/** One-URL-per-line textarea <-> string[] round-trip, shared by every plain-textarea links editor (profile, organization). */
export function linksToText(links: string[]): string {
  return links.join("\n");
}

export function textToLinks(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
