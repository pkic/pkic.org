import { parseLinksJson, serializeLinks } from "../../../../assets/shared/schemas/links";
import type { OrganizationEditableContent } from "../../../../assets/shared/schemas/organization-profile";

/** Canonical API field -> D1 column mapping for organization profile content. */
export const ORGANIZATION_CONTENT_COLUMN_BY_FIELD = {
  slogan: "slogan",
  description: "description",
  contentMarkdown: "content_markdown",
  website: "website",
  blogUrl: "blog_url",
  blogFeedUrl: "blog_feed_url",
  pressUrl: "press_url",
  pressFeedUrl: "press_feed_url",
  careersUrl: "careers_url",
  links: "links_json",
} as const satisfies Record<keyof OrganizationEditableContent, string>;

export const ORGANIZATION_SCALAR_CONTENT_COLUMN_BY_FIELD = {
  slogan: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.slogan,
  description: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.description,
  contentMarkdown: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.contentMarkdown,
  website: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.website,
  blogUrl: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.blogUrl,
  blogFeedUrl: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.blogFeedUrl,
  pressUrl: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.pressUrl,
  pressFeedUrl: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.pressFeedUrl,
  careersUrl: ORGANIZATION_CONTENT_COLUMN_BY_FIELD.careersUrl,
} as const;

export interface OrganizationContentRow {
  id: string;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logo_r2_key: string | null;
  content_markdown: string | null;
  blog_url: string | null;
  blog_feed_url: string | null;
  press_url: string | null;
  press_feed_url: string | null;
  careers_url: string | null;
  links_json: string | null;
}

export const ORGANIZATION_CONTENT_SELECT_COLUMNS = `id, website, description, slogan, logo_r2_key,
  content_markdown, blog_url, blog_feed_url, press_url, press_feed_url, careers_url, links_json`;

export function organizationLogoUrl(id: string, logoR2Key: string | null): string | null {
  return logoR2Key ? `/api/v1/members/${id}/logo` : null;
}

type OrganizationSummaryContentRow = Pick<
  OrganizationContentRow,
  "id" | "website" | "description" | "slogan" | "logo_r2_key"
>;
type OrganizationExtendedContentRow = Pick<
  OrganizationContentRow,
  "content_markdown" | "blog_url" | "blog_feed_url" | "press_url" | "press_feed_url" | "careers_url" | "links_json"
>;

export function toOrganizationSummaryContent(row: OrganizationSummaryContentRow) {
  return {
    website: row.website,
    description: row.description,
    slogan: row.slogan,
    logoUrl: organizationLogoUrl(row.id, row.logo_r2_key),
  };
}

export function toOrganizationExtendedContent(row: OrganizationExtendedContentRow) {
  return {
    contentMarkdown: row.content_markdown,
    blogUrl: row.blog_url,
    blogFeedUrl: row.blog_feed_url,
    pressUrl: row.press_url,
    pressFeedUrl: row.press_feed_url,
    careersUrl: row.careers_url,
    links: parseLinksJson(row.links_json),
  };
}

export function serializeOrganizationContentValue(field: string, value: unknown): unknown {
  return field === "links" ? serializeLinks(value as string[]) : value;
}
