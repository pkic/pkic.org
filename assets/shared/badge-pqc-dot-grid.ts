import { constants } from "../design/tokens";

/** The key visual's fine dot grid, fading in toward the right edge of the header field. */
export function pqcBadgeDotGridSvg(): string {
  const token = constants["pqc-dots-fine"];
  const read = (name: string) => new RegExp(`${name}='([^']+)'`).exec(token)?.[1];
  const [size, cx, radius, fill] = [read("width"), read("cx"), read("r"), read("fill")];
  if (!size || !cx || !radius || !fill) throw new Error("The PQC dot grid token changed; review the badge preset.");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 232"><defs><pattern id="dots" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><circle cx="${cx}" cy="${cx}" r="${radius}" fill="${fill}"/></pattern><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="reveal"><rect width="420" height="232" fill="url(#fade)"/></mask></defs><rect width="420" height="232" fill="url(#dots)" mask="url(#reveal)"/></svg>`;
}
