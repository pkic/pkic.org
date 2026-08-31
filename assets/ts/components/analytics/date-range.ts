/**
 * Calendar helpers for the analytics surfaces.
 *
 * These lived alongside the chart renderers, which have moved into the design
 * system. Date arithmetic is not presentation and does not belong there.
 */

/** Every ISO date string (YYYY-MM-DD) from `from` to `to` inclusive, in UTC. */
export function isoDateRange(from: string, to: string): string[] {
  const result: string[] = [];
  const end = new Date(`${to}T12:00:00Z`);
  const current = new Date(`${from}T12:00:00Z`);
  while (current <= end) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}
