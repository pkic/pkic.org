import sharp from "sharp";

const BACKGROUNDS = ["#1f4e79", "#2e7d32", "#6a1b9a", "#ad1457", "#00695c", "#ef6c00", "#37474f", "#283593"];

/** A plain initials portrait, so speaker cards show an image without a real photo. */
export async function initialsHeadshot(person, index) {
  const initials = `${person.firstName[0]}${person.lastName[0]}`.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" fill="${BACKGROUNDS[index % BACKGROUNDS.length]}"/>
<text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="200" fill="#ffffff">${initials}</text>
</svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}
