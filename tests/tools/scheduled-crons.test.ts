import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_SCHEDULED_CRONS } from "../../functions/_lib/scheduled-crons";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("scheduled Worker cron contract", () => {
  it("keeps every canonical scheduled lane in the production Wrangler trigger list", () => {
    const wrangler = readFileSync(`${repositoryRoot}/wrangler.jsonc`, "utf8");
    const productionStart = wrangler.indexOf('"production": {');
    const previewStart = wrangler.indexOf('"preview": {');
    const production = wrangler.slice(productionStart, previewStart);
    const cronBlock = production.match(/"crons"\s*:\s*\[([\s\S]*?)\]/)?.[1];

    expect(productionStart).toBeGreaterThanOrEqual(0);
    expect(previewStart).toBeGreaterThan(productionStart);
    expect(cronBlock).toBeDefined();

    const configured = Array.from(cronBlock?.matchAll(/"([^"]+)"/g) ?? [], (match) => match[1]);
    expect(new Set(configured)).toEqual(new Set(ALL_SCHEDULED_CRONS));
    expect(configured).toHaveLength(ALL_SCHEDULED_CRONS.length);
  });
});
