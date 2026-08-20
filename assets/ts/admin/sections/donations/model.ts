export type { AdminDonationSummary as DonationRow } from "../../../../shared/schemas/admin-donations";

export interface DonationSyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "awaiting_payment" | "failed" | "still_pending" | "error";
  error?: string;
}

export interface DonationSyncResponse {
  synced: number;
  completed: number;
  expired: number;
  failed: number;
  errors: number;
  results: DonationSyncResult[];
}

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
