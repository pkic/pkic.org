# Script guidance

- Entrypoints parse CLI options and orchestrate focused modules; they do not own all parsing, reconciliation, transformation, SQL rendering, and reporting.
- Move pure logic into small testable modules and reuse shared domain constants and codecs when runtime-compatible.
- Scripts and importers target the final schema only. Do not preserve support for an undeployed intermediate migration state.
- Generated SQL requires a fresh-D1 execution smoke test, and reconciliation requires idempotency tests.
- Use `pnpm exec` for repository-local binaries.
