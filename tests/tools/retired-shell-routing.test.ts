import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const wranglerConfig = readFileSync(resolve(import.meta.dirname, "../../wrangler.jsonc"), "utf8");

describe("retired browser shells", () => {
  it.each(["/admin", "/admin/*", "/sponsor-portal", "/sponsor-portal/*"])(
    "routes %s through the Worker so stale static artifacts cannot revive it",
    (path) => {
      expect(wranglerConfig.split(JSON.stringify(path))).toHaveLength(4);
    },
  );
});
