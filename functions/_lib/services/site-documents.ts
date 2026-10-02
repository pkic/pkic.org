import { WORKING_GROUP_SECTIONS } from "./site-working-groups";
import { normalizedContentPath, type FrontMatter } from "./site-markdown";
import { siteContentLanguagePrefix, type SiteContentLanguage } from "../../../assets/shared/site-content-language";

export interface ContentDocument {
  body: string;
  data: FrontMatter;
  isSection: boolean;
  language: SiteContentLanguage;
  nodePath: string;
  route: string;
  sourcePath: string;
}

export function nodePathForSource(sourcePath: string): string {
  const normalized = normalizedContentPath(sourcePath);
  return normalized.replace(/\/(?:_?index)$/, "").replace(/^_index$/, "");
}

/**
 * Hugo's default title for a section that has no `_index.md`.
 *
 * The section name is pluralized and title-cased word by word, which is why
 * `invite` publishes as `Invites` and `event-flow-shells` stays plural.
 */
export function generatedSectionTitle(name: string): string {
  const words = name.split("-");
  const last = words.length - 1;
  if (words[last] && !words[last].endsWith("s")) words[last] = `${words[last]}s`;
  return words.map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word)).join("-");
}

/**
 * Section pages Hugo generated for top-level content directories.
 *
 * A directory directly under `content/` is a section whether or not it carries
 * an `_index.md`, so its index has to exist here too or published URLs such as
 * `/invite/` and `/meetings/` disappear with Hugo.
 *
 * A directory only earns an index when its pages actually publish under that
 * address. `content/remote-key-attestation/_index.md` sets
 * `url: /wg/cm/remote-key-attestation/` and the event-flow shells publish under
 * `/_event-flow-shells/`, so neither directory gets a second, empty page back
 * at its own name — which would shadow the first one's alias.
 */
export function generatedSectionDocuments(pages: readonly ContentDocument[]): ContentDocument[] {
  const existing = new Set(pages.map((page) => page.route));
  const generated: ContentDocument[] = [];
  for (const language of new Set(pages.map((page) => page.language))) {
    const prefix = siteContentLanguagePrefix(language);
    const languagePages = pages.filter((page) => page.language === language);
    const directories = new Set<string>();
    for (const page of languagePages) {
      const source = normalizedContentPath(page.sourcePath);
      const [name] = source.split("/");
      if (name && name !== source) directories.add(name);
    }
    const section = (name: string): ContentDocument => {
      const template = pages.find((page) => page.language === "en" && page.isSection && page.nodePath === name);
      const data: FrontMatter = { ...(template?.data ?? { title: generatedSectionTitle(name) }) };
      // Shared presentation can fall back to English without duplicating menus or aliases.
      delete data.menu;
      delete data.aliases;
      if (name === "blog" && typeof data.heroDescription === "string")
        data.heroDescription = data.heroDescription.replace(
          /\]\(\/(authors|tags|series)\/\)/g,
          (_, taxonomy: string) => `](${prefix}/${taxonomy}/)`,
        );
      return {
        body: name ? "" : (template?.body ?? ""),
        data,
        isSection: true,
        language,
        nodePath: name,
        route: `${prefix}/${name ? `${name}/` : ""}`,
        sourcePath: `content/${name ? `${name}/` : ""}_index${language === "en" ? "" : `.${language}`}.md`,
      };
    };
    if (language !== "en" && !existing.has(`${prefix}/`)) generated.push(section(""));
    for (const name of directories) {
      const route = `${prefix}/${name}/`;
      if (
        !existing.has(route) &&
        languagePages.some(
          (page) => page.route.startsWith(route) || (name === "blog" && page.nodePath.startsWith("blog/")),
        )
      )
        generated.push(section(name));
    }
  }
  return generated;
}

export function workingGroupSectionDocuments(pages: readonly ContentDocument[]): ContentDocument[] {
  const existing = new Set(pages.map((page) => page.route));
  const generated: ContentDocument[] = [];
  for (const group of pages) {
    if (!group.isSection || !group.data.wgID) continue;
    const parts = group.nodePath.split("/");
    if (parts.length !== 2 || parts[0] !== "wg") continue;
    for (const section of WORKING_GROUP_SECTIONS) {
      const route = `${group.route}${section.key}/`;
      if (existing.has(route)) continue;
      generated.push({
        body: "",
        data: {
          linkTitle: section.title,
          params: { sectionNav: true, wgSection: section.key },
          title: section.title,
        },
        isSection: true,
        language: group.language,
        nodePath: `${group.nodePath}/${section.key}`,
        route,
        sourcePath: `content/${group.nodePath}/${section.key}/_index.md`,
      });
    }
  }
  return generated;
}
