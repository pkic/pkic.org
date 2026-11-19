import type { PublicSponsor, SponsorsDisplayResponse } from "../../../../../../../shared/schemas/public-sponsors";

/** A sponsor as the room's strip shows it: its logo, and whether it is among the event's highest tiers. */
export interface RoomSponsor {
  sponsor: PublicSponsor;
  /** One of the two highest tiers present: drawn larger, and back in view more often. */
  top: boolean;
}

/**
 * The sponsors the virtual room shows, a few at a time, so every sponsor is
 * seen without leaving the stream. Each turn holds `size` logos. About a
 * third of the places go to the two highest tiers, which take turns among
 * themselves, so a top sponsor returns more often than the rest; the other
 * places work through every other sponsor in order. When all fit at once
 * there is one turn and nothing changes.
 */
export function roomSponsorTurns(display: Pick<SponsorsDisplayResponse, "groups">, size: number): RoomSponsor[][] {
  const groups = [...display.groups].sort((left, right) => right.weight - left.weight);
  const topWeights = groups.slice(0, 2).map((group) => group.weight);
  const all = groups.flatMap((group) =>
    group.sponsors
      .filter((sponsor) => sponsor.logoUrl)
      .map((sponsor) => ({ sponsor, top: topWeights.includes(group.weight) })),
  );
  if (size < 1 || !all.length) return [];
  if (all.length <= size) return [all];
  const top = all.filter((entry) => entry.top);
  const rest = all.filter((entry) => !entry.top);
  if (!rest.length || !top.length) return chunks(all, size);
  const topPlaces = Math.min(top.length, Math.max(1, Math.round(size / 3)));
  const restPlaces = size - topPlaces;
  if (restPlaces < 1) return chunks(all, size);
  const turns = Math.max(Math.ceil(top.length / topPlaces), Math.ceil(rest.length / restPlaces));
  return Array.from({ length: turns }, (_, turn) => [
    ...take(top, turn * topPlaces, topPlaces),
    ...take(rest, turn * restPlaces, restPlaces),
  ]);
}

/** `count` entries from `start`, going round the list, never the same one twice. */
function take(list: readonly RoomSponsor[], start: number, count: number): RoomSponsor[] {
  return Array.from({ length: Math.min(count, list.length) }, (_, index) => list[(start + index) % list.length]!);
}

function chunks(list: readonly RoomSponsor[], size: number): RoomSponsor[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size),
  );
}
