/** Document identifiers shared across independently rendered UI roots; never security tokens. */
let sequence = 0;
export function nextDomId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}
