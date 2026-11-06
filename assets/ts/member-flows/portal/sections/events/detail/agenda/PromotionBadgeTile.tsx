import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { PromotionTile } from "./PromotionTile";

function withQuery(url: string, query: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/** The same badge preview and formats for participant and organizer galleries. */
export function PromotionBadgeTile({ badgeUrl }: { badgeUrl: string }) {
  return (
    <PromotionTile
      name="Badge"
      detail="Wide, square · JPEG"
      previewSrc={withQuery(badgeUrl, "thumbnail=1")}
      previewAlt="Preview of your badge"
      action={
        <DownloadAction
          label="Download badge (JPEG)"
          menuLabel="Download badge formats"
          options={[
            {
              id: "landscape",
              label: "Wide badge (JPEG)",
              href: withQuery(badgeUrl, "download=1"),
            },
            {
              id: "square",
              label: "Square badge (JPEG)",
              href: withQuery(badgeUrl, "format=square&download=1"),
            },
          ]}
        />
      }
    />
  );
}
