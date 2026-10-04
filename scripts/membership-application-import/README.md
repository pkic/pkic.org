# Batch membership application import

Run `pnpm import:applications` from the repository checkout. The default is an **offline dry run**. Execution uses the existing authenticated import API, one reviewed GitHub issue at a time. It never activates workflows, creates onboarding messages, or edits GitHub issues.

This tool consumes reviewed mappings; it does not infer approvals, match users by similar names, or generate a reviewed manifest from raw issues. Review the source inventory first. Keep manifests and reports in a restricted directory outside the repository; never attach them to a public issue or pull request. The CLI rejects paths inside the repository and writes reports with owner-only permissions.

## Prepare a reviewed manifest

The following is synthetic historical data illustrating the format, not a production-ready mapping. Replace every example with reviewed source evidence before a real import. Include every inventoried issue exactly once, as `import`, `exclude`, or `unresolved`. Exclusions and unresolved entries require a reason and an owner; import entries require a reviewer and review time.

```json
{
  "version": 1,
  "runId": "22222222-2222-4222-8222-222222222222",
  "portalOrigin": "https://pkic.org",
  "environment": "production",
  "sourceData": "private",
  "entries": [
    {
      "decision": "import",
      "sourceIssueNumber": 123,
      "expectedUpdatedAt": "2026-01-01T00:00:00.000Z",
      "reviewedBy": "Application reviewer",
      "reviewedAt": "2026-01-02T00:00:00.000Z",
      "mapping": {
        "manualHold": false,
        "answers": {},
        "applicantName": "Example User",
        "applicantEmail": "user@example.org",
        "organizationName": "Example Organization",
        "categoryCode": null,
        "applicantUserId": null,
        "organizationId": null,
        "outcome": "closed_unknown",
        "mappingReason": "Reviewed the historical application form; its closure does not establish approval.",
        "workflow": null
      }
    },
    {
      "decision": "exclude",
      "sourceIssueNumber": 124,
      "reason": "Not a membership application",
      "owner": "Application reviewer"
    },
    {
      "decision": "unresolved",
      "sourceIssueNumber": 125,
      "reason": "The organization and portal user identity need reconciliation",
      "owner": "Application reviewer"
    }
  ]
}
```

`mapping` and timestamps use the canonical [import request schema](../../assets/shared/schemas/membership-application-import.ts). Use ISO-8601 UTC instants with milliseconds and `Z`. `expectedUpdatedAt` is the reviewed GitHub issue's update time, normalized to that format. Use a fresh UUID for a new reviewed batch. Manifests support up to 2,000 entries; split larger inventories into separately reviewed batches.

Historical unknown fields may be null. Active applications need current form answers, exact user and organization identities, a category, and workflow evidence accepted by the server. Preserve source event references and original review windows. Set `manualHold: true` for an indefinite hold and explain it in `mappingReason`; source issue 795 requires this acknowledgment. See the [import operations guide](../../functions/_lib/services/membership/applications/IMPORTS.md) for eligibility, workflow mapping, and activation rules.

The production destination must match `env.production.vars.APP_BASE_URL` in `wrangler.jsonc`. Preview is not an import target. For isolated local rehearsals only, use `environment: "local"`, `sourceData: "synthetic"`, and an HTTP loopback origin. Never put private production data into a local or preview rehearsal.

## Validate without importing

```sh
pnpm import:applications --manifest /secure/pkic-import/reviewed.json --report /secure/pkic-import/dry-run.json
```

No credential or network access is needed. The dry run validates the manifest against the shared request contract and writes counts and per-issue decisions. It cannot verify live GitHub eligibility, the latest source revision, portal identities, form versions, workflow evidence, or server configuration. `ready` means contract-valid for submission, not approved or confirmed importable. Unresolved entries produce exit code 2 even in a dry run.

## Execute the reviewed batch

Obtain explicit operational approval separately from deploying this code. Migration 0037 must already be applied through the approved migration process, and production must have `GITHUB_MEMBERS_IMPORT_TOKEN` configured with read-only access to `pkic/members`. The CLI does not configure secrets or apply migrations.

Supply `PKIC_PORTAL_SESSION_TOKEN` securely through the environment: an unexpired portal **user session** with `membership:approve`, not a portal API key or the GitHub source token. Do not put credentials in arguments, manifests, reports, or shell history. The CLI sends this bearer credential only to the validated origin and refuses HTTP redirects.

Use a different report path from the dry run:

```sh
pnpm import:applications --manifest /secure/pkic-import/reviewed.json --report /secure/pkic-import/results.json --execute
```

The server rereads each source and validates eligibility and mappings before its atomic import. Excluded and unresolved rows are never submitted. Per-issue refusals such as 409 or 422 are recorded and execution continues; authentication failures (401/403), rate limiting (429), server failures, transport failures, and invalid responses stop the batch. Requests have a 120-second timeout, adjustable with `--timeout-seconds` from 1 to 600. There are no automatic retries.

## Resume and recover

Each request has a saved `in_flight` checkpoint before transmission and a saved result afterward. Reports are replaced atomically. Ctrl+C or SIGTERM records an interruption when possible. A timeout, lost response, or process crash can leave a request's outcome uncertain; the server's stable source identity prevents a replay from creating another application.

After resolving the failure, resume with the **same manifest, run ID, destination, and report**:

```sh
pnpm import:applications --manifest /secure/pkic-import/reviewed.json --report /secure/pkic-import/results.json --execute --resume
```

Resume skips imported, already-present, excluded, and unresolved rows. It retries failed, uncertain, in-flight, and pending rows. It refuses a dry-run report, changed manifest, missing report, or mismatched row identity. It also refuses to overwrite an existing report without `--resume`.

A `.lock` file beside the report prevents concurrent runs against that report. After a hard termination, inspect the lock's PID and verify the previous process is no longer running before removing the stale lock. Never remove a live run's lock. Keep the directory on a local filesystem with reliable exclusive creation and atomic rename.

If a mapping or source revision must change, obtain a new review and use a new manifest, run ID, and report. Preserve the earlier files for reconciliation. Do not edit a report to mark work successful. Already imported sources retain their first mapping; reimporting does not correct them. Follow the operations guide's guarded correction process for an erroneous committed mapping.

## Read the results

The JSON report includes the manifest fingerprint, destination, run ID, phase, counts, and each issue's status, request fingerprint, attempt count, timestamps, and returned application ID when available. It intentionally omits form answers, applicant details, reviewer names, mapping reasons, credentials, and raw response/error bodies. Issue numbers and application IDs remain sensitive operational references; keep the report private.

- `ready`: offline contract validation passed; no request sent.
- `pending` / `in_flight`: not yet submitted / checkpointed before submission.
- `imported` / `already_present`: server confirmed a new import / an existing source import.
- `excluded` / `unresolved`: reviewed inventory decisions; no request sent.
- `failed`: server refused this request; inspect its HTTP status and reconcile.
- `uncertain`: the CLI cannot confirm the server's final outcome; resume safely by source identity.

Exit codes: **0** means a valid dry run without unresolved rows or a completed execution; **1** means invalid input or a local failure; **2** means unresolved or incomplete work; **130** means interrupted execution. An already-present result confirms source identity, not that a later proposed mapping matches the stored record.

Reconcile total inventory counts and inspect application history in the portal before declaring the import complete. For an example organization, verify its application form answers, linked user, source attribution, discussion, and outcome. Imported active applications remain suspended until the separately authorized activation process. Remove production GitHub source access when cutover is complete.

## Focused verification

```sh
pnpm run test:tools tests/tools/application-import-batch.test.ts tests/tools/application-import-cli.test.ts
```

Tests use synthetic organizations, users, and forms. They cover offline validation, real CLI execution against a local HTTP fixture, private report writes, interrupted/ambiguous requests, and resume without repeating successful work. They do not contact production or import GitHub data.
