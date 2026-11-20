import type { PublicSponsor, SponsorsDisplayResponse } from "../../../../../../../shared/schemas/public-sponsors";

/** One turn of the room's sponsor line: sponsors of a single tier, drawn at that tier's size. */
export interface RoomSponsorTurn {
  tier: string;
  /** The tier's place among the event's tiers, 0 for the highest; the line sizes its logos by it. */
  rank: number;
  sponsors: PublicSponsor[];
}

export interface RoomSponsorLine {
  /** The highest tier, kept in view beside every turn where the line has the width for it. */
  pinned: RoomSponsorTurn | null;
  turns: RoomSponsorTurn[];
}

export type RoomSponsorWidth = "wide" | "narrow";

/** Tiers the line sizes apart; every tier below the fifth is drawn like the fifth. */
export const ROOM_SPONSOR_RANKS = 5;
/** Logos one turn holds, by tier rank: beside the stream on a desktop, and on a phone's single line. */
const PLACES: Record<RoomSponsorWidth, readonly number[]> = { wide: [2, 4, 5, 6, 6], narrow: [1, 2, 3, 3, 3] };
/** How many times a tier's sponsors come by in one round, by tier rank: a higher tier returns more often. */
const RETURNS = [4, 3, 2, 1, 1] as const;

/**
 * The sponsors the virtual room shows under the stream, one tier at a time, so the line never mixes sizes
 * and never grows. A tier too long for the line takes several turns of near-equal length. On a desktop the
 * highest tier stays in view beside the others' turns; on a phone it takes turns too and returns most often.
 * When everything fits at once there is a single turn and nothing changes.
 */
export function roomSponsorLine(
  display: Pick<SponsorsDisplayResponse, "groups">,
  width: RoomSponsorWidth,
): RoomSponsorLine {
  const tiers = [...display.groups]
    .sort((left, right) => right.weight - left.weight)
    .map((group) => ({ tier: group.tierName, sponsors: group.sponsors.filter((sponsor) => sponsor.logoUrl) }))
    .filter((group) => group.sponsors.length)
    .map((group, index) => ({ ...group, rank: Math.min(index, ROOM_SPONSOR_RANKS - 1) }));
  const [first, ...lower] = tiers;
  if (!first) return { pinned: null, turns: [] };
  const pin = width === "wide" && lower.length > 0 && first.sponsors.length <= PLACES.wide[0]!;
  const streams = (pin ? lower : tiers).map((tier) => ({
    parts: parts(tier, PLACES[width][tier.rank]!),
    returns: RETURNS[tier.rank]!,
  }));
  return { pinned: pin ? first : null, turns: streams.length === 1 ? streams[0]!.parts : spread(streams) };
}

/** A tier's sponsors in as few turns as hold them, each turn near the same length. */
function parts(tier: RoomSponsorTurn, places: number): RoomSponsorTurn[] {
  const count = Math.ceil(tier.sponsors.length / places);
  const size = Math.ceil(tier.sponsors.length / count);
  return Array.from({ length: count }, (_, index) => ({
    ...tier,
    sponsors: tier.sponsors.slice(index * size, index * size + size),
  }));
}

/**
 * One round of turns: every tier's parts in order, each tier as often as it returns, spread evenly so the
 * same tier is not shown twice in a row while another waits.
 */
function spread(streams: ReadonlyArray<{ parts: RoomSponsorTurn[]; returns: number }>): RoomSponsorTurn[] {
  const weights = streams.map((stream) => stream.parts.length * stream.returns);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const credit = weights.map(() => 0);
  const given = weights.map(() => 0);
  const round = Array.from({ length: total }, () => {
    weights.forEach((weight, index) => (credit[index]! += weight));
    const next = credit.indexOf(Math.max(...credit));
    credit[next]! -= total;
    const stream = streams[next]!;
    return stream.parts[given[next]!++ % stream.parts.length]!;
  });
  // The round opens on the highest tier, whichever tier has the most turns in it.
  const opening = round.indexOf(streams[0]!.parts[0]!);
  return [...round.slice(opening), ...round.slice(0, opening)];
}
