import { describe, it, expect, vi } from "vitest";
import { sitePublicationCoordinatorConfigSchema } from "../../assets/shared/schemas/site-publication-coordinator";
import { processSitePublicationDispatch } from "../../functions/_lib/services/site-publication-dispatch";
import type { DatabaseLike } from "../../functions/_lib/types";
const provider = {
  accountId: "a".repeat(32),
  triggerId: "11111111-1111-4111-8111-111111111111",
  scriptName: "pkic-site",
  branch: "main",
  commitHash: "b".repeat(40),
  workerTag: "c".repeat(32),
  repoConnectionId: "22222222-2222-4222-8222-222222222222",
  repositoryId: "123",
  providerAccountId: "456",
};
describe("publication coordinator opt-in boundary", () => {
  it("defaults disabled and performs no database or provider work without exclusive ownership", async () => {
    const prepare = vi.fn(() => {
      throw new Error("must not access database");
    });
    const db = { prepare } as unknown as DatabaseLike;
    const fetcher = vi.fn(() => {
      throw new Error("must not contact provider");
    });
    const config = sitePublicationCoordinatorConfigSchema.parse({
      provider,
      environment: "production",
      publicOrigin: "https://pkic.org",
    });
    expect(config.enabled).toBe(false);
    expect(config.exclusiveActivationOwner).toBe(false);
    expect(await processSitePublicationDispatch(db, config, "token", fetcher)).toEqual({ state: "disabled" });
    expect(await processSitePublicationDispatch(db, { ...config, enabled: true }, "token", fetcher)).toEqual({
      state: "disabled",
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds debounce and rejects absent pinned provider identities", () => {
    expect(sitePublicationCoordinatorConfigSchema.safeParse({ provider, debounceSeconds: 301 }).success).toBe(false);
    expect(
      sitePublicationCoordinatorConfigSchema.safeParse({ provider: { ...provider, workerTag: undefined } }).success,
    ).toBe(false);
  });
});
