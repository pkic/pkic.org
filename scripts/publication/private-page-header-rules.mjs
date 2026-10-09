const eventPrivateEndpoint =
  /^\/events\/[^/]+\/[^/]+\/(register\/(?:confirm|manage)|propose\/(?:manage|speaker|presentation)|invite\/decline|virtual)\/$/;

function htmlRoutes(file) {
  if (!file.endsWith(".html")) return [];
  if (file.endsWith("/index.html")) return ["/" + file.slice(0, -10)];
  return ["/" + file.slice(0, -5), "/" + file];
}

/** Compact only known private child endpoints, never event/agenda or entry pages. */
export function privatePageHeaderRules(privatePaths, files) {
  const paths = new Set(privatePaths);
  if (paths.has("/404.html")) paths.add("/404");
  const generated = files.flatMap(htmlRoutes);
  const endpoints = new Map();
  for (const path of paths) {
    const match = eventPrivateEndpoint.exec(path);
    if (match) {
      const endpoint = match[1];
      const members = endpoints.get(endpoint) ?? [];
      members.push(path);
      endpoints.set(endpoint, members);
    }
  }
  for (const [endpoint, members] of endpoints) {
    if (members.length < 2) continue;
    const matches = new RegExp("^/events/[^/]+/[^/]+/" + endpoint + "/$");
    // A future public route with this endpoint disables compaction for the
    // entire family. The ordinary budget guard still refuses an oversized set.
    if (generated.some((route) => matches.test(route) && !paths.has(route))) continue;
    for (const path of members) paths.delete(path);
    paths.add("/events/:year/:event/" + endpoint + "/");
  }
  return [...paths];
}
