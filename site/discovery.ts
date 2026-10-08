import type { APIContext } from "astro";
import { publishedSnapshotSitemapEntries, renderPublishedDiscovery } from "../functions/_lib/services/site-discovery";
import { publication } from "./publication";

/** Discovery uses the same approved public projection as the generated pages. */
export function GET({ request }: APIContext): Response {
  return renderPublishedDiscovery(request, publishedSnapshotSitemapEntries(publication), {
    allowIndexing: process.env.CLOUDFLARE_ENV === "production",
  });
}
