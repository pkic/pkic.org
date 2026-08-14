# API route guidance

- Define request and response contracts once in `assets/shared` and expose them through Chanfana/OpenAPI.
- Validate once, then consume typed `data.params`, `data.query`, and `data.body`. Do not reparse the request into a second shape.
- Resolve authentication and authorization context once through middleware or a shared guard.
- Route handlers own HTTP concerns only. Call one focused use case; do not embed SQL, business transitions, or external-delivery policy.
- Return values that satisfy the shared response schema. Do not maintain route-local response interfaces.
- Require mounted-router tests for endpoint behavior, including validation and middleware. Raw-handler-only tests are insufficient.
