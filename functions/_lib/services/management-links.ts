/**
 * Semantic links into the currently supported staff-management surfaces.
 *
 * Keep route knowledge here instead of making services and notification
 * producers concatenate UI routes independently. Each destination moves here
 * when its canonical management surface changes.
 */

export const PORTAL_UI_PATH = "/portal/";

export type ManagementLink =
  | { kind: "mcp-oauth"; returnTo: string; token?: string; error?: string }
  | { kind: "organization-content-reviews" }
  | { kind: "membership-application"; id: string }
  | { kind: "sponsorship-list" }
  | { kind: "sponsorship"; id: string };

function portalHashUrl(appBaseUrl: string, path: string): URL {
  const url = new URL(PORTAL_UI_PATH, appBaseUrl);
  url.hash = `#${path.startsWith("/") ? path : `/${path}`}`;
  return url;
}

function portalHashUrlWithQuery(appBaseUrl: string, path: string, query: URLSearchParams): URL {
  const url = portalHashUrl(appBaseUrl, path);
  url.hash = `${url.hash}?${query.toString()}`;
  return url;
}

/** Build a same-origin URL for a known management destination. */
export function buildManagementLink(appBaseUrl: string, link: ManagementLink): string {
  switch (link.kind) {
    case "mcp-oauth": {
      const query = new URLSearchParams({ return_to: link.returnTo });
      if (link.token) query.set("token", link.token);
      if (link.error) query.set("error", link.error);
      return portalHashUrlWithQuery(appBaseUrl, "/auth/oauth", query).toString();
    }
    case "organization-content-reviews":
      return portalHashUrl(appBaseUrl, "/system/organization-content-reviews").toString();
    case "membership-application":
      return portalHashUrl(appBaseUrl, `/membership/applications/${encodeURIComponent(link.id)}`).toString();
    case "sponsorship-list":
      return portalHashUrl(appBaseUrl, "/sponsors").toString();
    case "sponsorship":
      return portalHashUrl(appBaseUrl, `/sponsors/${encodeURIComponent(link.id)}`).toString();
  }
}
