/** One geometry stylesheet for static publication and the interactive fallback. */
export function agendaLayoutCss(heights: number[]): string {
  const values = [...new Set(heights)].filter((height) => Number.isInteger(height) && height > 0 && height <= 16_384);
  return values.length
    ? `@media(min-width:46.001rem){${values.map((height) => `.pk-content-agenda:not(.is-compact) [data-agenda-height="${height}"]{height:${height}px}`).join("")}}`
    : "";
}
