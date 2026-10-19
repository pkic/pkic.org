/** Formats a displayed quantity with locale-aware grouping. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}
