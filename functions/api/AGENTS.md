# API route guidance

- Define request and response contracts once in `assets/shared` and expose them through Chanfana/OpenAPI.
- Validate once, then consume typed `data.params`, `data.query`, and `data.body`. Do not reparse the request into a second shape.
- Resolve authentication and authorization context once through middleware or a shared guard.
- Name top-level API route families after actual business or resource domains, never the UI surface or caller role. Do not introduce generic `admin`, `portal`, `system`, `me`, or `operations` namespaces without explicit user approval that the term is itself the domain.
- Treat authorization as orthogonal to routing: use exact permission guards on the canonical domain endpoint and mirror those permissions when rendering UI actions. Use `/api/v1/auth` for the shared human authentication lifecycle and place current-user resources under their actual resource domain.
- Delete the superseded route implementation and its callers when moving an unreleased endpoint. Do not leave aliases or duplicate handlers unless an external compatibility requirement has been explicitly approved.
- Route handlers own HTTP concerns only. Call one focused use case; do not embed SQL, business transitions, or external-delivery policy.
- Return values that satisfy the shared response schema. Do not maintain route-local response interfaces.
- Require mounted-router tests for endpoint behavior, including validation and middleware. Raw-handler-only tests are insufficient.
