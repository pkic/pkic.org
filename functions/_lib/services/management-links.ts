/**
 * Semantic links into the currently supported staff-management surfaces.
 *
 * Keep route knowledge here instead of making services and notification
 * producers concatenate UI routes independently. Each destination moves here
 * when its canonical management surface changes.
 */

export const ADMIN_UI_PATH = "/admin/";
export const MCP_OAUTH_UI_PATH = ADMIN_UI_PATH;

export type ManagementLink =
  | { kind: "admin-sign-in"; token: string }
  | { kind: "mcp-oauth"; returnTo: string; token?: string; error?: string }
  | { kind: "organization-content-reviews" }
  | { kind: "membership-application"; id: string }
  | { kind: "sponsorship-list" }
  | { kind: "sponsorship"; id: string };

function adminHashUrl(appBaseUrl: string, path: string): URL {
  const url = new URL(ADMIN_UI_PATH, appBaseUrl);
  url.hash = `#${path.startsWith("/") ? path : `/${path}`}`;
  return url;
}

function portalHashUrl(appBaseUrl: string, path: string): URL {
  const url = new URL("/portal/", appBaseUrl);
  url.hash = `#${path.startsWith("/") ? path : `/${path}`}`;
  return url;
}

/** Build a same-origin URL for a known management destination. */
export function buildManagementLink(appBaseUrl: string, link: ManagementLink): string {
  switch (link.kind) {
    case "admin-sign-in": {
      const url = new URL(ADMIN_UI_PATH, appBaseUrl);
      url.searchParams.set("token", link.token);
      return url.toString();
    }
    case "mcp-oauth": {
      const url = new URL(MCP_OAUTH_UI_PATH, appBaseUrl);
      url.searchParams.set("flow", "mcp-oauth");
      url.searchParams.set("return_to", link.returnTo);
      if (link.token) url.searchParams.set("token", link.token);
      if (link.error) url.searchParams.set("error", link.error);
      return url.toString();
    }
    case "organization-content-reviews":
      return portalHashUrl(appBaseUrl, "/system/organization-content-reviews").toString();
    case "membership-application":
      return portalHashUrl(appBaseUrl, `/system/membership-applications/${encodeURIComponent(link.id)}`).toString();
    case "sponsorship-list":
      return adminHashUrl(appBaseUrl, "/sponsorships").toString();
    case "sponsorship":
      return adminHashUrl(appBaseUrl, `/sponsorships/${encodeURIComponent(link.id)}`).toString();
  }
}
