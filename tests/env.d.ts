import type { Env } from "../../functions/_lib/types";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Augment the ProvidedEnv interface so that `import { env } from "cloudflare:workers"`
// is typed as our application Env plus the test-only TEST_MIGRATIONS binding.
declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
