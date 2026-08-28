export type { DonationManagementSummary as DonationRow } from "../../../../../shared/schemas/donation-management";
export type { DonationSyncResponse } from "../../../../../shared/schemas/donation-management";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export function formatDonationAmount(smallestUnit: number, currency: string): string {
  const code = currency.toLowerCase();
  const major = ZERO_DECIMAL_CURRENCIES.has(code) ? smallestUnit : smallestUnit / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2,
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}
