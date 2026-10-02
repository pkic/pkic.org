import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { normalizedContentPath, parseFrontMatter, slugify } from "../../functions/_lib/services/site-markdown.ts";

/**
 * Every page's byline, as the page itself records it.
 *
 * A byline is a publication fact: the author's affiliation when the post was
 * written, snapshotted into the post's own `authorProfiles` front matter. It is
 * not a lookup in today's member directory, whose representatives change.
 *
 * This is `layouts/partials/blog/author-data.html` resolved once at build
 * time: a profile's `assetdirectory` holds the author's headshot, filed under
 * their urlized name, and the organization's mark, filed under the directory's
 * own name; an explicit `image` or `logo` names a file instead.
 */

const ASSET_ROOT = "assets";

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** Hugo's `resources.GetMatch "<stem>.*"`: the file of that name, whatever its extension. */
function resourceMatch(projectRoot, stem) {
  const directory = resolve(projectRoot, ASSET_ROOT, dirname(stem));
  if (!existsSync(directory)) return undefined;
  const name = basename(stem);
  const match = readdirSync(directory).find((file) => file.replace(/\.[^.]+$/, "") === name);
  return match ? `${dirname(stem)}/${match}` : undefined;
}

/** Hugo's `resources.Get`: exactly that file. */
function resourceExact(projectRoot, path) {
  return existsSync(resolve(projectRoot, ASSET_ROOT, path)) ? path : undefined;
}

/** A profile's social accounts as plain URLs, which the shared link list names and marks itself. */
function profileLinks(social) {
  if (!social || typeof social !== "object") return undefined;
  const links = [
    ...new Set(Object.values(social).filter((url) => typeof url === "string" && url.startsWith("https://"))),
  ];
  return links.length ? links : undefined;
}

function profilesOf(data) {
  const profiles = data.authorProfiles ?? data.authorprofiles;
  return Array.isArray(profiles) ? profiles : [];
}

/**
 * @returns {{ bylines: Record<string, object[]>, images: string[] }}
 *   `bylines` keyed by `normalizedContentPath`, the way the Worker names a
 *   document; `images` the asset-relative files those bylines show.
 */
export function buildBylines(projectRoot) {
  const contentRoot = resolve(projectRoot, "content");
  const bylines = {};
  const images = new Set();
  const publish = (path) => {
    if (!path) return undefined;
    images.add(path);
    return `/${path}`;
  };

  for (const file of markdownFiles(contentRoot)) {
    const { data } = parseFrontMatter(readFileSync(file, "utf8"));
    const names = Array.isArray(data.authors) ? data.authors : data.authors ? [data.authors] : [];
    if (!names.length) continue;
    const profiles = profilesOf(data);

    bylines[normalizedContentPath(file)] = [...new Set(names.map(String))].map((name) => {
      const profile = profiles.find((candidate) => candidate?.name === name) ?? {};
      const directory = typeof profile.assetdirectory === "string" ? profile.assetdirectory : undefined;
      const headshot = profile.image
        ? resourceExact(projectRoot, profile.image)
        : directory && resourceMatch(projectRoot, `${directory}/${slugify(name)}`);
      const logo = profile.logo
        ? resourceExact(projectRoot, profile.logo)
        : directory && resourceMatch(projectRoot, `${directory}/${basename(directory)}`);
      return {
        name,
        headshot: publish(headshot),
        role: profile.role,
        organization: profile.organization
          ? { name: profile.organization, website: profile.website, logo: publish(logo) }
          : undefined,
        links: profileLinks(profile.social),
      };
    });
  }

  return { bylines, images: [...images].sort() };
}
