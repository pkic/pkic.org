import { readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PoolOptions = Parameters<typeof import("@cloudflare/vitest-plugin").cloudflareTest>[0];

const { pools, preparePublication } = vi.hoisted(() => ({
  pools: [] as PoolOptions[],
  preparePublication: vi.fn(),
}));
vi.mock("@cloudflare/vitest-plugin", () => ({
  readD1Migrations: async () => [{ name: "0001.sql", queries: ["CREATE TABLE example (id INTEGER)"] }],
  cloudflareTest: (options: PoolOptions) => {
    pools.push(options);
    return { name: "capture-worker-options" };
  },
}));
vi.mock("../helpers/prepare-static-publication.mjs", () => ({
  prepareStaticPublicationFixture: preparePublication,
}));
import config from "../../vitest.config";
import setupPublication from "../helpers/prepare-worker-publication.mjs";

async function configure() {
  if (typeof config !== "function") throw new Error("Expected a configuration factory");
  return config({ command: "serve", mode: "test" });
}

async function startPool(index: number) {
  const options = pools.at(index);
  if (typeof options !== "function") throw new Error("Expected lazy Worker options");
  return options({ inject: vi.fn().mockReturnValue("/synthetic/published-site") });
}

beforeEach(() => {
  pools.length = 0;
  preparePublication.mockReset();
});

describe("Worker publication selection", () => {
  it("configures and starts the D1 pool without building or serving publication assets", async () => {
    await configure();
    expect(preparePublication).not.toHaveBeenCalled();
    const options = await startPool(0);
    expect(readdirSync(options.miniflare!.assets!.directory!)).toEqual([]);
    expect(options.miniflare!.bindings!.TEST_MIGRATIONS).toHaveLength(1);
    expect(preparePublication).not.toHaveBeenCalled();
  });

  it("uses the real publication only when starting the Worker-fetch pool", async () => {
    preparePublication.mockResolvedValue({ publicDirectory: "/synthetic/published-site" });
    await configure();
    expect(preparePublication).not.toHaveBeenCalled();
    const provide = vi.fn();
    await setupPublication({ provide });
    const options = await startPool(-1);
    expect(provide).toHaveBeenCalledWith("staticPublicationDirectory", "/synthetic/published-site");
    expect(preparePublication).toHaveBeenCalledOnce();
    expect(options.miniflare!.assets!.directory!).toBe("/synthetic/published-site");
    expect(options.main).toBe("./functions/router.ts");
  });

  it("refuses to start publication tests when the build fails", async () => {
    preparePublication.mockRejectedValue(new Error("publication failed"));
    await configure();
    await expect(setupPublication({ provide: vi.fn() })).rejects.toThrow("publication failed");
  });
});
