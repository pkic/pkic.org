import type { APIContext } from "astro";
import { renderPublishedDiscovery } from "../functions/_lib/services/site-discovery";
import { memberProfileHref } from "../assets/shared/member-profile-url";
import { publication } from "./publication";

/** Discovery uses the same approved public projection as the generated pages. */
export function GET({ request }: APIContext): Response {
  return renderPublishedDiscovery(
    request,
    publication.members.map((member) => ({ route: memberProfileHref(member) })),
    { allowIndexing: process.env.CLOUDFLARE_ENV === "production" },
  );
}
