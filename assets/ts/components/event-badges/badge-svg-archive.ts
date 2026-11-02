import { badgeLabelSvg } from "../../../shared/badge-label-svg";
import { downloadZip } from "client-zip";
import type { PrintableBadgePrint } from "./badge-print-artifacts";

/** Render complete attendee labels; filenames contain no personal information. */
export async function badgeSvgArchive(
  badges: readonly PrintableBadgePrint[],
  widthMm = 90.3,
  heightMm = 38,
): Promise<Blob> {
  const digits = Math.max(4, String(badges.length).length);
  return downloadZip(
    badges.map((badge, index) => ({
      name: `badge-${String(index + 1).padStart(digits, "0")}.svg`,
      input: badgeLabelSvg({ ...badge, jobTitle: badge.jobTitle ?? null }, widthMm, heightMm),
      lastModified: new Date("2020-01-01T00:00:00.000Z"),
    })),
    { buffersAreUTF8: true },
  ).blob();
}
