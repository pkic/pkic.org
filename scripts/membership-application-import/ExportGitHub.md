# Export and review GitHub membership applications

This guide prepares a version-2 manifest for `pnpm import:applications`. It exports evidence, creates an unresolved inventory, walks through reviewing an application, and covers local rehearsal, synthetic preview imports, and production execution.

The application issues are in **pkic/members**.

`/secure/reviewed.json` in the repository README is an example path. This guide uses `$HOME/pkic-application-backfill/reviewed.json` instead.

## 1. Open a terminal in the repository

Use a checkout containing the backfill CLI. Run all commands in this guide from the same terminal session and repository directory:

```sh
cd ~/git/pkic.org
pnpm import:applications --help
gh auth status
```

Your GitHub account must have read access to the private `pkic/members` repository. If needed, authenticate with `gh auth login`. The examples use the repository's installed Node dependencies, `pnpm`, and GitHub CLI.

Prepare a private directory outside the repository:

```sh
umask 077
export BACKFILL_DIR="$HOME/pkic-application-backfill"
mkdir -p "$BACKFILL_DIR"
chmod 700 "$BACKFILL_DIR"
```

Keep source exports, review files, manifests, and results reports private. Do not commit them or attach them to a public issue. Private production application evidence is allowed in local and production databases. Preview requires independently prepared synthetic fixtures; never relabel private evidence as synthetic.

If you reopen the terminal, repeat the `cd`, `umask`, and `export BACKFILL_DIR` commands.

## 2. Export the issue inventory

This exports all open and closed issues **currently carrying** the exact `Membership application` label. It excludes pull requests and follows every result page. It does not find issues whose application label was removed; reconcile any separately known historical issues before declaring the inventory complete.

The command uses the standalone `jq` program to process GitHub's paginated output. `gh api` does not support combining `--slurp` with its own `--jq` option.

```sh
(
  set -eu
  set -o pipefail
  : "${BACKFILL_DIR:?Set BACKFILL_DIR first}"
  inventory_tmp=$(mktemp "$BACKFILL_DIR/.issues.XXXXXX")
  trap 'rm -f "$inventory_tmp"' EXIT
  gh api --method GET --paginate --slurp \
    'repos/pkic/members/issues?state=all&labels=Membership%20application&per_page=100' \
    | jq -e '[.[][] | select(.pull_request == null)]' > "$inventory_tmp"
  ln "$inventory_tmp" "$BACKFILL_DIR/issues.json"
)
```

The command requires `jq` (`jq --version` checks availability). It writes to a private temporary file, publishes `issues.json` only after both commands succeed, and refuses to overwrite an existing inventory. The temporary file is cleaned up on exit.

If the earlier command failed because `--slurp` and `--jq` were combined, shell redirection may have left an empty `issues.json`. Remove only that empty file before retrying:

```sh
if [ -f "$BACKFILL_DIR/issues.json" ] && [ ! -s "$BACKFILL_DIR/issues.json" ]; then
  rm "$BACKFILL_DIR/issues.json"
fi
```

Keep an existing nonempty inventory; inspect or archive it before deliberately replacing it.

Show the issue count and numbers:

```sh
pnpm exec node --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const issues = JSON.parse(await readFile(join(process.env.BACKFILL_DIR, "issues.json"), "utf8"));
console.log(`Applications: ${issues.length}`);
console.log(issues.map(issue => `#${issue.number}`).join(", "));
JS
```

The manifest supports up to 2,000 entries. If the inventory exceeds this, divide it into separately reviewed batches with distinct run IDs and reports, and reconcile their combined inventory.

## 3. Export the full evidence for every issue

The issue list is not enough for an import. Each source needs its issue, comments, and timeline. This command reuses the CLI's existing reader and timestamp normalization.

It creates `source-123.json` for issue #123. It reads GitHub and writes private local files only; it does not access D1 or import anything into the portal.

```sh
pnpm exec node --input-type=module <<'JS'
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { readGithubSource } from "./scripts/membership-application-import/github.mjs";

const directory = process.env.BACKFILL_DIR;
const issues = JSON.parse(await readFile(join(directory, "issues.json"), "utf8"));
for (const issue of issues) {
  const path = join(directory, `source-${issue.number}.json`);
  try {
    await access(path);
    console.log(`Already exported #${issue.number}; keeping existing evidence`);
    continue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const source = await readGithubSource(issue.number, AbortSignal.timeout(120_000));
  await writeFile(path, JSON.stringify(source, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(`Exported #${issue.number}`);
}
JS
```

If a request fails, fix access or connectivity and rerun. Completed files are kept. If a source exceeds the reader's bounds or cannot be exported, keep that issue unresolved and investigate separately. A file that exists but is incomplete must be inspected and replaced before review.

Existing files are snapshots, not automatically refreshed. To refresh evidence, archive the old file privately, rerun the export, and review the new evidence. Execution will refuse a source that no longer matches the reviewed snapshot.

## 4. Create a manifest with every issue unresolved

Find the existing portal staff user's ID to use as the actor recording the backfill. This is a portal user ID, not a GitHub username. The user must be active and not redacted.

Set these values, replacing both examples:

```sh
export BACKFILL_ACTOR_ID='REPLACE_WITH_EXISTING_PORTAL_STAFF_USER_ID'
export BACKFILL_REVIEWER='REPLACE_WITH_REVIEWER_NAME'
```

Create the initial manifest. The script reads the production DB binding from `wrangler.jsonc`, generates a new run UUID, and marks every issue unresolved. It does not contact Cloudflare or write to a database.

```sh
pnpm exec node --input-type=module <<'JS'
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const actor = process.env.BACKFILL_ACTOR_ID;
const reviewer = process.env.BACKFILL_REVIEWER;
if (!actor || !reviewer || actor.startsWith("REPLACE_") || reviewer.startsWith("REPLACE_")) {
  throw new Error("Set the real portal staff user ID and reviewer name first");
}
const directory = process.env.BACKFILL_DIR;
const issues = JSON.parse(await readFile(join(directory, "issues.json"), "utf8"));
if (!issues.length || issues.length > 2000) throw new Error("Review the inventory size before continuing");
const config = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8"));
if (config.error) throw new Error("Cannot parse wrangler.jsonc");
const databaseId = config.config.env.production.d1_databases.find(binding => binding.binding === "DB")?.database_id;
if (!databaseId) throw new Error("Production DB binding is missing");
const manifest = {
  version: 2,
  runId: randomUUID(),
  actorUserId: actor,
  environment: "production",
  databaseId,
  localDirectory: null,
  sourceData: "private",
  entries: issues.map(issue => ({
    decision: "unresolved",
    sourceIssueNumber: issue.number,
    reason: "Awaiting evidence and mapping review",
    owner: reviewer,
  })),
};
await writeFile(join(directory, "reviewed.json"), JSON.stringify(manifest, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log("Created reviewed.json with every issue unresolved; review is still required");
JS
```

The filename is the eventual reviewed-manifest filename; creating it does not establish that review is complete. This command refuses to overwrite an existing manifest.

## 5. Review each issue

Open `issues.json`, the relevant `source-NUMBER.json`, and `reviewed.json` in your text editor.

For each issue, choose one decision:

- **import**: the evidence supports an outcome that the current portal can represent, and all required mappings are known.
- **unresolved**: the outcome or required fields are unknown, the application is still open, or it requires an unsupported workflow or indefinite hold.
- **exclude**: the issue should not be imported; record a specific reason and owner.

Keep every inventoried issue exactly once in the manifest. Do not turn a closed GitHub issue into an approved application without decision evidence. Issue #795 and other unsupported holds remain unresolved.

An unresolved entry looks like this:

```json
{
  "decision": "unresolved",
  "sourceIssueNumber": 795,
  "reason": "Indefinite hold is unsupported by the current portal",
  "owner": "Application reviewer"
}
```

An excluded entry has the same fields with `"decision": "exclude"`. Do not add `source`, `mapping`, or reviewer fields to these entries; their contract is strict.

### Prepare a candidate import entry

For an issue you intend to review for import, set its actual number:

```sh
export BACKFILL_ISSUE_NUMBER='123'
```

Generate a separate candidate review file containing the complete exported source:

```sh
pnpm exec node --input-type=module <<'JS'
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const directory = process.env.BACKFILL_DIR;
const number = Number(process.env.BACKFILL_ISSUE_NUMBER);
if (!Number.isSafeInteger(number) || number < 1) throw new Error("Set a valid issue number");
const source = JSON.parse(await readFile(join(directory, `source-${number}.json`), "utf8"));
const candidate = {
  decision: "import",
  sourceIssueNumber: number,
  source,
  reviewedBy: "",
  reviewedAt: "",
  mapping: {
    applicantName: null,
    applicantEmail: null,
    organizationName: null,
    membershipCategory: null,
    applicantUserId: null,
    outcome: null,
    decisionAt: null,
    mappingReason: "",
  },
};
await writeFile(join(directory, `review-${number}.json`), JSON.stringify(candidate, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(`Created review-${number}.json; complete the review fields before using it`);
JS
```

The candidate intentionally fails validation until you fill its review fields. Do not alter the `source` object to force eligibility.

Fill these fields from evidence:

| Field | What to enter |
| --- | --- |
| `reviewedBy` | The person who performed the mapping review |
| `reviewedAt` | Actual review time in UTC, such as `2026-10-04T16:30:00.000Z` |
| `applicantName` | Evidenced applicant name; use Example User only in synthetic fixtures |
| `applicantEmail` | Evidenced, normalized applicant email |
| `organizationName` | Evidenced organization name; null for an individual category |
| `membershipCategory` | An existing portal category code, verified against current reference data |
| `applicantUserId` | Null, or an existing non-redacted portal user whose normalized primary or recorded secondary email matches the application email |
| `outcome` | Evidenced `approved`, `declined`, or `withdrawn` |
| `decisionAt` | Evidenced decision instant in UTC with milliseconds and `Z` |
| `mappingReason` | A concrete explanation of the evidence supporting the outcome and mapping |

Generate the current UTC review timestamp with:

```sh
pnpm exec node -e 'console.log(new Date().toISOString())'
```

The decision time must fall between source creation and final closure. Do not use closure time as decision time unless the evidence establishes that relationship. Keep unsupported timing unresolved.

Check existing portal applications for possible matches before importing. Do not invent missing form answers or consent. Original form text and discussion will be preserved as private notes.

### Put the reviewed entry into the manifest

After completing the candidate review, copy its entire JSON object into `reviewed.json`, replacing the unresolved entry for that issue. Preserve the outer manifest and all other entries. The `source` field must contain the exported object, not a filename or a string containing JSON.

JSON does not permit comments or trailing commas. Keep candidate review files private alongside the evidence.

## 6. Run the offline dry run

After reviewing the inventory, run:

```sh
pnpm import:applications \
  --manifest "$BACKFILL_DIR/reviewed.json" \
  --report "$BACKFILL_DIR/dry-run.json"
```

This does not access GitHub or D1 and does not import records. It checks the manifest and reviewed evidence available locally.

Read the report and reconcile:

- `ready`: passed offline checks; database identities, categories, and current source state are not yet confirmed.
- `excluded`: intentionally omitted with an explanation in the manifest.
- `unresolved`: unsupported or incomplete; no database write will be attempted for these entries.

Exit code 2 is expected if unresolved entries remain. A schema error must be corrected before proceeding. Invalid placeholders are errors, not a successful review.

Reports are not overwritten. After changing the manifest, use a new report path, for example `dry-run-02.json`. Do not use execution resume to reuse a dry-run report.

## 7. Prepare each destination

Use a separate manifest, run ID, and report for local, preview, and production. The manifest selects the destination; there is no command-line environment override. Copy the reviewed private manifest to `local-reviewed.json` for rehearsal. Prepare `preview-reviewed.json` independently with synthetic evidence throughout, including source bodies, comments, timeline metadata, reviewer details, and application mappings. Keep `reviewed.json` as the production manifest.

Set the following fields in each destination manifest:

| Field | Local | Preview | Production |
| --- | --- | --- | --- |
| `environment` | `local` | `preview` | `production` |
| `databaseId` | `env.local` DB binding ID | `env.production` DB `preview_database_id` | `env.production` DB binding ID |
| `localDirectory` | Canonical absolute persistence root | `null` | `null` |
| `actorUserId` | Existing local staff user ID | Existing preview staff user ID | Existing production staff user ID |
| `runId` | New UUID | New UUID | Original production run UUID |
| `sourceData` | `private` for exported evidence, or `synthetic` for fixtures | `synthetic` only | `private` for exported evidence |

Read the binding IDs from `wrangler.jsonc`. Generate a new run ID with `pnpm exec node -e 'console.log(require("node:crypto").randomUUID())'`. Do not substitute the production binding for preview. Local may share the configured production ID, but the importer always passes `--local` for the local destination.

Review each non-null `mapping.applicantUserId` against the destination database. Production user IDs do not establish local or preview identity. Use `null` when no reviewed destination user link exists; the applicant's evidenced name and email remain in the application. Check category availability and organization requirements in each destination as well.

Every destination must already have the current application schema, reference categories, and an active, non-redacted staff actor. The importer creates none of these. Local setup uses the repository's local migration and seed workflow. Remote migrations are separate, explicitly approved operations through `pnpm migrate:preview` or `pnpm migrate:production`; deployment does not apply them.

### Local import

Keep `sourceData: "private"` when copying the reviewed production manifest. Private local execution requires read access to `pkic/members` through `gh` and revalidates the source before writing, just like production. Local D1 writes do not require Cloudflare credentials. Keep the persistence directory private as it will contain original applicant data and discussion.

Use the persistence root used by the local development server, usually `.wrangler/state`, not its nested `v3/d1` directory. Initialize the local database first, then obtain its canonical path:

```sh
pnpm exec node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' .wrangler/state
```

Put that result in `localDirectory`. A separate rehearsal server may use another root; use that server's actual root instead.

```sh
pnpm import:applications --manifest "$BACKFILL_DIR/local-reviewed.json" --report "$BACKFILL_DIR/local-dry-run.json"
pnpm import:applications --manifest "$BACKFILL_DIR/local-reviewed.json" --report "$BACKFILL_DIR/local-results.json" --execute
```

Inspect the imported applications in the local portal connected to that persistence root. To resume an interrupted execution:

```sh
pnpm import:applications --manifest "$BACKFILL_DIR/local-reviewed.json" --report "$BACKFILL_DIR/local-results.json" --execute --resume
```

### Preview import

Do not copy the production manifest into preview. Build a complete synthetic manifest using the [fixture builder](../../tests/helpers/application-backfill.ts) as the source-shape reference, then review its destination-specific actor and mappings. Preview uses embedded synthetic evidence and does not require GitHub credentials.

Preview uses `--env production --preview --remote` with the preview DB binding. All branch previews share this database, so coordinate the import with other preview users. Authenticate the operator's Wrangler session before execution.

```sh
pnpm import:applications --manifest "$BACKFILL_DIR/preview-reviewed.json" --report "$BACKFILL_DIR/preview-dry-run.json"
pnpm import:applications --manifest "$BACKFILL_DIR/preview-reviewed.json" --report "$BACKFILL_DIR/preview-results.json" --execute
```

Inspect the records in the preview portal. To resume:

```sh
pnpm import:applications --manifest "$BACKFILL_DIR/preview-reviewed.json" --report "$BACKFILL_DIR/preview-results.json" --execute --resume
```

Neither destination can resume another destination's report. A changed manifest requires a fresh report; retain previous reports for reconciliation.

## 8. Production execution is a separate operation

Complete the local rehearsal and verification checklist below before the production run. Confirm the production manifest still has its production actor, binding, and reviewed user links; do not promote local IDs or reuse local reports. Production execution remains a separately authorized operation. Setting `environment` to `production` in the manifest does not itself execute anything.

The CLI requires the operator's existing GitHub and Wrangler credentials for execution. It uses the existing database schema; it does not apply migrations or deploy code.

For an authorized production run only:

```sh
pnpm import:applications \
  --manifest "$BACKFILL_DIR/reviewed.json" \
  --report "$BACKFILL_DIR/results.json" \
  --execute
```

To resume an interrupted execution, use the exact same manifest and execution report:

```sh
pnpm import:applications \
  --manifest "$BACKFILL_DIR/reviewed.json" \
  --report "$BACKFILL_DIR/results.json" \
  --execute --resume
```

Execution rereads GitHub evidence. If the source changed, refresh and review it instead of bypassing the check. A revised manifest needs a new report. Do not edit reports to mark records successful.

## 9. Verify and reconcile the result

After authorized execution:

1. Reconcile imported, already-present, excluded, and unresolved counts against the complete inventory.
2. Find an imported application using the existing Applications list and terminal-stage filter.
3. Check applicant, organization/category, submission time, and terminal status.
4. Inspect source evidence under Communications. The existing table clips long notes; verify complete stored note bodies through an authorized read-only database query.
5. Confirm missing form answers remain unknown and no review workflow restarted.
6. Confirm the backfill created no accounts, organizations, memberships, or outgoing emails.
7. Preserve private manifests, evidence, and reports for reconciliation and recovery.

Completion of supported records does not resolve unsupported entries or prove the entire historical inventory has been migrated.

## References

- Repository instructions: `scripts/membership-application-import/README.md`
- GitHub CLI pagination: https://cli.github.com/manual/gh_api
- Backfill implementation: https://github.com/pkic/pkic.org/pull/809
