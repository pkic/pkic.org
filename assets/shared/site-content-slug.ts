const SLUG_ALPHANUMERIC = /[\p{L}\p{N}]/u;
const SLUG_WHITESPACE = /\s/u;
const SLUG_ALLOWED = /[._/\\#+~-]/;

/**
 * Reproduce Hugo's `urlize` so migrated routes keep their published addresses.
 *
 * Hugo keeps Unicode letters and digits along with a small punctuation set,
 * turns runs of whitespace into a single hyphen, and drops everything else
 * without leaving a separator behind. That is why `It's Time for TLS 1.2`
 * publishes as `its-time-for-tls-1.2` and `S/MIME` as `s/mime`.
 */
export function siteContentSlug(value: string): string {
  const target: string[] = [];
  let prependHyphen = false;
  let wasHyphen = false;
  for (const character of String(value)) {
    const isAlphanumeric = SLUG_ALPHANUMERIC.test(character);
    const isHyphen = character === "-";
    if (isAlphanumeric || isHyphen || character === "_" || SLUG_ALLOWED.test(character)) {
      if (prependHyphen && !isHyphen) target.push("-");
      prependHyphen = false;
      if (target.length === 0 && !isAlphanumeric && character !== "_") continue;
      target.push(character);
      wasHyphen = isHyphen;
    } else if (target.length > 0 && !wasHyphen && SLUG_WHITESPACE.test(character)) {
      prependHyphen = true;
      wasHyphen = true;
    }
  }
  return target.join("").toLowerCase();
}
