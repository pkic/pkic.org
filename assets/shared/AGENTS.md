# Shared contract guidance

- This is the cross-runtime home for canonical Zod transport contracts and their inferred TypeScript types.
- Extend or compose shared base schemas. Do not duplicate request, response, entity, validation-error, or page-envelope shapes.
- All listing/search endpoints compose one shared query contract for filters, search, sorting, cursor or page pagination, and limits, plus one shared page-response contract.
- Persisted profile links use the existing shared link schema and one JSON encode/decode path. Do not add provider-specific columns or parallel link shapes.
- Evolvable state constants, transition rules, and schemas live once. Any intentional D1 reference-data mirror requires parity tests.
- Split contracts by domain with explicit exports. Keep compatibility re-exports while migrating; do not grow a catch-all `api.ts` indefinitely.
- Shared modules must not import Hono, D1, Worker bindings, backend services, or frontend components.
- `timezone.ts` is the canonical wall-clock codec for both runtimes. Route every IANA conversion through it instead of adding per-feature date helpers, and keep contract fields as ISO-8601 UTC instants with `Z`.
