import type { Env as AppEnv } from "../functions/_lib/types";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
