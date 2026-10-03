import { siteContentSlug as slugify } from "../../../assets/shared/site-content-slug.ts";
export { siteContentSlug as slugify } from "../../../assets/shared/site-content-slug.ts";
import { parse as parseYaml } from "yaml";

export interface MenuEntry {
  identifier?: string;
  name?: string;
  params?: { external?: boolean };
  parent?: string;
  url?: string;
  weight?: number;
}

export interface FrontMatter {
  build?: { render?: string; list?: string; publishResources?: boolean };
  aliases?: string | string[];
  authors?: string[];
  card?: {
    description?: string;
    gradient?: string[];
    icon?: string;
    links?: Array<{ chip?: string; text?: string; url?: string }>;
    order?: number;
  };
  cascade?: { params?: Record<string, unknown> };
  data?: Record<string, unknown>;
  date?: string;
  description?: string;
  draft?: boolean;
  eventDate?: string;
  eventType?: string;
  heroHeader?: string;
  heroDescription?: string;
  heroImage?: string;
  heroLinks?: Array<{ primary?: boolean; text?: string; url?: string }>;
  heroTitle?: string;
  socialCardImage?: string;
  color?: string;
  deliverables?: Array<{ description?: string; menuTitle?: string; status?: string; title?: string; url?: string }>;
  fullwidth?: boolean;
  focus?: Array<{ description?: string; icon?: string; title?: string }>;
  intro?: string;
  keyDeliverables?: Array<{
    badge?: string;
    cta?: string;
    description?: string;
    icon?: string;
    title?: string;
    url?: string;
  }>;
  heroButton?: { label?: string; link?: string };
  /** A level-one section that lends its children to the tree instead of a row of its own. */
  hideInSidebar?: boolean;
  keywords?: string[];
  layout?: string;
  outputs?: string[];
  login?: unknown;
  resources?: Array<{ description?: string; title?: string; url?: string }>;
  linkTitle?: string;
  lastmod?: string;
  noPages?: boolean;
  note?: string;
  menu?: Partial<Record<"footer" | "main", MenuEntry>>;
  params?: {
    [key: string]: unknown;
    eventDate?: string;
    heroDescription?: string;
    heroImage?: string;
    heroTitle?: string;
  };
  redirect?: string;
  robots?: string;
  series?: string[];
  sideMenu?: boolean;
  slug?: string;
  summary?: string;
  sitemap?: { disable?: boolean };
  tags?: string[];
  title?: string;
  url?: string;
  weight?: number;
  wgID?: string;
  /** A page that renders one of a working group's generated sections. */
  wgSection?: string;
}

export function normalizedContentSourcePath(contentPath: string): string {
  return contentPath.replaceAll("\\", "/").replace(/^.*\/content\//, "");
}

export function compileContentIgnorePatterns(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid content ignoreFiles pattern ${JSON.stringify(pattern)}`, { cause: error });
    }
  });
}

export function contentSourceIsIncluded(contentPath: string, ignorePatterns: readonly RegExp[]): boolean {
  const sourcePath = normalizedContentSourcePath(contentPath);
  return !ignorePatterns.some((pattern) => pattern.test(sourcePath));
}

export function normalizedContentPath(contentPath: string): string {
  return normalizedContentSourcePath(contentPath).replace(/\.md$/, "");
}

export function normalizeSitePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return `${pathname.replace(/\/+$/, "")}/`;
}

export function contentPathToRoute(contentPath: string, data: FrontMatter = {}): string {
  if (data.url?.startsWith("/")) return normalizeSitePath(data.url);
  const normalized = normalizedContentPath(contentPath);
  if (normalized.startsWith("blog/") && normalized !== "blog/_index") {
    const sourceDate = /(?:^|\/)(\d{4})-(\d{2})-(\d{2})-/.exec(normalized);
    const frontMatterDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(data.date ?? ""));
    const date = frontMatterDate ?? sourceDate;
    const title =
      data.slug ??
      data.title ??
      normalized
        .split("/")
        .at(-1)
        ?.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (date && title) return `/${date[1]}/${date[2]}/${date[3]}/${slugify(title)}/`;
  }

  const segments = normalized.split("/");
  if (segments.at(-1) === "index" || segments.at(-1) === "_index") segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

export function parseFrontMatter(source: string): { body: string; data: FrontMatter } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(source);
  if (!match) return { body: source, data: {} };
  // Several historical posts use CRLF. A trailing CR-only blank line is not
  // valid YAML even though Hugo accepted the front matter, so normalize the
  // metadata without changing the Markdown body returned to the renderer.
  const parsed = parseYaml(match[1].replace(/\r\n?/g, "\n"));
  const data = parsed && typeof parsed === "object" ? (parsed as FrontMatter) : {};
  return { body: source.slice(match[0].length), data };
}
