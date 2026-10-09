# Test guidance

- Test endpoint behavior through the mounted Hono/Chanfana router so validation and middleware execute.
- Apply real D1 migrations in integration tests. Do not replace platform-behavior coverage with mocks.
- Every test protects a behavior a user or contract depends on and fails for one clear reason. Test at the lowest layer that proves it (unit, component, mounted route with D1, then E2E for critical workflows); do not repeat coverage across layers or assert incidental markup, copy, or timing.
- Where they apply to the change, cover invalid contracts, authorization, invariant failures, and atomic rollback; add race, retry, or query-count tests only for code that has those risks.
- Reuse test builders and fixtures. Do not duplicate complete request bodies or database setup when a focused shared builder can express the variation.
- A frontend test that captures a mocked request MUST parse the captured body
  through the shared request schema (for example
  `representativeAssociateSchema.parse(captured.body)`) instead of comparing
  it to a literal. Asserting that the code sent what the code sends proves
  nothing; parsing proves the request the backend would accept.
- Run focused Vitest files during iteration, then `pnpm run check` before handoff.
