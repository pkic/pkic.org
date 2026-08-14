# Worker and backend guidance

- Load `$cloudflare` and `$workers-best-practices` for Worker changes, `$hono` for routing, and `$wrangler` before platform commands.
- Do not keep mutable request state in module globals. Bind request state to the Hono context or a focused use-case input.
- Await promises. Use `ctx.waitUntil` only for work that is safe to finish after the response and has an explicit failure/retry owner.
- Bound work per invocation. Paginate reads and batch writes within documented D1 and Worker limits.
- Select explicit columns in production read models. Do not use `SELECT *`.
- Push filters, search, sorting, aggregation, and pagination into indexed SQL with deterministic tie-break ordering.
- Do not issue per-row D1 queries on list or read-model paths. Use joins, set-based queries, or bounded batches.
- Preserve the dependency direction from shared contracts to domain policy, persistence, focused use cases, and thin route adapters.
- Generic infrastructure such as the email outbox must not import feature services. Feature use cases may depend on infrastructure interfaces.
