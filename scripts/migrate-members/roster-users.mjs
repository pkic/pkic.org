/**
 * Step 3 / Step 3b: bare `users` rows for roster emails not attributable
 * to any YAML organization, and the `working_group_members` rows sourced
 * from the six per-WG roster CSVs. Pure with respect to its inputs — all
 * shared mutable state lives on the `ctx` object build-migration.mjs
 * passes in.
 */
import { buildWorkingGroupMemberStatement } from "./sql-renderer.mjs";

function wgSlugsForEmail(wgRosters, email) {
  return Object.entries(wgRosters)
    .filter(([, roster]) => roster.has(email))
    .map(([slug]) => slug);
}

/**
 * For every email that couldn't be reconciled to a YAML representative,
 * record which working-group roster CSV(s) it appears in — this is the
 * manual-reconciliation signal staff need (an email with no name/org
 * attached, but a known set of WGs it belongs to).
 */
export function processBareRosterUsers(ctx, { pkicRoster, wgRosters }) {
  for (const [email] of pkicRoster.entries()) {
    if (ctx.claimedEmails.has(email)) continue;
    ctx.upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
    ctx.report.bareRosterUsers.push({ email, workingGroups: wgSlugsForEmail(wgRosters, email) });
  }

  // A meaningful number of WG-roster subscribers never appear in
  // csv/pkic.csv at all (e.g. someone unsubscribed from the main pkic@
  // list but stayed on a WG list, or the exports were taken at slightly
  // different times). This only covers "CSV roster emails not
  // attributable to any YAML organization" sourced from pkic.csv, which
  // would silently drop these people's WG membership entirely (can only
  // attach working_group_members to a user row that already exists). We
  // create a bare user for them too, flagged separately in the report.
  for (const roster of Object.values(wgRosters)) {
    for (const [email] of roster.entries()) {
      if (ctx.claimedEmails.has(email) || ctx.createdUserEmails.has(email)) continue;
      ctx.upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
      ctx.report.wgOnlyRosterUsers.push({ email, workingGroups: wgSlugsForEmail(wgRosters, email) });
    }
  }
}

export function processWorkingGroupMemberships(ctx, { wgRosters }) {
  for (const [wgSlug, roster] of Object.entries(wgRosters)) {
    for (const [email] of roster.entries()) {
      if (!ctx.createdUserEmails.has(email)) continue; // not a user we created (shouldn't happen, defensive)
      ctx.report.workingGroupCounts[wgSlug] += 1;
      ctx.statements.push(buildWorkingGroupMemberStatement(wgSlug, email));
    }
  }
}
