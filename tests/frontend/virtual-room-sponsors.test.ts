import { describe, expect, it } from "vitest";
import { sponsorsDisplayResponseSchema } from "../../assets/shared/schemas/public-sponsors";
import { roomSponsorTurns } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/virtual-room-sponsors";

/** A sponsor display with this many sponsors per tier weight, each with a logo unless left out. */
function display(tiers: Record<number, number>, withoutLogo: readonly string[] = []) {
  let next = 0;
  return sponsorsDisplayResponseSchema.parse({
    groups: Object.entries(tiers).map(([weight, count]) => ({
      weight: Number(weight),
      tierName: `Tier ${weight}`,
      sponsors: Array.from({ length: count }, (_, index) => {
        next += 1;
        const name = `W${weight}-${index + 1}`;
        return {
          id: `c0000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
          name,
          website: null,
          logoUrl: withoutLogo.includes(name) ? null : `/logo/${name}.svg`,
          tier: null,
          eventTier: null,
          effectiveTier: `Tier ${weight}`,
          weight: Number(weight),
        };
      }),
    })),
    page: { limit: 200, offset: 0, total: next, hasMore: false },
  });
}
const names = (turn: ReturnType<typeof roomSponsorTurns>[number]) => turn.map(({ sponsor }) => sponsor.name);

describe("the virtual room's sponsor turns", () => {
  it("shows everyone at once, highest tier first, when they all fit", () => {
    const turns = roomSponsorTurns(display({ 2: 2, 6: 1 }), 6);
    expect(turns.map(names)).toEqual([["W6-1", "W2-1", "W2-2"]]);
  });

  it("shows every sponsor in the course of one round, and no sponsor twice in a turn", () => {
    // The consortium's own spread: one Diamond, four Titanium, then 21 across the lower tiers.
    const turns = roomSponsorTurns(display({ 6: 1, 5: 4, 4: 9, 3: 6, 2: 5, 1: 1 }), 6);
    const seen = new Set(turns.flatMap(names));
    expect(seen.size).toBe(26);
    for (const turn of turns) {
      expect(turn).toHaveLength(6);
      expect(new Set(names(turn)).size).toBe(6);
    }
  });

  it("brings the two highest tiers back more often than the rest, and marks them", () => {
    const turns = roomSponsorTurns(display({ 6: 1, 5: 4, 4: 9, 3: 6, 2: 5, 1: 1 }), 6);
    const times = (name: string) => turns.filter((turn) => names(turn).includes(name)).length;
    expect(times("W6-1")).toBeGreaterThan(times("W4-1"));
    expect(times("W5-1")).toBeGreaterThan(times("W1-1"));
    expect(turns.flat().every(({ sponsor, top }) => top === sponsor.weight >= 5)).toBe(true);
  });

  it("leaves out a sponsor without a logo, and has nothing to show without any", () => {
    expect(roomSponsorTurns(display({ 3: 2 }, ["W3-1"]), 3).map(names)).toEqual([["W3-2"]]);
    expect(roomSponsorTurns(display({ 3: 1 }, ["W3-1"]), 3)).toEqual([]);
  });
});
