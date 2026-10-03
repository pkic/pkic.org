/**
 * Routes whose page body is a hydration island rather than Markdown.
 *
 * These addresses exist as content pages so their URL, title and chrome stay
 * with the rest of the site, while the body is mounted by the client module
 * named in `data-module`.
 */
const routeIslands: Readonly<Record<string, string>> = {
  "/design/": '<div id="pk-preview" data-module="ui/preview/preview-page"></div>',
  "/meetings/join/": '<div id="meeting-join-app" data-module="member-flows/meeting-join-page"></div>',
  "/members/":
    '<div data-member-directory data-module="member-flows/member-directory-page" data-api-base="/api/v1" data-group="organization" data-prefix="m" data-label="members"></div>',
  "/members/independent/":
    '<div data-member-directory data-module="member-flows/member-directory-page" data-api-base="/api/v1" data-group="independent" data-prefix="i" data-label="independent members"></div>',
  "/members/profile/":
    '<div data-member-detail data-module="member-flows/member-detail-page" data-api-base="/api/v1" data-directory-href="/members/"></div>',
};

export function islandForRoute(route: string): string | undefined {
  if (route === "/m/") return routeIslands["/meetings/join/"];
  if (route.endsWith("/invite/decline/")) return routeIslands["/invite/decline/"];
  return routeIslands[route];
}
