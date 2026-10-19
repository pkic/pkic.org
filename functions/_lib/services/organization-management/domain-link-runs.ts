/**
 * A domain claim reaches the people who verified an address on it earlier.
 *
 * Claiming a domain opens one link run. Each pass walks the people with a
 * verified address on the domain in user-id order, after the run's cursor,
 * and hands each one to the same rule a fresh verification uses
 * (`linkVerifiedAddressToDomainOrganization`): a non-member organization is
 * joined, audited as a system decision; a member organization is only
 * offered, which the person's organization question already shows. The claim
 * runs the first pass at once; the `organization_domain_linking` scheduled
 * job finishes larger domains in bounded chunks and can resume after any
 * failure. A run whose claim was released or moved simply ends.
 */
import { domainLinkMode } from "../../../../assets/shared/organization-domain";
import { all, first } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { linkVerifiedAddressToDomainOrganization } from "../identities/email-domain-link";
import { getOrganizationDomainClaim } from "../membership/organization-domain-claims";
import { hostWithinDomainSql } from "../../email-domains/sql";
import { requestJobWake } from "../scheduled-jobs/dispatcher";

/** People examined per pass of one run. */
export const DOMAIN_LINK_CHUNK = 25;
/** A link attempt reads and writes a handful of statements; keep a margin per person. */
const QUERIES_PER_PERSON = 12;
const RUNS_PER_JOB_PASS = 4;

/**
 * People with a verified address on the domain or one of its subdomains who
 * have no relationship with the organization and did not say it is not
 * theirs: the people a claim can still reach. An address below a more specific
 * claim (`research.example.com` under `example.com`) follows that claim instead.
 * Binds domain, domain, organization, organization, domain.
 */
const CANDIDATES_SQL = `WITH addresses AS (
    SELECT id AS user_id, normalized_email FROM users
     WHERE ${hostWithinDomainSql("substr(normalized_email, instr(normalized_email, '@') + 1)", "?")}
       AND email_verified_at IS NOT NULL
       AND active = 1
    UNION ALL
    SELECT address.user_id, address.normalized_email FROM user_emails address
      JOIN users person ON person.id = address.user_id AND person.active = 1
     WHERE ${hostWithinDomainSql("substr(address.normalized_email, instr(address.normalized_email, '@') + 1)", "?")}
       AND address.verified_at IS NOT NULL
  ), candidates AS (
    SELECT user_id, MIN(normalized_email) AS normalized_email FROM addresses
     WHERE NOT EXISTS (SELECT 1 FROM identities related
                        WHERE related.user_id = addresses.user_id AND related.organization_id = ?)
       AND NOT EXISTS (SELECT 1 FROM affiliation_offer_dismissals dismissal
                        WHERE dismissal.user_id = addresses.user_id AND dismissal.organization_id = ?)
       AND NOT EXISTS (SELECT 1 FROM organization_domain_claims closer
                        WHERE length(closer.domain) > length(?)
                          AND ${hostWithinDomainSql("substr(addresses.normalized_email, instr(addresses.normalized_email, '@') + 1)", "closer.domain")})
     GROUP BY user_id
  )`;

/** How many people a claim on `domain` would reach now, and whether they join or are offered. */
export async function previewDomainLinking(
  db: DatabaseLike,
  organizationId: string,
  domain: string,
): Promise<{ peopleToLink: number; linkMode: "automatic" | "confirm" }> {
  const [count, member] = await Promise.all([
    first<{ count: number }>(db, `${CANDIDATES_SQL} SELECT COUNT(*) AS count FROM candidates`, [
      domain,
      domain,
      organizationId,
      organizationId,
      domain,
    ]),
    first<{ id: string }>(db, "SELECT id FROM members WHERE organization_id = ? LIMIT 1", [organizationId]),
  ]);
  return { peopleToLink: Number(count?.count ?? 0), linkMode: domainLinkMode({ isMember: Boolean(member) }) };
}

/** Opens the link run in the claim's own command. */
export function prepareDomainLinkRun(
  db: DatabaseLike,
  input: { organizationId: string; domain: string; requestedByUserId: string; at: string },
): { runId: string; statement: StatementLike } {
  const runId = uuid();
  return {
    runId,
    statement: db
      .prepare(
        `INSERT INTO organization_domain_link_runs
           (id, organization_id, domain, requested_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(runId, input.organizationId, input.domain, input.requestedByUserId, input.at, input.at),
  };
}

interface LinkRun {
  id: string;
  organization_id: string;
  domain: string;
  cursor_user_id: string | null;
  examined: number;
  linked: number;
}

function prepareRunCompletion(db: DatabaseLike, run: LinkRun, at: string, reason: string): StatementLike[] {
  return [
    db
      .prepare("UPDATE organization_domain_link_runs SET completed_at = ?, updated_at = ? WHERE id = ?")
      .bind(at, at, run.id),
    prepareAuditLog(
      db,
      "system",
      null,
      "organization_domain_linking_completed",
      "organization",
      run.organization_id,
      { runId: run.id, domain: run.domain, examined: run.examined, linked: run.linked, reason },
      at,
    ),
  ];
}

/** One bounded pass of a run; returns whether the run is complete. */
export async function advanceDomainLinkRun(
  db: DatabaseLike,
  runId: string,
  limit = DOMAIN_LINK_CHUNK,
): Promise<{ complete: boolean; examined: number; linked: number }> {
  const run = await first<LinkRun>(
    db,
    `SELECT id, organization_id, domain, cursor_user_id, examined, linked FROM organization_domain_link_runs
      WHERE id = ? AND completed_at IS NULL`,
    [runId],
  );
  if (!run) return { complete: true, examined: 0, linked: 0 };
  const claim = await getOrganizationDomainClaim(db, run.domain);
  if (claim?.organizationId !== run.organization_id) {
    await db.batch(prepareRunCompletion(db, run, nowIso(), "claim_released"));
    return { complete: true, examined: 0, linked: 0 };
  }
  const people = await all<{ user_id: string; normalized_email: string }>(
    db,
    `${CANDIDATES_SQL} SELECT user_id, normalized_email FROM candidates
      WHERE user_id > ? ORDER BY user_id LIMIT ?`,
    [run.domain, run.domain, run.organization_id, run.organization_id, run.domain, run.cursor_user_id ?? "", limit],
  );
  let linked = 0;
  for (const person of people) {
    const joined = await linkVerifiedAddressToDomainOrganization(db, {
      userId: person.user_id,
      normalizedEmail: person.normalized_email,
      systemDecision: {
        action: "organization_domain_person_linked",
        details: { runId: run.id, domain: run.domain },
      },
      // A subdomain address another organization claims more specifically stays with that claim.
      onlyOrganizationId: run.organization_id,
    });
    if (joined) linked += 1;
  }
  const at = nowIso();
  const advanced: LinkRun = {
    ...run,
    cursor_user_id: people.at(-1)?.user_id ?? run.cursor_user_id,
    examined: run.examined + people.length,
    linked: run.linked + linked,
  };
  const complete = people.length < limit;
  await db.batch([
    db
      .prepare(
        `UPDATE organization_domain_link_runs SET cursor_user_id = ?, examined = ?, linked = ?, updated_at = ?
          WHERE id = ? AND completed_at IS NULL`,
      )
      .bind(advanced.cursor_user_id, advanced.examined, advanced.linked, at, run.id),
    ...(complete ? prepareRunCompletion(db, advanced, at, "all_people_examined") : []),
  ]);
  return { complete, examined: people.length, linked };
}

/** Runs the claim's first pass at once and leaves the rest to the scheduler. */
export async function startDomainLinkRun(
  db: DatabaseLike,
  runId: string,
): Promise<{ peopleLinked: number; continuing: boolean }> {
  const pass = await advanceDomainLinkRun(db, runId);
  if (!pass.complete) await requestJobWake(db, "organization_domain_linking");
  return { peopleLinked: pass.linked, continuing: !pass.complete };
}

/** The scheduled job: bounded passes over the oldest open runs. */
export async function runDomainLinking(
  db: DatabaseLike,
  budget?: D1QueryBudget,
): Promise<{ runs: number; examined: number; linked: number; budgetLimited: boolean; remaining: boolean }> {
  const runs = await all<{ id: string }>(
    db,
    `SELECT id FROM organization_domain_link_runs WHERE completed_at IS NULL ORDER BY created_at, id LIMIT ?`,
    [RUNS_PER_JOB_PASS],
  );
  const summary = { runs: 0, examined: 0, linked: 0, budgetLimited: false, remaining: false };
  for (const run of runs) {
    if (!hasD1QueryCapacity(budget, DOMAIN_LINK_CHUNK * QUERIES_PER_PERSON)) {
      summary.budgetLimited = true;
      break;
    }
    const pass = await advanceDomainLinkRun(db, run.id);
    summary.runs += 1;
    summary.examined += pass.examined;
    summary.linked += pass.linked;
    summary.remaining ||= !pass.complete;
  }
  summary.remaining ||= summary.budgetLimited || runs.length === RUNS_PER_JOB_PASS;
  return summary;
}
