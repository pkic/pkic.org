import { XMLParser } from "fast-xml-parser";
import { expect, it } from "vitest";
import { agendaOccurrenceSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { publishedSnapshotSitemapEntries, renderPublishedDiscovery } from "../functions/_lib/services/site-discovery";
import fixture from "./fixtures/site-publication.json";

function sitemapDates(xml: string): Map<string, string | undefined> {
  const entries = new XMLParser({ parseTagValue: false, isArray: (name) => name === "url" }).parse(xml, true).urlset
    .url;
  const dates = new Map<string, string | undefined>();
  for (const entry of entries) dates.set(entry.loc, entry.lastmod);
  return dates;
}

const occurrence = (id: string, userId = "archive-person") =>
  agendaOccurrenceSchema.parse({
    id,
    title: "Practical cryptographic operations",
    description: "Operational lessons from an approved historical cryptographic migration session.",
    startAt: "2026-10-03T09:00:00.000Z",
    endAt: "2026-10-03T10:00:00.000Z",
    roomId: null,
    speakers: [{ userId, displayName: "Archive speaker" }],
    history: {
      appearances: [
        {
          userId,
          actingIdentityId: null,
          displayName: "Archive speaker",
          jobTitle: null,
          organizationName: null,
          photoUrl: null,
          approvedAt: "2026-09-30T08:00:00.000Z",
        },
      ],
    },
  });

const agenda = (eventSlug: string, approvedAt: string, occurrences: ReturnType<typeof occurrence>[]) =>
  agendaSnapshotSchema.parse({
    eventSlug,
    approvedAt,
    timeZone: "Europe/Amsterdam",
    revision: 1,
    publishedRevision: 1,
    rooms: [],
    occurrences,
    shifts: [],
    roleMembers: [],
    assignments: [],
  });

it("generates archive sitemap dates from included approved appearances without private or thin entries", async () => {
  const firstApproved = "2026-10-01T08:00:00.000Z";
  const latestApproved = "2026-10-03T12:30:00.000Z";
  const publication = sitePublicationSnapshotSchema.parse({
    ...fixture,
    eventAgendas: {
      first: agenda("archive-first", firstApproved, [occurrence("first-session")]),
      second: agenda("archive-second", latestApproved, [occurrence("second-session")]),
      excluded: agenda("archive-excluded", "2026-10-04T16:00:00.000Z", [
        { ...occurrence("private-session", "private-person"), visibility: "private" },
        { ...occurrence("private-appearance"), visibility: "private" },
        { ...occurrence("thin-session", "thin-person"), description: "" },
        { ...occurrence("break-session", "break-person"), kind: "break" },
      ]),
    },
  });
  const entries = publishedSnapshotSitemapEntries(publication);
  const response = renderPublishedDiscovery(new Request("https://pkic.org/en/sitemap.xml"), entries);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/xml; charset=UTF-8");
  const urls = sitemapDates(await response.text());
  expect(urls.get("https://pkic.org/events/archive-first/sessions/first-session/")).toBe(firstApproved);
  expect(urls.get("https://pkic.org/events/archive-second/sessions/second-session/")).toBe(latestApproved);
  expect(urls.get("https://pkic.org/people/archive-person/")).toBe(latestApproved);
  for (const hidden of [
    "private-session",
    "private-appearance",
    "private-person",
    "thin-session",
    "thin-person",
    "break-session",
    "break-person",
  ])
    expect(
      [...urls.keys()].some((url) => url?.includes(hidden)),
      hidden,
    ).toBe(false);

  publication.eventAgendas!.excluded!.approvedAt = "2026-10-05T00:00:00.000Z";
  expect(publishedSnapshotSitemapEntries(publication)).toEqual(entries);
});

it("omits absent or invalid dates rather than inventing a build timestamp", async () => {
  const response = renderPublishedDiscovery(new Request("https://pkic.org/en/sitemap.xml"), [
    { route: "/people/undated/" },
    { route: "/events/undated/sessions/invalid/", lastModified: "not-a-date" },
  ]);
  const dates = sitemapDates(await response.text());
  for (const route of ["/people/undated/", "/events/undated/sessions/invalid/"]) {
    expect(dates.has(`https://pkic.org${route}`)).toBe(true);
    expect(dates.get(`https://pkic.org${route}`)).toBeUndefined();
  }
});
