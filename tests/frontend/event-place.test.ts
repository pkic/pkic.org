import { describe, expect, it } from "vitest";
import { countryName, countryOptions, ISO_COUNTRY_CODES } from "../../assets/shared/countries";
import { eventClock } from "../../assets/shared/event-clock";
import {
  eventPlaceSummary,
  eventPlaceIncomplete,
  eventPlaceNeeded,
  formatEventPlace,
} from "../../assets/shared/event-place";
import { formatClockName } from "../../assets/shared/format-date";
import { eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { groupEventCreateSchema } from "../../assets/shared/schemas/group-events";
import { eventPlaceStructuredData } from "../../functions/_lib/services/site-history-structured-data";

const revision = { expectedUpdatedAt: "2026-10-01T00:00:00.000Z" };

describe("an event's place", () => {
  it("composes the city with the country named for the reader", () => {
    expect(formatEventPlace({ city: "Amsterdam", country: "NL" }, "en")).toBe("Amsterdam, Netherlands");
    expect(formatEventPlace({ city: "Kuala Lumpur", country: "MY" }, "en")).toBe("Kuala Lumpur, Malaysia");
    expect(formatEventPlace({ city: "Amsterdam", country: "NL" }, "nl")).toBe("Amsterdam, Nederland");
    expect(formatEventPlace({ city: " Ottawa ", country: null }, "en")).toBe("Ottawa");
    expect(formatEventPlace({ city: null, country: "CA" }, "en")).toBe("Canada");
    expect(formatEventPlace({ city: "  ", country: null })).toBeNull();
  });

  it("shares the compact venue summary with promotion artwork without repeating the postal address or city", () => {
    expect(
      eventPlaceSummary({ venue: "Meervaart, Meer en Vaart 300, 1068 LE, Amsterdam, Netherlands", city: "Amsterdam" }),
    ).toBe("Meervaart · Amsterdam");
    expect(eventPlaceSummary({ venue: "Amsterdam", city: "Amsterdam" })).toBe("Amsterdam");
    expect(eventPlaceSummary({ venue: null, city: " Toronto " })).toBe("Toronto");
    expect(eventPlaceSummary({ venue: null, city: null })).toBeNull();
  });

  it("asks for a city and a country until both are set", () => {
    expect(eventPlaceIncomplete({ city: "Amsterdam", country: "NL" })).toBe(false);
    expect(eventPlaceIncomplete({ city: "Amsterdam", country: null })).toBe(true);
    expect(eventPlaceIncomplete({ city: null, country: "NL" })).toBe(true);
    // A meeting keeps a room or a call and its zone's clock, so settings never ask for a place.
    expect(eventPlaceNeeded({ city: null, country: null, profileKey: "conference", seriesId: null })).toBe(true);
    expect(eventPlaceNeeded({ city: null, country: null, profileKey: "meeting", seriesId: null })).toBe(false);
    expect(eventPlaceNeeded({ city: null, country: null, profileKey: "workshop", seriesId: "series" })).toBe(false);
  });

  it("names Austin's clock by its city on the Chicago zone", () => {
    expect(formatClockName(eventClock({ timezone: "America/Chicago", city: "Austin" }))).toBe("Austin time");
    expect(formatClockName(eventClock({ timezone: "America/Chicago", city: null }))).toBe("Chicago time");
  });

  it("knows every assigned country code and names each one", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
    expect(countryName("US", "en")).toBe("United States");
    const options = countryOptions("en");
    expect(options).toHaveLength(249);
    expect(options.every((option) => option.label !== option.value)).toBe(true);
    expect(options.find((option) => option.value === "NL")?.label).toBe("Netherlands");
  });

  it("describes the place for structured data with locality and ISO country", () => {
    expect(eventPlaceStructuredData({ city: "Austin", country: "US" })).toEqual({
      "@type": "Place",
      name: "Austin, United States",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressCountry: "US" },
    });
    expect(eventPlaceStructuredData({ city: null, country: null })).toBeUndefined();
    expect(eventPlaceStructuredData(undefined)).toBeUndefined();
  });
});

describe("the event settings contract", () => {
  it("accepts a city with an ISO country code and clears both with null", () => {
    expect(eventSettingsUpdateSchema.parse({ ...revision, city: " Amsterdam ", country: "NL" })).toMatchObject({
      city: "Amsterdam",
      country: "NL",
    });
    expect(eventSettingsUpdateSchema.parse({ ...revision, city: null, country: null })).toMatchObject({
      city: null,
      country: null,
    });
  });

  it.each(["Netherlands", "nl", "NLD", "XK", "EU", ""])("refuses %j as a country", (country) => {
    const result = eventSettingsUpdateSchema.safeParse({ ...revision, country });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["country"], message: "Choose a country from the list." });
  });

  it("refuses a blank or overlong city and no longer knows a free-text location", () => {
    expect(eventSettingsUpdateSchema.safeParse({ ...revision, city: "  " }).success).toBe(false);
    expect(eventSettingsUpdateSchema.safeParse({ ...revision, city: "x".repeat(81) }).success).toBe(false);
    expect(eventSettingsUpdateSchema.parse({ ...revision, location: "Amsterdam, the Netherlands" })).not.toHaveProperty(
      "location",
    );
  });

  it("carries the place on group event creation too", () => {
    const created = groupEventCreateSchema.parse({
      slug: "place-workshop",
      name: "Place workshop",
      profileKey: "workshop",
      city: "Ottawa",
      country: "CA",
    });
    expect(created).toMatchObject({ city: "Ottawa", country: "CA" });
    expect(groupEventCreateSchema.safeParse({ ...created, country: "Canada" }).success).toBe(false);
  });
});
