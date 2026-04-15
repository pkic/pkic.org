import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run before each test file in the Workers runtime.
// `applyD1Migrations` is idempotent — it only applies migrations that
// haven't already been applied, so calling it here is safe even when the
// worker context is reused across runs.
//

await applyD1Migrations(env.DB as any, (env as any).TEST_MIGRATIONS);
