import { resolve } from "node:path";
import { unstable_readConfig as readConfig } from "wrangler";
import { describe, expect, it } from "vitest";
import { ALL_SCHEDULED_CRONS } from "../../functions/_lib/scheduled-crons";

const configPath = resolve(import.meta.dirname, "../../wrangler.jsonc");

describe("scheduled Worker cron contract", () => {
  it("keeps every canonical scheduled lane in the production Wrangler trigger list", () => {
    const configured = readConfig({ config: configPath, env: "production" }).triggers.crons ?? [];

    expect(new Set(configured)).toEqual(new Set(ALL_SCHEDULED_CRONS));
    expect(configured).toHaveLength(ALL_SCHEDULED_CRONS.length);
  });

  it("does not configure a local cron or a Preview scheduled job scope", () => {
    expect(readConfig({ config: configPath, env: "local" }).triggers.crons ?? []).toEqual([]);
    // Workers Previews never receive Cron Triggers; nothing may suggest otherwise.
    const previews = readConfig({ config: configPath, env: "production" }).previews;
    expect(previews).not.toHaveProperty("triggers");
    expect(previews?.vars ?? {}).not.toHaveProperty("SCHEDULED_JOB_SCOPE");
  });
});
