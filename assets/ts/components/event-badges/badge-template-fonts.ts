import { bytesToBase64 } from "../../../shared/base64";
import { badgeTemplateAssetSchema } from "../../../shared/schemas/event-badge-template";

/** Embed the site's own same-origin WOFF2 files as template font assets, loaded only when a preset needs them. */
export async function loadBadgeTemplateFonts<Key extends string>(
  urls: Readonly<Record<Key, string>>,
): Promise<Record<Key, { mime: "font/woff2"; base64: string }>> {
  const entries = await Promise.all(
    (Object.entries(urls) as [Key, string][]).map(async ([key, url]) => {
      const response = await fetch(new URL(url, location.origin), { credentials: "omit" });
      if (!response.ok) throw new Error("Could not load the badge fonts. Try again.");
      const asset = badgeTemplateAssetSchema.parse({
        mime: "font/woff2",
        base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
      });
      return [key, { mime: "font/woff2" as const, base64: asset.base64 }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Key, { mime: "font/woff2"; base64: string }>;
}
