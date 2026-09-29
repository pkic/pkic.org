/**
 * `data/sponsors.yaml`: companies that sponsor without being a PKIC
 * member (e.g. an event venue partner). Same NOT EXISTS-guarded,
 * re-run-safe shape as member sponsorships, just without an
 * organization_id (non_member_name identifies the sponsor instead). Pure
 * with respect to its inputs — all shared mutable state lives on the
 * `ctx` object build-migration.mjs passes in.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { urlizeName } from "./parsers.mjs";
import {
  buildNonMemberConsortiumSponsorshipStatement,
  buildNonMemberEventSponsorshipStatements,
} from "./sql-renderer.mjs";
import { forEachResolvedEventSponsorship, normalizeImportedSponsorTier } from "./sponsorships.mjs";

export function processNonMemberSponsors(ctx, { sponsorsYamlPath, sponsorLogoDir }) {
  if (!fs.existsSync(sponsorsYamlPath)) return;

  const nonMemberSponsors = YAML.parse(fs.readFileSync(sponsorsYamlPath, "utf8")) ?? [];
  for (const entry of nonMemberSponsors) {
    const sponsorName = String(entry.name ?? "").trim();
    if (!sponsorName) continue;
    const website = entry.website ?? null;
    const sponsorSlug = urlizeName(sponsorName);

    let logoR2Key = null;
    if (ctx.uploadLogos && entry.logo) {
      const logoFile = path.join(sponsorLogoDir, entry.logo);
      if (fs.existsSync(logoFile)) {
        logoR2Key = `sponsor-logos/${sponsorSlug}/${path.basename(logoFile)}`;
        ctx.logoUploads.push({ slug: sponsorSlug, filePath: logoFile, r2Key: logoR2Key });
      }
    }

    const sponsor = entry.sponsor ?? {};
    const level = normalizeImportedSponsorTier(sponsor.level);
    if (level) {
      ctx.statements.push(buildNonMemberConsortiumSponsorshipStatement(sponsorName, website, logoR2Key, level));
      ctx.report.nonMemberSponsorships.created += 1;
    }

    forEachResolvedEventSponsorship(sponsor.sponsoring, {
      onResolved: ({ alias, tier }) => {
        ctx.statements.push(...buildNonMemberEventSponsorshipStatements(sponsorName, website, logoR2Key, alias, tier));
        ctx.report.nonMemberSponsorships.created += 1;
      },
      onUnmatched: ({ eventName, tier }) => {
        ctx.report.nonMemberSponsorships.unmatchedEvents.push({ name: sponsorName, eventName, tier });
      },
    });
  }
}
