import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontMatter } from "../../functions/_lib/services/site-markdown.ts";

/** Authored webinar sponsors are historical page assets, not directory lookups. */
export function webinarSponsors(projectRoot) {
  const sponsors = {};
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path, relative);
      else if (entry.name.endsWith(".md")) {
        const { data } = parseFrontMatter(readFileSync(path, "utf8"));
        if (data.layout !== "webinar" && data.params?.eventType !== "webinar") continue;
        const slug = data.params?.sponsor;
        if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) continue;
        const logo = ["svg", "png"]
          .map((extension) => `images/members/${slug}/${slug}.${extension}`)
          .find((asset) => existsSync(resolve(projectRoot, "assets", asset)));
        sponsors[relative.replace(/\.md$/, "")] = {
          name: data.params?.sponsorName ?? slug,
          logoSrc: logo ? `/${logo}` : undefined,
        };
      }
    }
  }
  visit(resolve(projectRoot, "content"));
  return sponsors;
}
