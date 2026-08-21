import { buildLinksJson } from "./sql-renderer.mjs";

/**
 * Persist the user projection shared by individual and organization-member
 * imports, including canonical link validation and claimed-email tracking.
 */
export function upsertMemberUser(
  ctx,
  { email, firstName, lastName, jobTitle, biography, links, headshotR2Key, sourceFile, sourceName },
) {
  const normalizedEmail = ctx.upsertUser({
    email,
    firstName,
    lastName,
    jobTitle,
    biography,
    linksJson: buildLinksJson(links, (url) =>
      ctx.report.invalidLinks.push({ file: sourceFile, name: sourceName, url }),
    ),
    headshotR2Key,
  });
  ctx.claimedEmails.add(normalizedEmail);
  return normalizedEmail;
}
