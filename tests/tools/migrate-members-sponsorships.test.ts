import { describe, expect, it, vi } from "vitest";
import { forEachResolvedEventSponsorship } from "../../scripts/migrate-members/sponsorships.mjs";

describe("forEachResolvedEventSponsorship", () => {
  it("resolves known events, trims tiers, skips empty tiers, and reports unknown events", () => {
    const onResolved = vi.fn();
    const onUnmatched = vi.fn();

    forEachResolvedEventSponsorship(
      {
        "Post-Quantum Cryptography Conference Amsterdam 2023": { level: " silver " },
        "Unknown Conference": { level: "gold" },
        "No Tier": { level: "  " },
      },
      { onResolved, onUnmatched },
    );

    expect(onResolved).toHaveBeenCalledOnce();
    expect(onResolved).toHaveBeenCalledWith({
      alias: expect.objectContaining({ slug: expect.any(String), name: expect.any(String) }),
      tier: "silver",
    });
    expect(onUnmatched).toHaveBeenCalledWith({ eventName: "Unknown Conference", tier: "gold" });
  });

  it("does nothing when sponsorship configuration is absent", () => {
    const onResolved = vi.fn();
    const onUnmatched = vi.fn();
    forEachResolvedEventSponsorship(null, { onResolved, onUnmatched });
    expect(onResolved).not.toHaveBeenCalled();
    expect(onUnmatched).not.toHaveBeenCalled();
  });
});
