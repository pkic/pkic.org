/**
 * Finish existing domain-link runs without automatically affiliating people.
 * A verified address supports an organization offer; the person must choose.
 */
import { all, first } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { hostWithinDomainSql } from "../../email-domains/sql";
import { requestJobWake } from "../scheduled-jobs/dispatcher";
import { domainOwnershipFactMatchesSql, FACT_ORGANIZATION } from "../identities/verified-email-domain";

/** People examined per pass of one run. */
export const DOMAIN_LINK_CHUNK = 10;
/** One read and one completion batch per previously scheduled run. */
const QUERIES_PER_RUN = 2;
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

/** A claim never automatically affiliates verified people. */
export async function previewDomainLinking(
  db: DatabaseLike,
  organizationId: string,
  domain: string,
): Promise<{ peopleToLink: number; shared: boolean }> {
  const count = await first<{ count: number; shared: number }>(
    db,
    `${CANDIDATES_SQL}
    SELECT COUNT(*) AS count, EXISTS (SELECT 1 FROM identities fact WHERE fact.organization_id IS NOT NULL
      AND ${domainOwnershipFactMatchesSql()} AND ${FACT_ORGANIZATION} IS NOT ?) AS shared FROM candidates`,
    [domain, domain, organizationId, organizationId, domain, domain, domain, organizationId],
  );
  return { peopleToLink: 0, shared: Boolean(count?.shared) };
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

/** Retire a previously scheduled run without making an affiliation decision. */
export async function advanceDomainLinkRun(
  db: DatabaseLike,
  runId: string,
  _limit = DOMAIN_LINK_CHUNK,
): Promise<{ complete: boolean; examined: number; linked: number }> {
  const run = await first<LinkRun>(
    db,
    `SELECT id, organization_id, domain, cursor_user_id, examined, linked FROM organization_domain_link_runs
      WHERE id = ? AND completed_at IS NULL`,
    [runId],
  );
  if (!run) return { complete: true, examined: 0, linked: 0 };
  await db.batch(prepareRunCompletion(db, run, nowIso(), "user_confirmation_required"));
  return { complete: true, examined: 0, linked: 0 };
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
    if (!hasD1QueryCapacity(budget, QUERIES_PER_RUN)) {
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
