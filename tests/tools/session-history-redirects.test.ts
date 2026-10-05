import { describe, it, expect } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema } from "../../assets/shared/schemas/event-session-history";
import { publishedSessionRoute } from "../../assets/shared/session-public-route";
import { collectSessionRedirects } from "../../scripts/publication/collect-session-redirects.mjs";
const session = {
  id: "session",
  title: "Session",
  kind: "session",
  visibility: "public",
  description: "A substantial approved abstract describing this conference session.",
  startAt: "2026-10-03T09:00:00.000Z",
  endAt: "2026-10-03T10:00:00.000Z",
  history: { legacyPaths: ["/events/legacy/session/"] },
};
const snapshot = { eventAgendas: { event: { eventSlug: "event", occurrences: [session] } } };
const files = ["events/event/sessions/session/index.html"];
describe("archive release redirects", () => {
  it("only emits aliases for actual generated public sessions", () => {
    expect(collectSessionRedirects(snapshot, files)).toEqual([
      { from: "/events/legacy/session/", to: "/events/event/sessions/session/", status: 301 },
    ]);
    expect(collectSessionRedirects(snapshot, [])).toEqual([]);
  });
  it("rejects collisions and sensitive workflow paths", () => {
    expect(() => collectSessionRedirects(snapshot, [...files, "events/legacy/session/index.html"])).toThrow(/collides/);
    expect(() =>
      collectSessionRedirects(
        {
          eventAgendas: {
            event: { eventSlug: "event", occurrences: [{ ...session, history: { legacyPaths: ["/portal/"] } }] },
          },
        },
        files,
      ),
    ).toThrow(/event page paths/);
  });
  it("publishes an explicitly reviewed renamed historical URL with the current generated archive", () => {
    const oldUrl = "/events/previous-name/sessions/previous-title/";
    const initial = agendaSnapshotSchema.parse({
      eventSlug: "event",
      timeZone: "Europe/Amsterdam",
      revision: 1,
      publishedRevision: 1,
      rooms: [],
      blocks: [],
      roleMembers: [],
      assignments: [],
      occurrences: [
        {
          ...session,
          roomId: null,
          speakers: [],
          startAt: null,
          endAt: null,
          history: {
            archivalTiming: {
              sourcePath: "events/previous-name/agenda.yaml",
              sourceDigest: "a".repeat(64),
              provenance: "authored_public",
              timeZone: "Europe/Amsterdam",
              authoredDate: "2020-10-03",
              authoredStart: "09:00",
              startAt: "2020-10-03T07:00:00.000Z",
              endAt: null,
            },
          },
        },
      ],
    });
    const beforeReview = structuredClone(initial);
    const occurrence = initial.occurrences[0]!;
    // The authorized correction records the known old URL; no alias is inferred from its title.
    occurrence.history = sessionHistoryMetadataSchema.parse({ ...occurrence.history, legacyPaths: [oldUrl] });
    occurrence.title = "Reviewed current title";
    initial.revision = 2;
    initial.publishedRevision = 2;
    const target = publishedSessionRoute(initial.eventSlug, occurrence)!;
    const generatedFiles = [`${target.slice(1)}index.html`];
    const release = (agenda: typeof initial) => ({ eventAgendas: { event: agenda } });
    expect(collectSessionRedirects(release(beforeReview), generatedFiles)).toEqual([]);
    expect(collectSessionRedirects(release(initial), [])).toEqual([]);
    expect(collectSessionRedirects(release(initial), generatedFiles)).toEqual([
      { from: oldUrl, to: target, status: 301 },
    ]);
    // A later title correction preserves the reviewed URL and stable occurrence destination.
    occurrence.title = "Another approved title";
    expect(collectSessionRedirects(release(initial), generatedFiles)).toEqual([
      { from: oldUrl, to: target, status: 301 },
    ]);
    occurrence.visibility = "private";
    expect(collectSessionRedirects(release(initial), generatedFiles)).toEqual([]);
  });
});
