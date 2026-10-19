/**
 * Countries as ISO 3166-1 alpha-2 codes. A code is what every contract and
 * every stored row carries; the country's name is a presentation concern,
 * resolved for the reader's locale through `Intl.DisplayNames` and never
 * stored.
 *
 * The code list is the officially assigned set. It is fixed here rather than
 * read from the runtime, because ICU builds differ in which extra regions they
 * name (`EU`, `XK`, `ZZ`) and a contract must validate the same way in the
 * Worker, Node and every browser.
 */
import { z } from "zod";

export const ISO_COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const; // oxfmt-ignore

export type CountryCode = (typeof ISO_COUNTRY_CODES)[number];

/** An ISO 3166-1 alpha-2 country code, as every contract carries it. */
export const countryCodeSchema = z.enum(ISO_COUNTRY_CODES, { error: "Choose a country from the list." });

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(ISO_COUNTRY_CODES);

export function isCountryCode(value: string): value is CountryCode {
  return COUNTRY_CODE_SET.has(value);
}

function regionNames(locale: string | undefined): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region", fallback: "none" });
  } catch {
    return null;
  }
}

/** "Netherlands" for `NL` in English; the code itself when the runtime cannot name it. */
export function countryName(code: string, locale?: string): string {
  return regionNames(locale)?.of(code) ?? code;
}

export interface CountryOption {
  readonly value: CountryCode;
  readonly label: string;
}

/** Every country as a choice, named and ordered for the reader's locale. */
export function countryOptions(locale?: string): CountryOption[] {
  const names = regionNames(locale);
  const collator = new Intl.Collator(locale);
  return ISO_COUNTRY_CODES.map((value) => ({ value, label: names?.of(value) ?? value })).sort((a, b) =>
    collator.compare(a.label, b.label),
  );
}

interface LocaleWithTimeZones {
  getTimeZones?: () => string[] | undefined;
  timeZones?: string[];
}

/**
 * The IANA zones a country observes, when the runtime knows them
 * (`Intl.Locale#getTimeZones`); null when it does not, so a caller suggests
 * nothing rather than guessing.
 */
export function countryTimeZones(code: string): readonly string[] | null {
  try {
    const locale = new Intl.Locale(`und-${code}`) as Intl.Locale & LocaleWithTimeZones;
    const zones = typeof locale.getTimeZones === "function" ? locale.getTimeZones() : locale.timeZones;
    return zones?.length ? zones : null;
  } catch {
    return null;
  }
}
