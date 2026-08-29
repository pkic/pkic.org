# D1 migration guidance

- Load `$wrangler` and `$database-schema-designer` before migration work.
- Inspect upstream migration filenames and both preview and production migration ledgers before changing migration history.
- Applied migrations are immutable. Undeployed branch migrations must be squashed into the branch's final migration.
- Deployments do not apply migrations. Applying a migration to preview or production is a separate manual operation that requires explicit approval and target confirmation.
- Every branch and pull-request preview shares the preview D1 database. Assess compatibility with all active preview branches before applying a migration.
- Never populate preview from production personal data, credentials, secrets, or private uploads. Use synthetic or purpose-created preview fixtures.
- Introduce branch-created tables, columns, constraints, and indexes once in final form. Do not create, transform, rebuild, backfill, and drop the same branch-only schema.
- Prefer additive changes to existing tables. If no additive design can satisfy a required invariant, document alternatives and require explicit approval, a production-shaped rehearsal, and recovery evidence before rebuilding.
- Use `CHECK` only for durable structural invariants. Do not freeze changeable statuses, categories, roles, or feature policy into a table definition.
- Use reference tables when database enforcement of an evolvable vocabulary is valuable; otherwise enforce it through the shared domain schema on every write path with Vitest coverage.
- Add required constraints and indexes when the schema is first introduced.
- Store instants as `TEXT` ISO-8601 UTC with an explicit `Z`. In SQL use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- Never use `datetime('now')`, `date('now')`, or `CURRENT_TIMESTAMP` for a stored instant, including in seed rows and backfills. They produce a space-separated value with no `Z`, and because these columns are compared as text, `' '` sorts before `'T'`: every such row then sorts ahead of every application-written row and drops out of ISO range filters. This silently breaks the shared `ORDER BY created_at, id` pagination tie-break.
- Store a local wall clock as a UTC instant plus a sibling `TEXT` column holding the IANA time zone identifier. Do not store fixed offsets, abbreviations, or a naive local string.
- Store calendar dates as `TEXT` `YYYY-MM-DD` and keep them distinct from instants.
- Migrations must apply to an empty database and a production-shaped fixture. Importers must target only the final schema.
