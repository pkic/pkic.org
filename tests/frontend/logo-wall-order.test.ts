import { describe, expect, it } from "vitest";
import { spreadSponsors } from "../../assets/shared/logo-wall-order";

const members = (count: number) => Array.from({ length: count }, (_, index) => `m${index}`);
const sponsors = (count: number) => Array.from({ length: count }, (_, index) => `S${index}`);
const isSponsor = (tile: string) => tile.startsWith("S");

/** Members between each pair of cyclically neighboring sponsors. */
function loopGaps(sequence: readonly string[]): number[] {
  const positions = sequence.flatMap((tile, index) => (isSponsor(tile) ? [index] : []));
  return positions.map((position, index) => {
    const next = positions[(index + 1) % positions.length];
    return (next - position - 1 + sequence.length) % sequence.length;
  });
}

describe("spreadSponsors", () => {
  it("keeps every tile exactly once and each group in its given order", () => {
    const result = spreadSponsors(members(37), sponsors(5));
    expect([...result].sort()).toEqual([...members(37), ...sponsors(5)].sort());
    expect(result.filter(isSponsor)).toEqual(sponsors(5));
    expect(result.filter((tile) => !isSponsor(tile))).toEqual(members(37));
  });

  it("is deterministic", () => {
    expect(spreadSponsors(members(40), sponsors(6))).toEqual(spreadSponsors(members(40), sponsors(6)));
  });

  it("puts at least two members on both sides of every sponsor, around the loop", () => {
    for (const [memberCount, sponsorCount] of [
      [84, 20],
      [200, 12],
      [10, 5],
      [7, 3],
      [100, 1],
    ]) {
      const gaps = loopGaps(spreadSponsors(members(memberCount), sponsors(sponsorCount)));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the spacing across the seam when two passes are joined", () => {
    const pass = spreadSponsors(members(23), sponsors(5));
    expect(
      Math.min(...loopGaps([...pass, ...spreadSponsors(members(23).reverse(), sponsors(5))])),
    ).toBeGreaterThanOrEqual(Math.floor(23 / 5));
  });

  it("evens the gaps out when members are scarce", () => {
    const gaps = loopGaps(spreadSponsors(members(7), sponsors(3)));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(Math.min(...gaps)).toBe(2);
  });

  it("separates sponsors whenever the counts allow it, even below two members each", () => {
    const gaps = loopGaps(spreadSponsors(members(6), sponsors(5)));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1);
  });

  it("only lets sponsors touch when they outnumber the members", () => {
    const gaps = loopGaps(spreadSponsors(members(2), sponsors(5)));
    expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBe(2);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
  });

  it("handles a lone group", () => {
    expect(spreadSponsors(members(3), [])).toEqual(members(3));
    expect(spreadSponsors([], sponsors(2))).toEqual(sponsors(2));
    expect(spreadSponsors([], [])).toEqual([]);
  });

  it("centers a single sponsor", () => {
    expect(spreadSponsors(members(4), ["S0"])).toEqual(["m0", "m1", "S0", "m2", "m3"]);
  });
});
