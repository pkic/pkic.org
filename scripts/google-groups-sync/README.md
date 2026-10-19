# Google Groups sync dry run

This CLI runs the production sync use case against a read-only local SQLite database and a recording Directory adapter. It reports the next due queue batch (default 25, maximum 100), including planned adds/removes, suppressed adds, and missing users. It does not reconcile every subscriber or re-enroll people who left a group. Already satisfied membership intents are recorded too: the live adapter applies them idempotently.

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
