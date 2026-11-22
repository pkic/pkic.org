import { describe, expect, it } from "vitest";
import { sponsorsDisplayResponseSchema } from "../../assets/shared/schemas/public-sponsors";
import {
  roomSponsorLine,
  type RoomSponsorTurn,
} from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/virtual-room-sponsors";

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
const names = (turn: RoomSponsorTurn) => turn.sponsors.map((sponsor) => sponsor.name);
// The consortium's own spread: one Diamond, four Titanium, then 21 across the lower tiers.
const CONSORTIUM = { 6: 1, 5: 4, 4: 9, 3: 6, 2: 5, 1: 1 };

describe("the virtual room's sponsor line", () => {
  it("shows one tier in a turn, never two together", () => {
    for (const width of ["wide", "narrow"] as const)
      for (const turn of roomSponsorLine(display(CONSORTIUM), width).turns)
        expect(new Set(turn.sponsors.map((sponsor) => sponsor.effectiveTier)).size).toBe(1);
  });

  it("keeps the highest tier beside every turn on a desktop, and gives it turns on a phone", () => {
    const wide = roomSponsorLine(display(CONSORTIUM), "wide");
    expect(wide.pinned && names(wide.pinned)).toEqual(["W6-1"]);
    expect(wide.turns.flatMap(names)).not.toContain("W6-1");
    const narrow = roomSponsorLine(display(CONSORTIUM), "narrow");
    expect(narrow.pinned).toBeNull();
    expect(narrow.turns.flatMap(names)).toContain("W6-1");
  });

  it("shows every sponsor in the course of one round", () => {
    for (const width of ["wide", "narrow"] as const) {
      const line = roomSponsorLine(display(CONSORTIUM), width);
      expect(new Set([...(line.pinned ? names(line.pinned) : []), ...line.turns.flatMap(names)]).size).toBe(26);
    }
  });

  it("splits a tier too long for the line into turns of near-equal length", () => {
    const platinum = (width: "wide" | "narrow") => [
      ...new Set(
        roomSponsorLine(display(CONSORTIUM), width)
          .turns.filter((turn) => turn.rank === 2)
          .map((turn) => names(turn).join(" ")),
      ),
    ];
    const lengths = (width: "wide" | "narrow") =>
      platinum(width)
        .map((turn) => turn.split(" ").length)
        .sort();
    expect(lengths("wide")).toEqual([4, 5]);
    expect(lengths("narrow")).toEqual([3, 3, 3]);
  });

  it("brings a higher tier back more often, and never twice in a row while another waits", () => {
    const { turns } = roomSponsorLine(display(CONSORTIUM), "narrow");
    const times = (name: string) => turns.filter((turn) => names(turn).includes(name)).length;
    expect(times("W6-1")).toBeGreaterThan(times("W5-1"));
    expect(times("W5-1")).toBeGreaterThan(times("W4-1"));
    expect(times("W4-1")).toBeGreaterThan(times("W3-1"));
    turns.forEach((turn, index) => expect(turn).not.toBe(turns[(index + 1) % turns.length]));
  });

  it("opens the round on the highest tier that takes turns", () => {
    expect(names(roomSponsorLine(display(CONSORTIUM), "narrow").turns[0]!)).toEqual(["W6-1"]);
    expect(names(roomSponsorLine(display(CONSORTIUM), "wide").turns[0]!)).toEqual(["W5-1", "W5-2", "W5-3", "W5-4"]);
  });

  it("sizes the tiers below the fifth like the fifth", () => {
    const ranks = roomSponsorLine(display(CONSORTIUM), "narrow").turns.map((turn) => turn.rank);
    expect(Math.max(...ranks)).toBe(4);
  });

  it("has a single turn that never changes when one tier fits the line", () => {
    expect(roomSponsorLine(display({ 3: 1 }), "narrow").turns.map(names)).toEqual([["W3-1"]]);
    // With no other tier to take turns, the highest tier is the turn itself and is not kept apart.
    const single = roomSponsorLine(display({ 6: 2 }), "wide");
    expect(single.pinned).toBeNull();
    expect(single.turns.map(names)).toEqual([["W6-1", "W6-2"]]);
  });

  it("leaves out a sponsor without a logo, and has nothing to show without any", () => {
    expect(roomSponsorLine(display({ 3: 2 }, ["W3-1"]), "narrow").turns.map(names)).toEqual([["W3-2"]]);
    expect(roomSponsorLine(display({ 3: 1 }, ["W3-1"]), "wide")).toEqual({ pinned: null, turns: [] });
  });
});
