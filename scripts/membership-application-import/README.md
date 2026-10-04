# Membership application backfill

`pnpm import:applications` is an operator-run batch CLI for writing supported GitHub history into the **existing** portal application records. It needs no application deployment, new API endpoint, Worker secret, or schema migration. Applications use the normal list, stage filters, detail screen, and private internal notes.

The default is an offline dry run. Execution is explicit, checkpointed, and resumable. The CLI writes only `member_applications`, `application_communications` with `kind = note`, and the existing audit log. It does not create users, organizations, memberships, form answers, workflows, outbox messages, domain claims, or GitHub comments. Original application-form content and source evidence are retained as internal notes; missing current-form answers and consent stay unknown.

## Supported records and unresolved work

An import must be an actual issue with the exact `Membership application` label, currently closed as completed with an unambiguous final closure and no effective duplicate disposition. GitHub completion is **not** proof of membership approval. A reviewer must supply a supported outcome (`approved`, `declined`, or `withdrawn`), its evidenced decision time, applicant name and email, and an existing category. Organization categories require an organization name; individual categories require null. An optional applicant user link must match an existing non-redacted user's exact normalized email.

Open applications, indefinite holds (including source #795), unknown outcomes, missing required fields, and unsupported review timing remain explicitly `unresolved`. They are not coerced into another lifecycle state and are never submitted to the database. Keep their reasons and owners in the reviewed inventory. Their exclusion from this backfill is not a claim that the entire original migration request is complete.

The source issue URL, body, labels, timestamps, comments with original authors, and timeline evidence are retained in ordinary private notes. The note's staff actor identifies the operator recording the evidence; its text identifies the original GitHub author and source timestamp. Notes are recorded at the actual backfill time; staff actions are not backdated. Attachments remain source links, and their continued availability must be reviewed. No private files are copied into public assets.

## Reviewed manifest, version 2

Keep the manifest, source exports, generated SQL, and reports in a restricted directory **outside the repository**. The directory must already exist. Reports and temporary SQL files use owner-only permissions. Never publish them in a PR or issue. Version-1 manifests and reports from the superseded portal-API importer are rejected; review a new version-2 manifest.

The root fields are:

| Field | Meaning |
| --- | --- |
| `version` | `2` |
| `runId` | UUID used only in private reports, never stored in application tables |
| `actorUserId` | Existing active, non-redacted staff user recording the source notes |
| `environment` | `production`, `preview`, or `local`; the manifest selects the destination |
| `databaseId` | Exact `DB` binding ID from that environment in `wrangler.jsonc` |
| `localDirectory` | `null` for production/preview; canonical absolute D1 persistence root for local use |
| `sourceData` | `private` or `synthetic`; local and preview require `synthetic` |
| `entries` | Up to 2,000 reviewed entries, with unique source issue numbers |

An `import` entry contains the full reviewed `source` object (`repository: "pkic/members"`, numeric `labelId`, `issue`, all `comments`, and all `timeline` pages), plus:

```json
{
  "decision": "import",
  "sourceIssueNumber": 123,
  "reviewedBy": "Application reviewer",
  "reviewedAt": "2026-10-04T12:00:00.000Z",
  "mapping": {
    "applicantName": "Example User",
    "applicantEmail": "user@example.org",
    "organizationName": "Example Organization",
    "membershipCategory": "A",
    "applicantUserId": null,
    "outcome": "declined",
    "decisionAt": "2020-01-02T00:00:00.000Z",
    "mappingReason": "The source review comment explicitly records the rejection decision."
  }
}
```

This fragment omits `source` for readability; it is not executable as-is. See the complete [synthetic fixture builder](../../tests/helpers/application-backfill.ts) for the source shape. Actual manifests must use independently reviewed evidence. Use UTC timestamps with milliseconds and `Z`. Do not use closure time as decision time without evidence, or fill missing fields with placeholders. Nullable mapping values remain unresolved rather than inventing history.

For decisions not ready for import, use:

```json
{"decision":"unresolved","sourceIssueNumber":795,"reason":"Indefinite hold cannot be represented safely by the current portal","owner":"Application reviewer"}
```

`exclude` has the same reason/owner shape. Include every inventoried issue exactly once. Review potential existing portal matches and exact identities before executing; the database guard additionally refuses another application with the same email and source creation time.

## Dry run

```sh
pnpm import:applications --manifest /secure/reviewed.json --report /secure/dry-run.json
```

No GitHub or Cloudflare access is used. The report distinguishes ready, excluded, and unresolved entries and includes safe reason codes for automatically unresolved imports. `ready` means the offline contract and evidence checks passed; it does not confirm current GitHub state, database identities, or category availability. Unresolved work returns exit code 2.

## Choose a local or preview database

The destination comes from the manifest, not a CLI override. Every environment must use the exact `DB.database_id` under its own `env` entry in `wrangler.jsonc`. Unknown environments and mismatched IDs are rejected before execution. Use a distinct reviewed manifest, run ID, and report for each destination; an execution report cannot be resumed against another environment or local directory.

Local and preview runs require **synthetic evidence throughout the manifest**, including original form text, comments, timeline metadata, names, and email addresses. Do not relabel a private GitHub export as synthetic. Use Example User and Example Organization fixtures prepared independently of production data. Both targets need their own existing active staff actor and valid category; the importer does not seed users, categories, or apply migrations.

### Local D1

Set these fields on a complete synthetic manifest (the fragment is not a complete manifest):

```json
{
  "environment": "local",
  "databaseId": "<env.local.d1_databases DB database_id>",
  "localDirectory": "<canonical absolute persistence root>",
  "sourceData": "synthetic"
}
```

Use the same persistence root as the local development server, not its nested `v3/d1` directory. The directory must already exist. It may be inside the checkout, such as the development server's ignored `.wrangler/state` directory; manifests and reports must still remain outside the checkout. Resolve the actual path, including macOS symlinks, before placing it in the manifest:

```sh
pnpm exec node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' /path/to/local/persistence
```

The CLI passes `--env local --local --persist-to <localDirectory>` to Wrangler and never accesses a remote D1 database for this destination.

```sh
pnpm import:applications --manifest /secure/local-reviewed.json --report /secure/local-dry-run.json
pnpm import:applications --manifest /secure/local-reviewed.json --report /secure/local-results.json --execute
pnpm import:applications --manifest /secure/local-reviewed.json --report /secure/local-results.json --execute --resume
```

### Preview D1

Set these fields on a complete synthetic manifest:

```json
{
  "environment": "preview",
  "databaseId": "<env.preview.d1_databases DB database_id>",
  "localDirectory": null,
  "sourceData": "synthetic"
}
```

The CLI passes `--env preview --remote` to Wrangler, targeting the preview environment's configured `DB` binding. It does not use the production binding or Wrangler's separate `--preview` flag. Preview execution needs the operator's Cloudflare credentials; it does not need GitHub credentials. All branch previews share this remote database, so choose synthetic application identities deliberately and coordinate their use. An offline dry run does not write to preview.

```sh
pnpm import:applications --manifest /secure/preview-reviewed.json --report /secure/preview-dry-run.json
pnpm import:applications --manifest /secure/preview-reviewed.json --report /secure/preview-results.json --execute
pnpm import:applications --manifest /secure/preview-reviewed.json --report /secure/preview-results.json --execute --resume
```

## Execute and resume

Production backfill remains a separately authorized data operation. Authenticate the operator's existing `gh` and Wrangler sessions for read-only access to `pkic/members` and the intended D1 database. Do not put credentials in arguments, source files, manifests, or reports. No portal session token or deployed GitHub import secret is used. The target database must already have the existing application schema, including migration 0036; this CLI never applies migrations.

```sh
pnpm import:applications --manifest /secure/reviewed.json --report /secure/results.json --execute
pnpm import:applications --manifest /secure/reviewed.json --report /secure/results.json --execute --resume
```

Production execution rereads every source's issue, comments, and timeline using `gh`, and verifies it matches the reviewed evidence. Local and preview execution use the embedded synthetic evidence and never fetch private GitHub sources. It checks for an existing source-derived application identity, then submits one bounded SQL file per source through Wrangler's D1 import command. The file uses the existing tables and constraints. All dependent inserts are guarded so replay cannot change an existing application, restore removed notes, or duplicate the audit. Existing records with a conflicting identity stop the run for reconciliation. Database constraints also protect category, user, and duplicate-match checks within the write boundary.

A source change is recorded as a failure without writing it. Operational failures stop the batch; a write whose result cannot be confirmed is `uncertain`. Resolve the problem, then resume the exact manifest and report. Confirmed rows are skipped. Stable source-derived record IDs protect against repeating a committed write after a lost response. An `already_present` result confirms an earlier record, not that its mapping equals a later proposal. Corrections require a separately reviewed normal data correction, not another import.

Ctrl+C and SIGTERM stop child processes and checkpoint when possible. A remote import already submitted may still complete; resume reconciles its identity. `--timeout-seconds` sets a per-source bound (default 120, range 1–600). There is no automatic retry. An exclusive `.lock` beside the report prevents concurrent runs using that report; after a hard termination, verify its PID is no longer running before removing a stale lock. Keep files on a filesystem supporting reliable exclusive creation and atomic rename.

The report contains counts, issue numbers, fingerprints, destination, attempts, result IDs, and safe failure categories. It omits applicant data, source bodies, reviewer names, credentials, and raw command errors. The run ID and bookkeeping stay outside the database. Preserve prior reports for recovery; never edit them to mark a row successful. A changed manifest needs a new review and a new report.

Exit codes: **0** complete; **1** invalid input or local failure; **2** unresolved/incomplete; **130** interrupted. Completion of supported rows does not resolve unsupported inventory entries.

## Synthetic verification and operational review

```sh
pnpm run test:tools tests/tools/application-import-batch.test.ts tests/tools/application-import-cli.test.ts tests/tools/application-import-destinations.test.ts
pnpm run test:e2e tests/e2e/application-backfill.spec.ts
```

The tests apply the unchanged schema to a fresh isolated local D1 database. They exercise the actual CLI, rollback, replay after portal edits, private reports, and absence of account, membership, workflow, or email effects. Never use production source exports or credentials for local/preview rehearsal.

After an authorized backfill, use the normal portal Applications list and its existing stage filter to find an example organization. Open its detail and inspect the applicant, category, terminal status, and original form/discussion evidence in internal notes. The existing Communications table clips long note text; verify the complete stored `application_communications.body` against the reviewed evidence through an authorized read-only database query. Improving that general-purpose note display is outside this backfill-only PR. Missing form answers should remain empty; no review should restart. Confirm no onboarding or email was produced and reconcile imported, already-present, excluded, and unresolved counts against the complete source inventory.

For a wrong committed mapping, stop the run, preserve the reviewed manifest and report, and identify affected records by their reported IDs. Prepare a guarded correction that preserves later portal edits and evidence. Do not restore the whole database, delete arbitrary application records, or attempt to overwrite them with this CLI. Retire the operational tool after all supported cutover work and reconciliation are complete; no deployed code depends on it.
