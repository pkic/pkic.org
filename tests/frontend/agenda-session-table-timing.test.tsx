import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { agendaSessionColumns } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/session-table-columns";
import { agendaSnapshotSchema, agendaOccurrenceListItemSchema } from "../../assets/shared/schemas/event-agenda";
import { formatCalendarDate, formatTimeRangeInZone } from "../../assets/shared/format-date";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "historical",
  timeZone: "Europe/Amsterdam",
  revision: 1,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
const columns = agendaSessionColumns(snapshot, [], false, () => []);
function cell(name: string, value: unknown) {
  const row = agendaOccurrenceListItemSchema.parse(value);
  const column = columns.find((candidate) => candidate.header === name)!;
  return render(<div>{column.cell(row, 0)}</div>);
}
const archived = {
  id: "networking",
  title: "Networking",
  description: "Historical authored item",
  startAt: null,
  endAt: null,
  roomId: null,
  speakers: [],
  history: {
    archivalTiming: {
      sourcePath: "content/events/archive/agenda.yaml",
      sourceDigest: "a".repeat(64),
      provenance: "authored_public",
      timeZone: "Europe/Amsterdam",
      authoredDate: "2023-11-07",
      authoredStart: "15:30",
      startAt: "2023-11-07T14:30:00.000Z",
      endAt: null,
    },
  },
  demand: {
    physical: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
    remote: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
  },
  conflicts: { hasConflict: false, categories: [], coverage: "not_scheduled" },
};
describe("session table historical display and conflict coverage", () => {
  it("renders authored historical day/start and unknown ending without inventing a scheduled interval", () => {
    expect(cell("Day", archived)).toContain(formatCalendarDate("2023-11-07"));
    const timing = cell("Time", archived);
    expect(timing).toContain(formatTimeRangeInZone("2023-11-07T14:30:00.000Z", undefined, snapshot.timeZone));
    expect(timing).toContain("End not recorded");
    expect(timing).not.toContain("Unscheduled");
    const row = agendaOccurrenceListItemSchema.parse(archived);
    expect(row.startAt).toBeNull();
    expect(row.endAt).toBeNull();
  });
  it("does not present incomplete timing or unresolved source checks as a green clear result", () => {
    expect(cell("Conflicts", archived)).toContain("Not checked");
    expect(cell("Conflicts", archived)).not.toContain("pk-badge--ok");
    const unresolved = { ...archived, conflicts: { hasConflict: false, categories: [], coverage: "incomplete" } };
    expect(cell("Conflicts", unresolved)).toContain("Needs review");
    expect(cell("Conflicts", unresolved)).toContain("pk-badge--warn");
    expect(cell("Conflicts", unresolved)).not.toContain(">Clear<");
  });
  it("prefers the real canonical interval over older authored timing", () => {
    const scheduled = { ...archived, startAt: "2023-11-08T10:00:00.000Z", endAt: "2023-11-08T11:00:00.000Z" };
    expect(cell("Day", scheduled)).toContain(formatCalendarDate("2023-11-08"));
    expect(cell("Time", scheduled)).not.toContain("End not recorded");
  });
  it("shows frozen appearance names and source-only credits without current-profile substitution", () => {
    const credited = {
      ...archived,
      speakers: [
        { userId: "frozen-person", displayName: "Current roster name" },
        { userId: "roster-person", displayName: "Unfrozen roster credit" },
      ],
      history: {
        ...archived.history,
        appearances: [
          {
            userId: "frozen-person",
            actingIdentityId: null,
            displayName: "Approved historical name",
            jobTitle: null,
            organizationName: null,
            photoUrl: null,
            approvedAt: "2023-11-07T12:00:00.000Z",
          },
        ],
        archivalCredits: [
          {
            sourceRef: "authored-presenter",
            sourcePath: "content/events/archive/agenda.yaml",
            sourceDigest: "a".repeat(64),
            provenance: "authored_public",
            displayName: "Source-only presenter",
            jobTitle: null,
            organizationName: null,
            photoUrl: null,
          },
        ],
      },
    };
    expect(cell("Speakers", credited)).toBe(
      "<div>Approved historical name, Unfrozen roster credit, Source-only presenter</div>",
    );
    expect(
      cell("Speakers", { ...credited, speakers: [], history: { archivalCredits: credited.history.archivalCredits } }),
    ).toBe("<div>Source-only presenter</div>");
    expect(cell("Speakers", archived)).toBe("<div>—</div>");
  });
});
