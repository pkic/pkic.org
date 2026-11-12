import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { downloadUrl } from "../../../../../../shared/download-file";
import { PromotionTile, type PromotionTileSelection } from "./PromotionTile";

function withQuery(url: string, query: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

const badges = [
  { format: "badge-landscape", name: "Wide badge", ratio: "1.91:1", query: "" },
  { format: "badge-square", name: "Square badge", ratio: "1:1", query: "format=square&" },
] as const;

/** The badge in both shapes, one card and one download each, for participant and organizer galleries. */
export function PromotionBadgeTiles({
  badgeUrl,
  select,
}: {
  badgeUrl: string;
  select?: (format: (typeof badges)[number]["format"], download: () => Promise<void>) => PromotionTileSelection;
}) {
  return (
    <>
      {badges.map((badge) => {
        const href = withQuery(badgeUrl, `${badge.query}download=1`);
        return (
          <PromotionTile
            key={badge.format}
            name={badge.name}
            ratio={badge.ratio}
            previewSrc={withQuery(badgeUrl, `${badge.query}thumbnail=1`)}
            previewAlt={`Preview of your ${badge.name.toLowerCase()}`}
            selection={select?.(badge.format, async () => downloadUrl(href))}
            action={<DownloadAction label={`Download ${badge.name.toLowerCase()} (JPEG)`} href={href} />}
          />
        );
      })}
    </>
  );
}
