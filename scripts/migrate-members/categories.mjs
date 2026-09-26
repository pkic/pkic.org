/** Legacy YAML category preflight uses the baseline vocabulary of the source export.
 * Live membership policy is managed separately in the D1 category catalog. */
import {
  MEMBERSHIP_CATEGORIES,
  isIndividualMembershipCategory,
} from "../../assets/shared/schemas/membership-categories.ts";

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
