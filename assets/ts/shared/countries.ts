/**
 * The country choices the registration form's `iso_country` field offers:
 * value = ISO 3166-1 alpha-2 code, label = the country's English name. The
 * codes are the shared canonical list; the names come from `Intl.DisplayNames`
 * rather than a second hand-kept table.
 */
import { countryOptions, type CountryOption } from "../../shared/countries";

export type ISOCountry = CountryOption;

export const COUNTRIES: readonly ISOCountry[] = countryOptions("en");

/** Look up a country by ISO alpha-2 code (case-insensitive). */
export function countryByCode(code: string): ISOCountry | undefined {
  const upper = code.toUpperCase();
  return COUNTRIES.find((c) => c.value === upper);
}
