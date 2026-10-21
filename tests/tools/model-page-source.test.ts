import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadModelLevelSource } from "../../site/model-version-source";

const version = { id: "offline", version: "1.1.0", commit: "f".repeat(40), sha256: "0".repeat(64) };
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Model source unavailable");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model page source availability", () => {
  it.each(["", "levels/", "adoption/", "adoption/playbooks/small-organizations/", "assessment/"])(
    "renders %s without depending on an external model fetch",
    async (page) => {
      await expect(
        loadModelLevelSource("pkic/pqcmm", "model/pqcmm-model.yaml", version, page),
      ).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("fails closed when normative level content cannot be verified", async () => {
    await expect(
      loadModelLevelSource("pkic/pqcmm", "model/pqcmm-model.yaml", version, "levels/1-initial/"),
    ).rejects.toThrow("Model source unavailable");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
