/**
 * Country-to-currency mapping and display helpers for the donation flow.
 *
 * Currencies are keyed by lowercase ISO 4217 code. Country codes are
 * ISO 3166-1 alpha-2 (uppercase) as returned by Cloudflare's `cf.country`.
 *
 * Only currencies supported by Stripe Checkout are included.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  /** Stripe zero-decimal currency — amounts are in major units, not cents. */
  zeroDecimal?: boolean;
}

/** Currencies available in the donation form, ordered for the picker dropdown. */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: "usd", symbol: "$", name: "US Dollar" },
  { code: "eur", symbol: "€", name: "Euro" },
  { code: "gbp", symbol: "£", name: "British Pound" },
  { code: "cad", symbol: "CA$", name: "Canadian Dollar" },
  { code: "aud", symbol: "A$", name: "Australian Dollar" },
  { code: "chf", symbol: "CHF", name: "Swiss Franc" },
  { code: "jpy", symbol: "¥", name: "Japanese Yen", zeroDecimal: true },
  { code: "sek", symbol: "kr", name: "Swedish Krona" },
  { code: "nok", symbol: "kr", name: "Norwegian Krone" },
  { code: "dkk", symbol: "kr", name: "Danish Krone" },
  { code: "pln", symbol: "zł", name: "Polish Złoty" },
  { code: "czk", symbol: "Kč", name: "Czech Koruna" },
  { code: "huf", symbol: "Ft", name: "Hungarian Forint", zeroDecimal: true },
  { code: "sgd", symbol: "S$", name: "Singapore Dollar" },
  { code: "hkd", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "nzd", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "mxn", symbol: "MX$", name: "Mexican Peso" },
  { code: "brl", symbol: "R$", name: "Brazilian Real" },
  { code: "inr", symbol: "₹", name: "Indian Rupee" },
  { code: "krw", symbol: "₩", name: "South Korean Won", zeroDecimal: true },
  { code: "twd", symbol: "NT$", name: "New Taiwan Dollar" },
  { code: "thb", symbol: "฿", name: "Thai Baht" },
  { code: "myr", symbol: "RM", name: "Malaysian Ringgit" },
  { code: "php", symbol: "₱", name: "Philippine Peso" },
  { code: "zar", symbol: "R", name: "South African Rand" },
  { code: "ils", symbol: "₪", name: "Israeli Shekel" },
  { code: "aed", symbol: "د.إ", name: "UAE Dirham" },
  { code: "sar", symbol: "﷼", name: "Saudi Riyal" },
] as const;

/** Set of supported currency codes for validation. */
export const SUPPORTED_CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

/** Map from ISO 3166-1 alpha-2 country code to default ISO 4217 currency code. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "usd", UM: "usd", PR: "usd", GU: "usd", VI: "usd", AS: "usd",
  GB: "gbp", IM: "gbp", JE: "gbp", GG: "gbp",
  CA: "cad",
  AU: "aud", CC: "aud", CX: "aud", HM: "aud", NF: "aud",
  CH: "chf", LI: "chf",
  JP: "jpy",
  SE: "sek",
  NO: "nok", SJ: "nok", BV: "nok",
  DK: "dkk", FO: "dkk", GL: "dkk",
  PL: "pln",
  CZ: "czk",
  HU: "huf",
  SG: "sgd",
  HK: "hkd",
  NZ: "nzd", CK: "nzd", NU: "nzd", PN: "nzd", TK: "nzd",
  MX: "mxn",
  BR: "brl",
  IN: "inr",
  KR: "krw",
  TW: "twd",
  TH: "thb",
  MY: "myr",
  PH: "php",
  ZA: "zar",
  IL: "ils", PS: "ils",
  AE: "aed",
  SA: "sar",
  // Eurozone countries
  AT: "eur", BE: "eur", CY: "eur", EE: "eur", FI: "eur", FR: "eur",
  DE: "eur", GR: "eur", IE: "eur", IT: "eur", LV: "eur", LT: "eur",
  LU: "eur", MT: "eur", NL: "eur", PT: "eur", SK: "eur", SI: "eur",
  ES: "eur", HR: "eur", AD: "eur", MC: "eur", SM: "eur", VA: "eur",
  ME: "eur", XK: "eur",
};

/** Returns the default currency code for a country, falling back to "usd". */
export function currencyForCountry(countryCode: string | null | undefined): string {
  if (!countryCode) return "usd";
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? "usd";
}

/** Look up currency info by code. Returns USD info as fallback. */
export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code.toLowerCase()) ?? CURRENCIES[0];
}

/**
 * Convert a major-unit amount (e.g. 50) to the smallest currency unit for Stripe.
 * For zero-decimal currencies like JPY, returns the amount unchanged.
 * For standard currencies, multiplies by 100 (e.g. $50 → 5000 cents).
 */
export function toSmallestUnit(amount: number, currencyCode: string): number {
  const info = currencyInfo(currencyCode);
  return info.zeroDecimal ? Math.round(amount) : Math.round(amount * 100);
}

/**
 * Convert a smallest-unit amount back to major units for display.
 */
export function toMajorUnit(smallestUnit: number, currencyCode: string): number {
  const info = currencyInfo(currencyCode);
  return info.zeroDecimal ? smallestUnit : smallestUnit / 100;
}
