# Google Groups sync dry run

The default incremental mode runs the production sync use case against a read-only local SQLite database and a recording Directory adapter. It reports the next due queue batch (default 25, maximum 100), including planned adds/removes, suppressed adds, and missing users. This mode does not reconcile every subscriber or re-enroll people who left a group. Already satisfied membership intents are recorded too: the live adapter applies them idempotently.

The CLI never claims jobs, updates attempts or observations, sends notifications, or writes to Google Groups. It authenticates and reads each affected group's membership, following pagination. Authentication, permission, and incomplete-listing failures stop the run with a nonzero exit code. An empty due batch does not contact Google.

## Credentials

1. In Google Cloud Console, enable the **Admin SDK API**. Create a service account without project IAM roles. Create and securely store a JSON key outside the repository.
2. In Workspace Admin console, open **Security → Access and data control → API controls → Manage Domain Wide Delegation**. Add the service account's numeric client ID with only these scopes:
   - `https://www.googleapis.com/auth/admin.directory.group.member.readonly`
   - `https://www.googleapis.com/auth/admin.directory.group.readonly`
3. Create a dedicated Workspace user with a custom admin role restricted to **Groups (read)**. Pass this user's email as `--impersonate`. Never impersonate a super administrator. A super administrator may be required to configure delegation, but is not the runtime identity.
4. Allow delegation changes time to propagate. Do not grant write scopes to make this dry run work.

See Google's [service-account delegation guide](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority) and [Directory API authorization guide](https://developers.google.com/workspace/admin-sdk/directory/v1/guides/authorizing).

## Run

Use Node 22.15+ or a supported newer Node version. Point at an existing local SQLite database with the final application schema and queued membership intents. Keep the database and output in the same approved environment as its data; never put production personal data in preview or commit it. For an initial test, use a synthetic local fixture and a purpose-created Workspace test group.

```sh
pnpm exec node scripts/google-groups-sync-dry-run.mjs \
  --database /secure/path/application.sqlite \
  --credentials /secure/path/groups-reader.json \
  --impersonate groups-reader@example.org \
  --limit 25
```

The JSON report includes email addresses: share only synthetic output in issues. This is a bounded snapshot of work due at invocation, not a promise about a later live run; desired state may change. There is no apply flag. Running live sync remains a separate operation.

## Full reconciliation

Pass `--mode full` to inspect the next reconciliation window: at most 25
addresses on one enabled, active mailing list. A complete provider roster
establishes membership and absence; detailed delivery reads and actions are
limited to the window. The durable cursor rotates through addresses and lists,
including windows that need no changes. The dry run reads that same cursor
without advancing it. The report includes `subscribe`, `unsubscribe`,
`disable_delivery`, `enable_delivery`, `unchanged`, `protected`, and `unsubscribed` outcomes.
The CLI uses the same provider-neutral planner as the live scheduled job and
never changes memberships, queue rows, or observations.

Primary addresses receive ordinary membership. Verified additional addresses
inherit membership while their primary is subscribed, with email delivery
disabled. This does not restrict posting. Owners, managers, non-user members,
and unrecognized privilege levels are protected by the Google adapter.
Previously confirmed primary addresses now absent are treated as unsubscribes;
full sync does not re-enroll them or retain their dependent aliases.

A new additional address is added only after its primary address is present.
If both are missing and the additional address sorts into an earlier window,
that address is skipped until the cursor completes a sweep and revisits it.
This can delay its membership by one full reconciliation rotation across the
enabled lists. A rotation may require multiple scheduled invocations because
both the address windows and the shared work budget are bounded.

The existing scheduled job shares its bounded work budget between queued
changes and full reconciliation. Existing durable subscriptions and the job's
lease/retry mechanism provide recovery. Migration 0040 adds only the durable
reconciliation cursor; it must be applied separately to each target before
deploying this code. No additional work queue is introduced. Changing an
account's primary email queues its current subscription work atomically. Full reconciliation removes an obsolete address, or retains it
without delivery when it remains a verified additional address. Verification
and removal of additional addresses wake the existing job.

```sh
pnpm exec node scripts/google-groups-sync-dry-run.mjs \
  --database /secure/path/application.sqlite \
  --credentials /secure/path/groups-reader.json \
  --impersonate groups-reader@example.org \
  --mode full
```
