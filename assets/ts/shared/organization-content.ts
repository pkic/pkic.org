/** Canonical user-facing labels for moderated organization profile changes. */
export const ORGANIZATION_CONTENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  slogan: "Slogan",
  description: "Description",
  contentMarkdown: "Long-form content",
  website: "Website",
  blogUrl: "Blog URL",
  blogFeedUrl: "Blog feed URL",
  pressUrl: "Press URL",
  pressFeedUrl: "Press feed URL",
  careersUrl: "Careers URL",
  links: "Links",
};

/** Shared guidance for both visual organization content editors. */
export const ORGANIZATION_CONTENT_MARKDOWN_HELP =
  "Write and format your public member page. Add sections, callouts, tables, images, or videos from the block controls.";

/**
 * The order an organization's web addresses read in, wherever they are shown
 * or edited — the site first, then what it publishes, then where it hires.
 * The labels above name them; this says in what sequence, so the profile card
 * and the submission form cannot disagree about it.
 */
export const ORGANIZATION_URL_FIELD_ORDER = [
  "website",
  "blogUrl",
  "blogFeedUrl",
  "pressUrl",
  "pressFeedUrl",
  "careersUrl",
] as const;

/** Where one organization lives on the API. */
export function organizationPath(organizationId: string): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}`;
}
