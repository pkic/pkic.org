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
  /**
   * Approximate number of this currency's units equal to 1 USD.
   * Used only for scaling donation preset buttons to sensible local amounts.
   * These are indicative rates for UX purposes — not for financial conversion.
   * Omit for USD (implicitly 1).
   */
  approxUsdRate?: number;
}

/** Currencies available in the donation form, ordered for the picker dropdown. */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: "usd", symbol: "$",    name: "US Dollar" },
  { code: "eur", symbol: "€",    name: "Euro",                approxUsdRate: 0.92 },
  { code: "gbp", symbol: "£",    name: "British Pound",       approxUsdRate: 0.79 },
  { code: "cad", symbol: "CA$",  name: "Canadian Dollar",     approxUsdRate: 1.38 },
  { code: "aud", symbol: "A$",   name: "Australian Dollar",   approxUsdRate: 1.57 },
  { code: "chf", symbol: "CHF",  name: "Swiss Franc",         approxUsdRate: 0.90 },
  { code: "jpy", symbol: "¥",    name: "Japanese Yen",        approxUsdRate: 150,  zeroDecimal: true },
  { code: "sek", symbol: "kr",   name: "Swedish Krona",       approxUsdRate: 10.5 },
  { code: "nok", symbol: "kr",   name: "Norwegian Krone",     approxUsdRate: 10.7 },
  { code: "dkk", symbol: "kr",   name: "Danish Krone",        approxUsdRate: 6.9  },
  { code: "pln", symbol: "zł",   name: "Polish Złoty",        approxUsdRate: 4.0  },
  { code: "czk", symbol: "Kč",   name: "Czech Koruna",        approxUsdRate: 23   },
  { code: "huf", symbol: "Ft",   name: "Hungarian Forint",    approxUsdRate: 385,  zeroDecimal: true },
  { code: "sgd", symbol: "S$",   name: "Singapore Dollar",    approxUsdRate: 1.36 },
  { code: "hkd", symbol: "HK$",  name: "Hong Kong Dollar",    approxUsdRate: 7.8  },
  { code: "nzd", symbol: "NZ$",  name: "New Zealand Dollar",  approxUsdRate: 1.68 },
  { code: "mxn", symbol: "MX$",  name: "Mexican Peso",        approxUsdRate: 20   },
  { code: "brl", symbol: "R$",   name: "Brazilian Real",      approxUsdRate: 5.8  },
  { code: "inr", symbol: "₹",    name: "Indian Rupee",        approxUsdRate: 87   },
  { code: "krw", symbol: "₩",    name: "South Korean Won",    approxUsdRate: 1450, zeroDecimal: true },
  { code: "twd", symbol: "NT$",  name: "New Taiwan Dollar",   approxUsdRate: 33   },
  { code: "thb", symbol: "฿",    name: "Thai Baht",           approxUsdRate: 36   },
  { code: "myr", symbol: "RM",   name: "Malaysian Ringgit",   approxUsdRate: 4.5  },
  { code: "php", symbol: "₱",    name: "Philippine Peso",     approxUsdRate: 58   },
  { code: "zar", symbol: "R",    name: "South African Rand",  approxUsdRate: 18.5 },
  { code: "ils", symbol: "₪",    name: "Israeli Shekel",      approxUsdRate: 3.7  },
  { code: "aed", symbol: "د.إ",  name: "UAE Dirham",          approxUsdRate: 3.67 },
  { code: "sar", symbol: "﷼",    name: "Saudi Riyal",         approxUsdRate: 3.75 },
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
