/**
 * Step 3 / Step 3b: bare `users` rows for roster emails not attributable
 * to any YAML organization, and the canonical `group_memberships` rows sourced
 * from the working-group and governance roster CSVs. Pure with respect to its inputs — all
 * shared mutable state lives on the `ctx` object build-migration.mjs
 * passes in.
 */
import { buildGroupMembershipStatement } from "./sql-renderer.mjs";
import { GROUP_ROSTER_CSVS } from "./constants.mjs";
import { rosterJoinedAt } from "./roster-join-date.mjs";

function groupSlugsForEmail(groupRosters, email) {
  return Object.entries(groupRosters)
    .filter(([, roster]) => roster.has(email))
    .map(([slug]) => slug);
}

/**
 * For every email that couldn't be reconciled to a YAML representative,
 * record which working-group roster CSV(s) it appears in — this is the
 * manual-reconciliation signal staff need (an email with no name/org
 * attached, but a known set of WGs it belongs to).
 */
export function processBareRosterUsers(ctx, { pkicRoster, groupRosters }) {
  for (const [email] of pkicRoster.entries()) {
    if (ctx.claimedEmails.has(email)) continue;
    ctx.upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
    ctx.report.bareRosterUsers.push({ email, groups: groupSlugsForEmail(groupRosters, email) });
  }

  // A meaningful number of WG-roster subscribers never appear in
  // csv/pkic.csv at all (e.g. someone unsubscribed from the main pkic@
  // list but stayed on a WG list, or the exports were taken at slightly
  // different times). This only covers "CSV roster emails not
  // attributable to any YAML organization" sourced from pkic.csv, which
  // would silently drop these people from the reconciliation report. We
  // create a bare user for them too, but do not manufacture group membership
  // without a valid Member capacity; staff must first resolve their affiliation.
  for (const roster of Object.values(groupRosters)) {
    for (const [email] of roster.entries()) {
      if (ctx.claimedEmails.has(email) || ctx.importedEmails.has(email)) continue;
      ctx.upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
      ctx.report.groupOnlyRosterUsers.push({ email, groups: groupSlugsForEmail(groupRosters, email) });
    }
  }
}

export function processGroupMemberships(ctx, { groupRosters, rosterTimeZone }) {
  for (const [groupSlug, roster] of Object.entries(groupRosters)) {
    for (const [email, metadata] of roster.entries()) {
      if (!ctx.importedEmails.has(email)) continue; // not an address this import covered (defensive)
      ctx.report.groupRosterCounts[groupSlug] += 1;
      const joinedAt = rosterJoinedAt(metadata.joinDate, metadata.timeZone, rosterTimeZone);
      ctx.statements.push(buildGroupMembershipStatement(groupSlug, email, GROUP_ROSTER_CSVS[groupSlug].type, joinedAt));
    }
  }
}
