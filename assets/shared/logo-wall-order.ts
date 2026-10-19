/**
 * The order of a looping logo wall.
 *
 * A sponsor's logo keeps its color while member logos are muted, so a
 * sponsor beside another sponsor reads as one loud block and loses the
 * emphasis the treatment gives it. This places the sponsors at even
 * intervals among the members instead.
 *
 * Both inputs arrive already ordered (the wall shuffles or ranks them as it
 * always has) and each keeps its relative order in the result; only the
 * interleaving is decided here, so the function is deterministic.
 *
 * The wall repeats: its marquee scrolls a copy that follows the last tile with
 * the first. The gaps are therefore measured around the loop, and the
 * leftover members are split between the head and the tail so that the end of
 * one pass meets the start of the next with the same spacing as everywhere
 * else. That also holds when two independently ordered passes are joined.
 *
 * With `members` at least twice the sponsors, every sponsor has at least two
 * members on both sides. With fewer members the gaps are as even as the
 * counts allow, which maximizes the smallest gap; sponsors only touch when
 * there are more of them than members to separate them.
 */
export function spreadSponsors<T>(members: readonly T[], sponsors: readonly T[]): T[] {
  if (sponsors.length === 0) return [...members];
  if (members.length === 0) return [...sponsors];

  // Members between sponsor k and sponsor k + 1; the last gap wraps the loop.
  const gapAfter = (index: number): number =>
    Math.floor(((index + 1) * members.length) / sponsors.length) -
    Math.floor((index * members.length) / sponsors.length);

  const wrapGap = gapAfter(sponsors.length - 1);
  const head = Math.floor(wrapGap / 2);

  const result = members.slice(0, head);
  let next = head;
  sponsors.forEach((sponsor, index) => {
    result.push(sponsor);
    const take = index === sponsors.length - 1 ? wrapGap - head : gapAfter(index);
    result.push(...members.slice(next, next + take));
    next += take;
  });
  return result;
}
