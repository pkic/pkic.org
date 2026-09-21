import { currencyInfo } from "./constants/currencies";

/** Formats a smallest-unit amount through the shared currency catalog. */
export function formatCurrencyAmount(amount: number, currency: string): string {
  const info = currencyInfo(currency);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: info.code.toUpperCase() }).format(
    amount / (info.zeroDecimal ? 1 : 100),
  );
}
