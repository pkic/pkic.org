/**
 * Category preflight — consumes the same canonical membership-category
 * vocabulary (assets/shared/schemas/membership-categories.ts) every
 * runtime write path validates against, instead of a locally-redeclared
 * category set. Run before any SQL is generated: a missing or unknown
 * category on any record must fail the whole import loudly, not silently
 * produce a member row with an absent/invalid category (PR #1 review,
 * phase1-2-review-20260817.md, blocker 1).
 *
 * On "member-kind-incompatible" categories specifically: this importer has
 * no independent signal of a record's intended kind (individual vs.
 * organization) other than the category itself — `organizationDomains` was
 * tried as a structural signal and reverted after it false-positived on 44
 * real production individual (H5/H6/H7) records that legitimately set
 * `organizationDomains` for email-matching purposes only (documented in
 * the YAML with a `# Business domains for email` comment), not because
 * they're organizations. Once a category is confirmed to be one of the
 * known `MEMBERSHIP_CATEGORIES`, build-migration.mjs derives which branch
 * (individual vs. organization) to run *from that same category* via
 * `isIndividualMembershipCategory` — the single source of truth — so kind
 * and category can never diverge downstream in the generated SQL. A
 * separate "kind-incompatible" check is therefore not meaningful for this
 * importer's design: rejecting unknown categories here is what makes kind
 * assignment unambiguous by construction, rather than a check bolted on
 * afterward.
 */
import { MEMBERSHIP_CATEGORIES, isIndividualMembershipCategory } from "../../assets/shared/schemas/membership-categories.ts";

const MEMBERSHIP_CATEGORY_SET = new Set(MEMBERSHIP_CATEGORIES);

export { isIndividualMembershipCategory };

/** Scans every loaded YAML record for a missing or unknown `memberType` category. */
export function findCategoryViolations(yamlRecords) {
  const missing = [];
  const unknown = [];

  for (const { filename, slug, doc } of yamlRecords) {
    const name = String(doc.name ?? slug).trim();
    const memberType = String(doc.memberType ?? "").trim();

    if (!memberType) {
      missing.push({ file: filename, name });
    } else if (!MEMBERSHIP_CATEGORY_SET.has(memberType)) {
      unknown.push({ file: filename, name, memberType });
    }
  }

  return { missing, unknown };
}

/**
 * Throws a single formatted error enumerating every violation found, or
 * returns silently when the dataset is clean. Must run before any
 * statement is generated — see build-migration.mjs.
 */
export function assertCategoriesValid(yamlRecords) {
  const { missing, unknown } = findCategoryViolations(yamlRecords);
  const total = missing.length + unknown.length;
  if (total === 0) return;

  const lines = [`Category preflight failed: ${total} record(s) rejected. No SQL was generated.`];
  if (missing.length > 0) {
    lines.push(`  Missing category (${missing.length}):`);
    for (const { file, name } of missing) lines.push(`    - ${file} (${name})`);
  }
  if (unknown.length > 0) {
    lines.push(`  Unknown category (${unknown.length}, valid: ${MEMBERSHIP_CATEGORIES.join(", ")}):`);
    for (const { file, name, memberType } of unknown) lines.push(`    - ${file} (${name}): "${memberType}"`);
  }
  throw new Error(lines.join("\n"));
}
