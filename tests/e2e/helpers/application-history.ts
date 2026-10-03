import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** Purpose-created history in the fresh local E2E database; no private GitHub source is used. */
export function seedSyntheticApplicationHistory() {
  const state = readFileSync("test-results/e2e-state-dir", "utf8").trim();
  if (!basename(state).startsWith("pkic-e2e.")) throw new Error("Expected isolated E2E state");
  const id = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const issueNumber = Number.parseInt(id.slice(0, 8), 16) + 1000000;
  const now = "2026-01-01T12:00:00.000Z";
  const snapshot = JSON.stringify({
    title: "Example Organization application",
    body: "Application form: Example User applied on behalf of Example Organization. Consent was not recorded.",
    labels: [{ id: 1, name: "Membership application" }],
    state: "closed",
    closureReason: "completed",
    events: [
      {
        id: "1",
        kind: "comment",
        author: "synthetic-reviewer",
        body: "The application was closed; the membership outcome is unknown.",
        createdAt: now,
      },
    ],
    attachmentUrls: [],
    warnings: [],
  }).replaceAll("'", "''");
  const folder = mkdtempSync(join(tmpdir(), "pkic-history-fixture-"));
  try {
    const file = join(folder, "fixture.sql");
    writeFileSync(
      file,
      `INSERT INTO membership_application_import_runs (id, actor_user_id, created_at) SELECT '${runId}', id, '${now}' FROM users ORDER BY id LIMIT 1;
      INSERT INTO membership_application_sources (id, repository, issue_id, issue_number, issue_url, run_id, applicant_name, organization_name, outcome, source_created_at, source_updated_at, closed_at, snapshot_json, imported_at)
      VALUES ('${id}', 'pkic/members', '${id}', ${issueNumber}, 'https://github.com/pkic/members/issues/${issueNumber}', '${runId}', 'Example Historical User', 'Example Historical Organization', 'closed_unknown', '${now}', '${now}', '${now}', '${snapshot}', '${now}');`,
      { mode: 0o600 },
    );
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "pkic-db-local",
        "--env",
        "local",
        "--local",
        `--persist-to=${state}`,
        "--file",
        file,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return { id, issueNumber };
}
