/**
 * Where an event takes place: its city and its country, as one row.
 *
 * The country is chosen by name and sent as its ISO code; both fields read
 * their state from the caller's contract form. When the chosen country keeps
 * a single time zone that the event is not on, the row offers it — the
 * organizer applies it, the form never changes the zone on its own.
 */
import type { FieldPresentation } from "../hooks/useContractForm";
import { countryName, countryTimeZones, isCountryCode } from "../../shared/countries";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { CountrySelect } from "./CountrySelect";

/** The one zone a country keeps, when it differs from the event's; null otherwise. */
export function suggestedCountryTimeZone(country: string, timezone: string): string | null {
  if (!isCountryCode(country)) return null;
  const zones = countryTimeZones(country);
  return zones?.length === 1 && zones[0] !== timezone ? zones[0] : null;
}

export function EventPlaceFields({
  city,
  country,
  timezone,
  onCityChange,
  onCountryChange,
  onTimezoneChange,
  fields = () => ({}),
}: {
  city: string;
  country: string;
  timezone: string;
  onCityChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  fields?: (name: string) => FieldPresentation;
}) {
  const suggestedZone = suggestedCountryTimeZone(country, timezone);
  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-grid">
        <Field {...fields("city")} label="City">
          {(control) => (
            <TextInput
              {...control}
              name="city"
              value={city}
              placeholder="Amsterdam"
              autoComplete="address-level2"
              onInput={(event) => onCityChange((event.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        <Field {...fields("country")} label="Country">
          {(control) => <CountrySelect {...control} name="country" value={country} onChange={onCountryChange} />}
        </Field>
      </div>
      {suggestedZone && (
        <div class="pk-cluster">
          <span class="pk-small">
            {countryName(country)} uses {suggestedZone}. This event is on {timezone || "no time zone"}.
          </span>
          <Button variant="secondary" onClick={() => onTimezoneChange(suggestedZone)}>
            Use {suggestedZone}
          </Button>
        </div>
      )}
    </div>
  );
}
