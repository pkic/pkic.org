import ICAL from "ical.js";
import { publicationRouteCacheKey } from "../../site/publication-cache";
import { sessionHistoryMetadataSchema } from "../../assets/shared/schemas/event-session-history";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { publicAgendaProjection } from "../../functions/_lib/services/event-agenda/public-projection";
import {
  publicAgendaCalendarPages,
  publicConferenceAgendaCalendar,
  publicSessionCalendarPages,
} from "../../functions/_lib/services/site-agenda-calendar-pages";
import { approvedEventProgram } from "../../functions/_lib/services/site-published-event-agendas";
import { applyApprovedAgenda } from "../../functions/_lib/services/site-approved-agenda";
import { describe, expect, it } from "vitest";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../../assets/shared/schemas/event-agenda";
import { publicAgendaCalendarEntrySchema } from "../../assets/shared/schemas/site-agenda-calendar";
import { createPublicAgendaCalendarProjection } from "../../functions/_lib/services/site-agenda-calendar-projection";
import {
  publicAgendaCalendar,
  publicSessionCalendarPath,
} from "../../functions/_lib/services/site-public-agenda-calendar";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";
import { publishedConferenceProgram } from "../../functions/_lib/services/site-conference-program";

const start = "2026-12-01T09:00:00.000Z",
  end = "2026-12-01T10:00:00.000Z";
const dates = ["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"];
function approval(revision: number, change?: (value: AgendaSnapshot) => void) {
  const value = agendaSnapshotSchema.parse({
    eventSlug: "calendar-fixture",
    eventName: "Synthetic public conference",
    timeZone: "Europe/Amsterdam",
    publicAgendaPath: "/events/calendar-fixture/agenda/",
    revision,
    publishedRevision: revision,
    approvedAt: dates[Math.min(revision - 1, 2)],
    calendarPublic: true,
    rooms: [{ id: "hall", name: "Hall", capacity: 20 }],
    shifts: [],
    assignments: [],
    roleMembers: [],
    occurrences: [
      {
        id: "public",
        title: "Certificate operations",
        description: "Public abstract",
        startAt: start,
        endAt: end,
        roomId: "hall",
        track: "Operations",
        speakers: [{ userId: "synthetic-person", displayName: "Synthetic speaker" }],
      },
    ],
  });
  change?.(value);
  return value;
}
function fold(...snapshots: AgendaSnapshot[]) {
  const result = createPublicAgendaCalendarProjection(dates[2]!);
  for (const snapshot of snapshots) result.append(snapshot);
  return result.finish(true)!;
}
function events(calendar: ReturnType<typeof fold>, id?: string) {
  return new ICAL.Component(
    ICAL.parse(publicAgendaCalendar(calendar, "https://example.test", { occurrenceId: id })),
  ).getAllSubcomponents("vevent");
}

describe("static public calendar approved-history lifecycle", () => {
  it("uses the existing UID and exact UTC window in both subscription and one-session downloads", () => {
    const calendar = fold(approval(1));
    const event = events(calendar)[0]!;
    expect(event.getFirstPropertyValue("uid")).toBe("agenda-public@ics.pkic.org");
    expect(event.getFirstPropertyValue("sequence")).toBe(0);
    expect(new ICAL.Event(event).startDate.toJSDate().toISOString()).toBe(start);
    expect(new ICAL.Event(event).endDate.toJSDate().toISOString()).toBe(end);
    expect(event.getFirstProperty("categories")!.getValues()).toEqual(["Hall", "Operations"]);
    expect(events(calendar, "public")[0]!.toJSON()).toEqual(event.toJSON());
    expect(publicSessionCalendarPath(calendar.agendaPath, "public")).toBe(
      "/events/calendar-fixture/agenda/calendar/public.ics",
    );
  });
  it("reuses actual calendar output keys for unrelated drafts and changes them for withdrawal, expiry and restoration", () => {
    const first = approval(1);
    const second = approval(2, (value) => {
      value.occurrences.push({
        ...structuredClone(value.occurrences[0]!),
        id: "unapproved-draft",
        visibility: "private",
        title: "Private draft change",
      });
    });
    const active = fold(first);
    const path = `${active.agendaPath}calendar.ics`;
    const key = (calendar: ReturnType<typeof fold>, occurrenceId?: string) =>
      publicationRouteCacheKey(occurrenceId ? publicSessionCalendarPath(calendar.agendaPath, occurrenceId) : path, {
        calendar: publicAgendaCalendar(calendar, "https://pkic.org", { occurrenceId }),
      });
    expect(key(fold(first, second))).toBe(key(active));
    const removed = approval(2, (value) => {
      value.occurrences = [];
    });
    const canceled = fold(first, removed);
    expect(key(canceled)).not.toBe(key(active));
    const rebuilt = createPublicAgendaCalendarProjection(new Date(Date.parse(dates[1]!) + 91 * 86400000).toISOString());
    rebuilt.append(first);
    rebuilt.append(removed);
    const expired = rebuilt.finish(true)!;
    expect(expired.entries).toEqual([]);
    expect(key(expired)).not.toBe(key(canceled));
    expect(key(fold(first, removed, approval(3)))).not.toBe(key(active));
    const paired = approval(1, (value) =>
      value.occurrences.push({ ...structuredClone(value.occurrences[0]!), id: "untouched" }),
    );
    const changed = structuredClone(paired);
    changed.revision = changed.publishedRevision = 2;
    changed.approvedAt = dates[1];
    changed.occurrences[0]!.title = "A changed public session";
    const originalPair = fold(paired),
      changedPair = fold(paired, changed);
    expect(key(changedPair)).not.toBe(key(originalPair));
    expect(key(changedPair, "public")).not.toBe(key(originalPair, "public"));
    expect(key(changedPair, "untouched")).toBe(key(originalPair, "untouched"));
  });
  it("does not advance sequence or timestamp for an unrelated approval or draft candidate", () => {
    const second = approval(2, (snapshot) => {
      snapshot.occurrences.push({
        ...snapshot.occurrences[0]!,
        id: "draft",
        visibility: "private",
        title: "Private draft",
      });
      snapshot.occurrences[0]!.presentationUrl = "/unapproved-candidate.pdf";
    });
    expect(fold(approval(1), second).entries).toEqual(fold(approval(1)).entries);
    expect(publicAgendaCalendar(fold(approval(1), second), "https://example.test")).not.toContain(
      "unapproved-candidate",
    );
  });
  it("increments only a changed occurrence for title, window, public credits and room changes", () => {
    const original = approval(1, (snapshot) =>
      snapshot.occurrences.push({ ...structuredClone(snapshot.occurrences[0]!), id: "unchanged" }),
    );
    const second = structuredClone(original);
    second.revision = second.publishedRevision = 2;
    second.approvedAt = dates[1];
    second.occurrences[0]!.title = "Moved session";
    second.occurrences[0]!.startAt = "2026-12-01T11:00:00.000Z";
    second.occurrences[0]!.endAt = "2026-12-01T12:00:00.000Z";
    second.occurrences[0]!.speakers[0]!.displayName = "Updated public credit";
    second.occurrences[0]!.roomId = null;
    const entries = fold(original, second).entries;
    expect(entries.find((entry) => entry.occurrenceId === "public")).toMatchObject({
      sequence: 1,
      updatedAt: dates[1],
      title: "Moved session",
    });
    expect(entries.find((entry) => entry.occurrenceId === "unchanged")).toMatchObject({
      sequence: 0,
      updatedAt: dates[0],
    });
  });
  it.each(["removed", "private", "unscheduled", "invalid"])(
    "retains a minimal cancellation for a formerly valid public occurrence made %s",
    (kind) => {
      const second = approval(2, (snapshot) => {
        if (kind === "removed") snapshot.occurrences = [];
        else if (kind === "private") snapshot.occurrences[0]!.visibility = "private";
        else if (kind === "unscheduled") snapshot.occurrences[0]!.startAt = snapshot.occurrences[0]!.endAt = null;
        else snapshot.occurrences[0]!.endAt = start;
      });
      const calendar = fold(approval(1), second);
      expect(calendar.entries).toEqual([
        { occurrenceId: "public", sequence: 1, updatedAt: dates[1], startAt: start, endAt: end, status: "canceled" },
      ]);
      const event = events(calendar)[0]!;
      expect(event.getFirstPropertyValue("status")).toBe("CANCELLED");
      expect(event.getFirstPropertyValue("summary")).toBe("Canceled session");
      for (const name of ["description", "location", "url", "conference", "categories"])
        expect(event.hasProperty(name)).toBe(false);
      expect(publicAgendaCalendar(calendar, "https://example.test")).not.toMatch(
        /Synthetic speaker|Certificate operations|Public abstract/,
      );
    },
  );
  it("lets the latest reintroduced active occurrence supersede the older tombstone with a higher sequence", () => {
    const calendar = fold(
      approval(1),
      approval(2, (snapshot) => {
        snapshot.occurrences = [];
      }),
      approval(3),
    );
    expect(calendar.entries).toHaveLength(1);
    expect(calendar.entries[0]).toMatchObject({ status: "confirmed", sequence: 2, updatedAt: dates[2] });
    expect(events(calendar)).toHaveLength(1);
  });
  it("retains cancellations for90 days without resetting their original timestamp on a fresh build", () => {
    const removed = approval(2, (snapshot) => {
      snapshot.occurrences = [];
    });
    const canceledAt = Date.parse(dates[1]!);
    for (const [elapsed, expected] of [
      [90, 1],
      [91, 0],
    ]) {
      const rebuilt = createPublicAgendaCalendarProjection(new Date(canceledAt + elapsed! * 86400000).toISOString());
      rebuilt.append(approval(1));
      rebuilt.append(removed);
      const calendar = rebuilt.finish(true)!;
      expect(calendar.entries).toHaveLength(expected!);
      if (expected) expect(calendar.entries[0]!.updatedAt).toBe(dates[1]);
    }
  });
  it("keeps a proven withdrawn route empty on day91 rather than reviving the legacy authored program", () => {
    const rebuilt = createPublicAgendaCalendarProjection(new Date(Date.parse(dates[1]!) + 91 * 86400000).toISOString());
    rebuilt.append(approval(1));
    rebuilt.visibility(false, dates[1]!);
    const calendar = rebuilt.finish(false)!;
    expect(calendar.name).toBe("Event calendar");
    expect(calendar.entries).toEqual([]);
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
      eventAgendaCalendars: { "calendar-fixture": calendar },
    });
    const event = {
      route: "/events/calendar-fixture/",
      updatedAt: dates[0]!,
      program: publishedConferenceProgram(
        {
          name: "Withdrawn former title",
          timezone: "Europe/Amsterdam",
          agenda: {
            "2026-12-01": [
              {
                time: "10:00",
                duration: 60,
                sessions: [{ title: "Withdrawn authored appointment", speakers: ["Withdrawn person"] }],
              },
            ],
          },
        },
        () => [],
      ),
    };
    const canonical = publicAgendaCalendarPages(publication)[0]!;
    expect(canonical.path).toBe("/events/calendar-fixture/agenda/calendar.ics");
    for (const content of [canonical.content, publicConferenceAgendaCalendar(publication, event)]) {
      expect(new ICAL.Component(ICAL.parse(content)).getAllSubcomponents("vevent")).toEqual([]);
      expect(content).not.toMatch(/Withdrawn former title|Withdrawn authored appointment|Withdrawn person/);
    }
  });
  it("uses exact retained and approved paths when canonical slug differs from authored legacy route", () => {
    const snapshot = approval(1, (value) => {
      value.eventSlug = "new";
      value.publicAgendaPath = "/events/old/agenda/";
    });
    const active = fold(snapshot);
    const projected = publicAgendaProjection(snapshot, "/events/old");
    expect(projected.publicAgendaPath).toBe("/events/old/agenda/");
    const event = {
      route: "/events/old/",
      updatedAt: dates[0]!,
      program: publishedConferenceProgram(
        {
          name: "Authored former label",
          timezone: "Europe/Amsterdam",
          agenda: {
            "2026-12-01": [
              { time: "10:00", durationMinutes: 60, sessions: [{ title: "Unapproved authored fallback" }] },
            ],
          },
          locations: { hall: { name: "Hall", color: "green", livestream: "https://example.test/public-room" } },
        },
        () => [],
      ),
    };
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
      eventAgendas: { new: projected },
      eventAgendaCalendars: { new: active },
    });
    const exported = new ICAL.Component(
      ICAL.parse(publicConferenceAgendaCalendar(publication, event)),
    ).getAllSubcomponents("vevent");
    expect(exported).toHaveLength(1);
    expect(exported[0]!.getFirstPropertyValue("uid")).toBe("agenda-public@ics.pkic.org");
    expect(exported[0]!.getFirstPropertyValue("summary")).toBe("Certificate operations");
    expect(exported[0]!.getFirstPropertyValue("color")).toBe("green");
    expect(exported[0]!.getFirstProperty("conference")!.getFirstValue()).toBe("https://example.test/public-room");
    const retired = createPublicAgendaCalendarProjection(new Date(Date.parse(dates[1]!) + 91 * 86400000).toISOString());
    retired.append(snapshot);
    retired.visibility(false, dates[1]!);
    const withdrawn = sitePublicationSnapshotSchema.parse({
      ...publication,
      eventAgendas: {},
      eventAgendaCalendars: { new: retired.finish(false)! },
    });
    const content = publicConferenceAgendaCalendar(withdrawn, event);
    expect(new ICAL.Component(ICAL.parse(content)).getAllSubcomponents("vevent")).toEqual([]);
    expect(content).not.toMatch(
      /Authored former label|Unapproved authored fallback|Certificate operations|Synthetic speaker/,
    );
    expect(() =>
      publicConferenceAgendaCalendar(
        {
          ...withdrawn,
          eventAgendaCalendars: { ...withdrawn.eventAgendaCalendars, duplicate: retired.finish(false)! },
        },
        event,
      ),
    ).toThrow("PUBLIC_CALENDAR_ROUTE_CONFLICT");
    expect(() =>
      publicConferenceAgendaCalendar(
        {
          ...publication,
          eventAgendas: { ...publication.eventAgendas, duplicate: projected },
        },
        event,
      ),
    ).toThrow("PUBLIC_CALENDAR_ROUTE_CONFLICT");
  });
  it("resolves an owned original calendar to a different canonical path, including retained cancellations", () => {
    const first = approval(1, (value) => {
      value.occurrences.push({
        ...value.occurrences[0]!,
        id: "archival",
        startAt: null,
        endAt: null,
        history: sessionHistoryMetadataSchema.parse({
          archivalTiming: {
            sourcePath: "data/events/synthetic/agenda.yaml",
            sourceDigest: "a".repeat(64),
            provenance: "authored_public",
            timeZone: "Europe/Amsterdam",
            authoredDate: "2023-06-06",
            authoredStart: "15:30",
            startAt: "2023-06-06T13:30:00.000Z",
            endAt: null,
          },
        }),
      });
    });
    const changed = structuredClone(first);
    changed.revision = changed.publishedRevision = 2;
    changed.approvedAt = dates[1];
    changed.occurrences[0]!.title = "Updated session";
    const active = fold(first, changed);
    const event = {
      route: "/events/2025/original-conference/",
      updatedAt: "2024-08-15T08:00:00.000Z",
      program: approvedEventProgram(first),
    };
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
      eventAgendas: { "calendar-fixture": changed },
      eventAgendaCalendars: { "calendar-fixture": active },
      authoredAgendaRoutes: [
        {
          eventSlug: "calendar-fixture",
          route: event.route,
          sourcePath: "content/events/2025/original-conference/_index.md",
          sourceDigest: "b".repeat(64),
        },
      ],
    });
    const canonical = publicAgendaCalendarPages(publication)[0]!;
    const legacy = new ICAL.Component(
      ICAL.parse(publicConferenceAgendaCalendar(publication, event)),
    ).getAllSubcomponents("vevent");
    const native = new ICAL.Component(ICAL.parse(canonical.content)).getAllSubcomponents("vevent");
    expect(legacy).toHaveLength(2);
    expect(legacy.map((entry) => entry.toJSON())).toEqual(native.map((entry) => entry.toJSON()));
    const archival = legacy.find((entry) => entry.getFirstPropertyValue("uid") === "agenda-archival@ics.pkic.org")!;
    expect(archival.hasProperty("dtend")).toBe(false);
    expect(archival.hasProperty("status")).toBe(false);
    expect(archival.getFirstPropertyValue("url")).toBe("https://pkic.org/events/calendar-fixture/agenda/");
    expect(legacy[0]!.toJSON()).toEqual(native[0]!.toJSON());
    expect(legacy[0]!.getFirstPropertyValue("uid")).toBe("agenda-public@ics.pkic.org");
    expect(legacy[0]!.getFirstPropertyValue("sequence")).toBe(1);
    expect(legacy[0]!.getFirstPropertyValue("dtstamp")?.toString()).toBe("2026-10-02T00:00:00Z");
    const hidden = approval(3, (value) => {
      value.occurrences = [];
    });
    const withdrawn = sitePublicationSnapshotSchema.parse({
      ...publication,
      eventAgendas: { "calendar-fixture": hidden },
      eventAgendaCalendars: { "calendar-fixture": fold(first, changed, hidden) },
    });
    const canceled = new ICAL.Component(
      ICAL.parse(publicConferenceAgendaCalendar(withdrawn, event)),
    ).getAllSubcomponents("vevent");
    expect(canceled).toHaveLength(1);
    expect(canceled[0]!.getFirstPropertyValue("status")).toBe("CANCELLED");
    expect(canceled[0]!.getFirstPropertyValue("sequence")).toBe(2);
    expect(canceled[0]!.toJSON()).toEqual(
      new ICAL.Component(ICAL.parse(publicAgendaCalendarPages(withdrawn)[0]!.content))
        .getAllSubcomponents("vevent")[0]!
        .toJSON(),
    );
  });
  it("never invents native appointments/cancellations from unmarked, private or unknown-end history", () => {
    const unmarked = approval(1, (snapshot) => {
      snapshot.calendarPublic = undefined;
      snapshot.occurrences[0]!.id = "old-unproven";
    });
    const uncertain = approval(2, (snapshot) => {
      snapshot.occurrences[0]!.id = "unknown-end";
      snapshot.occurrences[0]!.endAt = null;
      snapshot.occurrences.push({ ...snapshot.occurrences[0]!, id: "private", visibility: "private", endAt: end });
    });
    expect(fold(unmarked, uncertain).entries).toEqual([]);
    const current = createPublicAgendaCalendarProjection(dates[2]!);
    current.append(unmarked);
    expect(current.finish(true)!.entries[0]).toMatchObject({ occurrenceId: "old-unproven", sequence: 0 });
  });
  it("uses immutable visibility transitions for withdrawal and restoration, never a later unrelated update clock", () => {
    const result = createPublicAgendaCalendarProjection(dates[2]!);
    result.append(approval(1));
    result.visibility(false, dates[1]!);
    const withdrawn = result.finish(false)!;
    expect(withdrawn.name).toBe("Event calendar");
    expect(withdrawn.entries[0]).toMatchObject({ sequence: 1, status: "canceled", updatedAt: dates[1] });
    result.visibility(true, dates[2]!);
    expect(result.finish(true)!.entries[0]).toMatchObject({ sequence: 2, status: "confirmed", updatedAt: dates[2] });
    const missingProof = createPublicAgendaCalendarProjection(dates[2]!);
    missingProof.append(approval(1));
    const suppressed = missingProof.finish(false)!;
    expect(suppressed.entries).toEqual([]);
    expect(suppressed.name).toBe("Event calendar");
    expect(publicAgendaCalendar(suppressed, "https://example.test")).not.toMatch(
      /Synthetic speaker|Certificate operations|BEGIN:VEVENT/,
    );
  });
  it("rejects duplicate identities, nonmonotonic approval order and private fields on a canceled contract", () => {
    const result = createPublicAgendaCalendarProjection(dates[2]!);
    result.append(approval(1));
    expect(() => result.append(approval(1))).toThrow("PUBLIC_CALENDAR_HISTORY_ORDER_INVALID");
    expect(() => fold(approval(1, (snapshot) => snapshot.occurrences.push(snapshot.occurrences[0]!)))).toThrow(
      "PUBLIC_CALENDAR_OCCURRENCE_CONFLICT",
    );
    expect(
      publicAgendaCalendarEntrySchema.safeParse({
        status: "canceled",
        occurrenceId: "public",
        sequence: 1,
        startAt: start,
        endAt: end,
        updatedAt: dates[1],
        title: "Private title",
      }).success,
    ).toBe(false);
  });
  it("preserves actual migrated native archival start-only entries through the same canonical route builder", () => {
    const snapshot = approval(1, (value) => {
      value.occurrences.push({
        ...value.occurrences[0]!,
        id: "archival",
        title: "Recorded historical start",
        startAt: null,
        endAt: null,
        history: sessionHistoryMetadataSchema.parse({
          archivalTiming: {
            sourcePath: "data/events/synthetic/agenda.yaml",
            sourceDigest: "a".repeat(64),
            provenance: "authored_public",
            timeZone: "Europe/Amsterdam",
            authoredDate: "2023-06-06",
            authoredStart: "15:30",
            startAt: "2023-06-06T13:30:00.000Z",
            endAt: null,
          },
        }),
      });
      value.occurrences.push({ ...value.occurrences.at(-1)!, id: "private-archival", visibility: "private" });
    });
    const calendar = fold(snapshot);
    expect(calendar.entries.map((entry) => entry.occurrenceId)).toEqual(["public"]);
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
      eventAgendas: { "calendar-fixture": publicAgendaProjection(snapshot, null) },
      eventAgendaCalendars: { "calendar-fixture": calendar },
    });
    const page = publicAgendaCalendarPages(publication)[0]!;
    expect(page.path).toBe("/events/calendar-fixture/agenda/calendar.ics");
    const entries = new ICAL.Component(ICAL.parse(page.content)).getAllSubcomponents("vevent");
    expect(entries).toHaveLength(2);
    const archival = entries.find((entry) => entry.getFirstPropertyValue("uid") === "agenda-archival@ics.pkic.org")!;
    expect(archival.hasProperty("dtend")).toBe(false);
    expect(archival.hasProperty("duration")).toBe(false);
    expect(new ICAL.Event(archival).startDate.toJSDate().toISOString()).toBe("2023-06-06T13:30:00.000Z");
    expect(archival.getFirstPropertyValue("description")).toContain("End not recorded");
    expect(page.content).not.toContain("private-archival");
    expect(publicSessionCalendarPages(publication).map((entry) => entry.path)).toEqual([
      "/events/calendar-fixture/agenda/calendar/public.ics",
    ]);
  });
  it("preserves current approved public room color and conference links only on confirmed entries", () => {
    const snapshot = approval(1);
    const program = applyApprovedAgenda(
      publishedConferenceProgram(
        {
          name: "Conference",
          timezone: snapshot.timeZone,
          agenda: {},
          locations: { hall: { name: "Hall", color: "green", livestream: "https://example.test/public-room" } },
        },
        () => [],
      ),
      publicAgendaProjection(snapshot, null),
    );
    const current = { program, updatedAt: dates[0]!, eventUrl: "https://example.test/events/calendar-fixture/" };
    const calendar = fold(snapshot);
    const active = new ICAL.Component(
      ICAL.parse(publicAgendaCalendar(calendar, "https://example.test", { current })),
    ).getFirstSubcomponent("vevent")!;
    expect(active.getFirstPropertyValue("color")).toBe("green");
    expect(active.getFirstPropertyValue("x-apple-calendar-color")).toBe("green");
    expect(active.getFirstProperty("conference")!.getFirstValue()).toBe("https://example.test/public-room");
    expect(active.getFirstProperty("conference")!.getParameter("feature")).toBe("AUDIO,VIDEO,SCREEN");
    expect(active.getFirstPropertyValue("x-microsoft-onlinemeetingconflink")).toBe("https://example.test/public-room");
    expect(active.getFirstPropertyValue("x-google-conference")).toBe("https://example.test/public-room");
    const canceled = fold(
      snapshot,
      approval(2, (value) => {
        value.occurrences = [];
      }),
    );
    const tombstone = new ICAL.Component(
      ICAL.parse(publicAgendaCalendar(canceled, "https://example.test", { current })),
    ).getFirstSubcomponent("vevent")!;
    expect(tombstone.getFirstPropertyValue("status")).toBe("CANCELLED");
    for (const name of [
      "color",
      "conference",
      "x-apple-calendar-color",
      "x-microsoft-onlinemeetingconflink",
      "x-google-conference",
    ])
      expect(tombstone.hasProperty(name)).toBe(false);
  });
  it("preserves exact legacy UIDs and unknown-end output without fabricating DTEND", () => {
    const program = publishedConferenceProgram(
      {
        name: "Legacy archive",
        timezone: "Europe/Amsterdam",
        agenda: {
          "2026-12-01": [
            {
              time: "10:00",
              sessions: [{ title: "Recorded historical start", locations: ["hall"], endNotRecorded: true }],
            },
          ],
        },
        locations: { hall: { name: "Hall" } },
      },
      () => [],
    );
    const event = new ICAL.Component(
      ICAL.parse(conferenceAgendaCalendar(program, "https://example.test/legacy/", dates[0]!)),
    ).getFirstSubcomponent("vevent")!;
    expect(event.getFirstPropertyValue("uid")).toBe("hall-2026-12-01-1000@ics.pkic.org");
    expect(event.hasProperty("dtend")).toBe(false);
  });
});
