# Test guidance

- Test endpoint behavior through the mounted Hono/Chanfana router so validation and middleware execute.
- Apply real D1 migrations in integration tests. Do not replace platform-behavior coverage with mocks.
- Cover invalid contracts, invariant failures, authorization, atomic rollback, retry behavior, concurrency races, bounded query counts, empty pages, and final pages where relevant.
- Reuse test builders and fixtures. Do not duplicate complete request bodies or database setup when a focused shared builder can express the variation.
- Run focused Vitest files during iteration, then `pnpm run check` before handoff.
