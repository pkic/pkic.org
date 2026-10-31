/**
 * Joins names into one readable list ("A, B, and C"). Server messages pass
 * `en-US`, the product's language; the browser may pass the viewer's locale.
 */
export function formatConjunction(items: readonly string[], locale: string | undefined = "en-US"): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}
