/**
 * Step 2 (org-tied branch) + Step 3e (sponsorship reconciliation):
 * processes one org-tied (A-G, H1-H4, H8) YAML record into
 * `organizations`/`organization_domain_claims`/`members`/
 * `member_category_assignments`/`organization_representatives`/
 * `user_roles`/`sponsorships` statements. Pure with respect to its inputs
 * — all shared mutable state lives on the `ctx` object build-migration.mjs
 * passes in.
 */
import path from "node:path";
import { splitName, urlizeName } from "./parsers.mjs";
import { matchRepsToCandidates } from "./reconciliation.mjs";
import {
  buildUpsertOrganizationStatement,
  buildOrganizationDomainStatements,
  buildOrganizationMemberAggregateStatements,
  buildOrganizationRepresentativeStatement,
  buildLinksJson,
  buildRepresentativeRoleGrantStatement,
  buildConsortiumSponsorshipStatements,
  buildEventSponsorshipStatements,
} from "./sql-renderer.mjs";
import { findLogoFile, findRepPhotoFile } from "./r2-adapter.mjs";
import { repSummary } from "./report.mjs";
import { REPRESENTATIVE_ROLE_IDS } from "../../assets/shared/schemas/representative-roles.ts";
import { upsertMemberUser } from "./user-upsert.mjs";
import { forEachResolvedEventSponsorship, normalizeImportedSponsorTier } from "./sponsorships.mjs";

/**
 * Consortium-wide and per-event sponsorships from a member's YAML
 * `sponsor:` block. See buildConsortiumSponsorshipStatements/
 * buildEventSponsorshipStatements for the idempotency guards.
 */
function upsertSponsorshipsForOrg(ctx, { normalizedOrgName, doc, filename, name }) {
  const sponsor = doc.sponsor;
  if (!sponsor) return;

  const level = normalizeImportedSponsorTier(sponsor.level);
  if (level) {
    const startDate = sponsor.since ?? doc.memberSince ?? null;
    ctx.statements.push(...buildConsortiumSponsorshipStatements(normalizedOrgName, level, startDate));
  }

  forEachResolvedEventSponsorship(sponsor.sponsoring, {
    onResolved: ({ alias, tier }) => {
      ctx.statements.push(...buildEventSponsorshipStatements(normalizedOrgName, alias, tier));
    },
    onUnmatched: ({ eventName, tier }) => {
      ctx.report.unmatchedEventSponsorships.push({ file: filename, name, eventName, tier });
    },
  });
}

export function processOrganizationRecord(ctx, { filename, slug, doc, name, memberType, domains, reps, candidates }) {
  const onInvalidLink = (url) => ctx.report.invalidLinks.push({ file: filename, name, url });

  let logoR2Key = null;
  if (ctx.uploadLogos) {
    const logoFile = findLogoFile(ctx.logoDir, slug);
    if (logoFile) {
      logoR2Key = `org-logos/${slug}/${path.basename(logoFile)}`;
      ctx.logoUploads.push({ slug, filePath: logoFile, r2Key: logoR2Key });
    }
  }
  const { statement: organizationStatement, normalizedOrgName } = buildUpsertOrganizationStatement({
    slug,
    name,
    doc,
    logoR2Key,
    onInvalidLink,
  });
  ctx.statements.push(organizationStatement);
  ctx.statements.push(...buildOrganizationDomainStatements(normalizedOrgName, domains));
  ctx.statements.push(
    ...buildOrganizationMemberAggregateStatements(normalizedOrgName, memberType || null, doc.memberSince),
  );
  upsertSponsorshipsForOrg(ctx, { normalizedOrgName, doc, filename, name });

  if (candidates.length === 0) {
    ctx.report.totals.unmatched.push({
      file: filename,
      name,
      memberType,
      representatives: reps.map(repSummary),
      reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
      workingGroupsHint: doc.workingGroups ?? [],
    });
    return;
  }

  const assignment = matchRepsToCandidates(reps, candidates); // parallel to reps: candidate index or null
  const unpairedReps = reps.filter((_, i) => assignment[i] === null);

  if (reps.length > 1 && candidates.length > 1) {
    ctx.report.totals.ambiguousPairing.push({
      file: filename,
      name,
      representatives: reps.map((r) => r.name),
      candidateEmails: candidates.map((c) => c.email),
    });
  }
  if (unpairedReps.length > 0) {
    ctx.report.totals.ambiguousPairing.push({
      file: filename,
      name,
      note: "more named representatives than matched emails — some representatives got no portal account",
      // Full detail (not just names), so staff finishing these via the
      // Interim Admin Tool have LinkedIn/role/bio in hand without going
      // back to the YAML — this data was previously dropped silently.
      unpaired: unpairedReps.map(repSummary),
    });
  }

  const contactEmails = [];
  const matchedCandidateIndices = new Set();

  for (let i = 0; i < reps.length; i += 1) {
    if (assignment[i] === null) continue;
    const rep = reps[i];
    const { email } = candidates[assignment[i]];
    matchedCandidateIndices.add(assignment[i]);
    const { firstName, lastName } = splitName(rep.name);
    const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);

    // Representative photos live in the same `assets/images/members/<orgSlug>/`
    // directory as the org logo, one file per person (see findRepPhotoFile) —
    // distinct from the org's own `<orgSlug>.*` logo file.
    let repHeadshotR2Key = null;
    if (ctx.uploadLogos) {
      const photoFile = findRepPhotoFile(ctx.logoDir, slug, rep, urlizeName);
      if (photoFile) {
        repHeadshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
        ctx.logoUploads.push({ slug, filePath: photoFile, r2Key: repHeadshotR2Key });
      }
    }

    const linksJson = buildLinksJson(links, onInvalidLink);
    const normalizedEmail = upsertMemberUser(ctx, {
      email,
      firstName,
      lastName,
      jobTitle: null,
      biography: null,
      links: [],
      headshotR2Key: repHeadshotR2Key,
      sourceFile: filename,
      sourceName: rep.name,
    });
    ctx.statements.push(
      buildOrganizationRepresentativeStatement(normalizedOrgName, normalizedEmail, true, {
        jobTitle: rep.role ?? null,
        biography: rep.description ?? null,
        linksJson,
      }),
    );
    contactEmails.push(normalizedEmail);
  }

  // Domain-matched emails not paired to any named representative (or, for
  // orgs with no `representatives` field at all, every matched email)
  // become anonymous, opted-out representative rows.
  for (let i = 0; i < candidates.length; i += 1) {
    if (matchedCandidateIndices.has(i)) continue;
    const { email } = candidates[i];
    const normalizedEmail = ctx.upsertUser({
      email,
      firstName: null,
      lastName: null,
      jobTitle: null,
      biography: null,
      linksJson: null,
    });
    ctx.claimedEmails.add(normalizedEmail);
    ctx.statements.push(buildOrganizationRepresentativeStatement(normalizedOrgName, normalizedEmail, false));
    contactEmails.push(normalizedEmail);
  }

  if (contactEmails[0])
    ctx.statements.push(
      buildRepresentativeRoleGrantStatement(
        normalizedOrgName,
        contactEmails[0],
        REPRESENTATIVE_ROLE_IDS.primaryContact,
      ),
    );
  if (contactEmails[1])
    ctx.statements.push(
      buildRepresentativeRoleGrantStatement(
        normalizedOrgName,
        contactEmails[1],
        REPRESENTATIVE_ROLE_IDS.secondaryContact,
      ),
    );

  ctx.report.totals.matchedOrgs += 1;
}
