/**
 * Step 2 (individual branch): processes one org-less (H5/H6/H7) YAML
 * record into `users`/`members`/`member_category_assignments` statements.
 * Pure with respect to its inputs — all shared mutable state (statements,
 * report, logoUploads, claimedEmails) lives on the `ctx` object passed in
 * by build-migration.mjs, which owns the iteration order and file I/O.
 */
import path from "node:path";
import { splitName, activeRepresentatives } from "./parsers.mjs";
import { sentinelEmailForSlug } from "./reconciliation.mjs";
import { buildIndividualMemberAggregateStatements } from "./sql-renderer.mjs";
import { findLogoFile } from "./r2-adapter.mjs";
import { upsertMemberUser } from "./user-upsert.mjs";

/**
 * Individuals have no organization row at all.
 *
 * Unlike org-tied representatives (where an unmatched email means "we
 * don't know which real person this is" and the row is left for the
 * Interim Admin Tool), an org-less individual's YAML file *is* their whole
 * record — every field needed to create them is already known except a
 * deliverable email. So an individual with no domain-matched roster email
 * still gets a real row, keyed on a deterministic sentinel `.invalid`
 * placeholder email (see sentinelEmailForSlug), flagged `needsEmail: true`
 * for staff to attach a real address later.
 */
export function processIndividualRecord(ctx, { filename, slug, doc, name, memberType, domains, candidates }) {
  const needsEmail = candidates.length === 0;
  const email = needsEmail ? sentinelEmailForSlug(slug) : candidates[0].email;

  if (needsEmail) {
    ctx.report.needsEmailIndividuals.push({
      file: filename,
      name,
      memberType,
      sentinelEmail: email,
      reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
      workingGroupsHint: doc.workingGroups ?? [],
    });
  }

  // Individuals use the same per-slug image directory as org logos
  // (`/images/members/<slug>/<slug>.*`, per the old Hugo member-card/
  // single-page partials) — there's no separate `organizations` row to
  // hold a key for it, so it's stored on the user's own `headshot_r2_key`
  // (the same column self-service headshot uploads use).
  let headshotR2Key = null;
  if (ctx.uploadLogos) {
    const photoFile = findLogoFile(ctx.logoDir, slug);
    if (photoFile) {
      headshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
      ctx.logoUploads.push({ slug, filePath: photoFile, r2Key: headshotR2Key });
    }
  }

  const reps = activeRepresentatives(doc);
  const rep = reps[0] ?? { name, role: null, social: {}, description: null };
  const { firstName, lastName } = splitName(rep.name ?? name);
  const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);
  const normalizedEmail = upsertMemberUser(ctx, {
    email,
    firstName,
    lastName,
    jobTitle: rep.role ?? null,
    biography: rep.description ?? null,
    links,
    headshotR2Key,
    sourceFile: filename,
    sourceName: name,
  });
  ctx.statements.push(
    ...buildIndividualMemberAggregateStatements(normalizedEmail, memberType || null, doc.memberSince),
  );
  if (needsEmail) ctx.report.totals.sentinelIndividuals += 1;
  else ctx.report.totals.matchedOrgs += 1;
}
