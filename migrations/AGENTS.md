# D1 migration guidance

- Load `$wrangler` and `$database-schema-designer` before migration work.
- Inspect upstream migration filenames and both preview and production migration ledgers before changing migration history.
- Applied migrations are immutable. Undeployed branch migrations must be squashed into the branch's final migration.
- Introduce branch-created tables, columns, constraints, and indexes once in final form. Do not create, transform, rebuild, backfill, and drop the same branch-only schema.
- Prefer additive changes to existing tables. If no additive design can satisfy a required invariant, document alternatives and require explicit approval, a production-shaped rehearsal, and recovery evidence before rebuilding.
- Use `CHECK` only for durable structural invariants. Do not freeze changeable statuses, categories, roles, or feature policy into a table definition.
- Use reference tables when database enforcement of an evolvable vocabulary is valuable; otherwise enforce it through the shared domain schema on every write path with Vitest coverage.
- Add required constraints and indexes when the schema is first introduced.
- Migrations must apply to an empty database and a production-shaped fixture. Importers must target only the final schema.
