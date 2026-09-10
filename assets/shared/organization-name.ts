/**
 * The one spelling rule for an organization's name as a match key.
 *
 * `organizations.normalized_name` is what every surface that has to decide
 * "is this the same organization?" compares on — sponsorship checkout, the
 * membership application, provisioning, the profile editor, and the members
 * migration. Casing and inner spacing are the differences people actually
 * type; anything else (punctuation, legal suffixes) is deliberately left
 * alone, because collapsing those would merge organizations that are not the
 * same one.
 */
export function normalizeOrgName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
