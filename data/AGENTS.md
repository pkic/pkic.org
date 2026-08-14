# Hugo data guidance

- Preserve each data file's existing structure and naming conventions. Reuse existing fields instead of adding a parallel representation.
- Use US English for authored descriptions and labels. Preserve legal names, trademarks, and attributed source text exactly where required.
- For simple YAML or data-only edits, review the diff and validate the affected file's syntax and required fields. Do not run `pnpm run check`, `pnpm run test`, or `pnpm run test:e2e` unless the change also touches executable code, templates, schemas, or configuration.
- Preview only pages that consume the changed data when the edit can affect rendering, links, ordering, or relationships. A spelling or wording-only edit does not require a full site build.
- Never use production personal data as preview or test data. Use synthetic or purpose-created fixtures for non-production environments.
