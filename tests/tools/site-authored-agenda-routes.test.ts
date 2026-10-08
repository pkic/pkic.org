import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { agendaTransferDigest } from "../../assets/shared/event-agenda-transfer";
import { publicationAuthoredAgendaRoutes } from "../../assets/shared/publication-agenda-routes";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { readAuthoredAgendaSources } from "../../functions/_lib/services/site-authored-agenda-sources";
import { contentPathToRoute, parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import { nodePathForSource, type ContentDocument } from "../../functions/_lib/services/site-documents";
import { approvedEventAgendaForRoute } from "../../functions/_lib/services/site-published-event-agendas";
import { createSiteConferencePrograms } from "../../functions/_lib/services/site-conference-program-catalog";
import { collectSessionRedirects } from "../../scripts/publication/collect-session-redirects.mjs";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";

const route = "/events/2023/original/";
const agenda = agendaSnapshotSchema.parse({
  eventSlug: "current-slug-2023",
  publicAgendaPath: "/events/current-slug-2023/agenda/",
  timeZone: "UTC",
  revision: 1,
  publishedRevision: 1,
  rooms: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: "native-talk",
      title: "Approved canonical talk",
      visibility: "public",
      kind: "session",
      startAt: "2023-04-01T10:00:00.000Z",
      endAt: "2023-04-01T11:00:00.000Z",
      roomId: null,
      speakers: [],
    },
  ],
});
const owner = {
  eventSlug: agenda.eventSlug,
  sourcePath: "content/events/2023/original/index.md",
  sourceDigest: "a".repeat(64),
  route,
};
function publication(owners = [owner]) {
  return sitePublicationSnapshotSchema.parse({
    version: 1,
    snapshotId: "f".repeat(64),
    eventAgendas: { [agenda.eventSlug]: agenda },
    authoredAgendaRoutes: owners,
    votes: [],
    publicResources: {},
    members: [],
    groups: {},
    groupMembers: {},
    sponsors: {},
    memberWall: [],
    news: [],
    sponsorNews: [],
  });
}
const targetFile = "events/current-slug-2023/agenda/index.html";
function document(sourcePath: string, text: string): ContentDocument {
  const parsed = parseFrontMatter(text);
  const runtimeSourcePath = `../../${sourcePath}`;
  return {
    ...parsed,
    sourcePath: runtimeSourcePath,
    route: contentPathToRoute(runtimeSourcePath, parsed.data),
    nodePath: nodePathForSource(runtimeSourcePath),
    language: "en",
    isSection: sourcePath.endsWith("/_index.md"),
  };
}

describe("source-owned original agenda publication paths", () => {
  it.each([
    "content/events/2023/post-quantum-cryptography-conference/index.md",
    "content/events/2023/pqc-conference-amsterdam-nl/index.md",
    "content/events/2025/pqc-conference-austin-us/index.md",
    "content/events/2025/pqc-conference-kuala-lumpur-my/_index.md",
  ])("derives actual authored source path, parsed-data digest and exact route for %s", async (sourcePath) => {
    const source = document(sourcePath, await readFile(sourcePath, "utf8"));
    expect(await readAuthoredAgendaSources([source])).toEqual([
      { sourcePath, sourceDigest: await agendaTransferDigest(source.data.data), route: source.route },
    ]);
  });
  it("uses the same owner for original overview/child agenda and program JSON while leaving other pages alone", () => {
    const snapshot = publication();
    expect(approvedEventAgendaForRoute(snapshot, route)?.eventSlug).toBe(agenda.eventSlug);
    expect(approvedEventAgendaForRoute(snapshot, `${route}details/`, route)?.eventSlug).toBe(agenda.eventSlug);
    expect(approvedEventAgendaForRoute(snapshot, "/events/other/")).toBeUndefined();
    const source = document(
      owner.sourcePath,
      "---\ntitle: Original narrative\noutputs: [event-data]\ndata:\n  name: Original\n  timezone: UTC\n  agenda: {}\n---\nOverview stays intact\n{{< agenda >}}\n",
    );
    const program = createSiteConferencePrograms([source], () => [])(snapshot)[0]!.program;
    expect(program.timezone).toBe(agenda.timeZone);
    expect(program.agenda["2023-04-01"]![0]!.sessions[0]!.title).toBe("Approved canonical talk");
    expect(source.body).toContain("Overview stays intact");
  });
  it("emits only target-backed original /agenda aliases and refuses generated-page collisions", () => {
    const snapshot = publication();
    expect(collectSessionRedirects(snapshot, [targetFile])).toEqual([
      { from: `${route}agenda/`, to: agenda.publicAgendaPath, status: 301 },
    ]);
    expect(() => collectSessionRedirects(snapshot, [])).toThrow("target was not generated");
    expect(() => collectSessionRedirects(snapshot, [targetFile, "events/2023/original/agenda/index.html"])).toThrow(
      "collides",
    );
    const alreadyOriginal = {
      ...snapshot,
      eventAgendas: { [agenda.eventSlug]: { ...agenda, publicAgendaPath: `${route}agenda/` } },
    };
    expect(collectSessionRedirects(alreadyOriginal, ["events/2023/original/agenda/index.html"])).toEqual([]);
  });
  it("refuses competing source owners and another canonical event root", () => {
    const snapshot = publication();
    const other = { ...agenda, eventSlug: "other", publicAgendaPath: "/events/other/agenda/" };
    expect(() =>
      publicationAuthoredAgendaRoutes({
        ...snapshot,
        eventAgendas: { ...snapshot.eventAgendas, other },
        authoredAgendaRoutes: [owner, { ...owner, eventSlug: "other" }],
      }),
    ).toThrow("multiple source owners");
    expect(() =>
      publicationAuthoredAgendaRoutes({
        ...snapshot,
        eventAgendas: { ...snapshot.eventAgendas, other },
        authoredAgendaRoutes: [{ ...owner, route: "/events/other/" }],
      }),
    ).toThrow("another canonical agenda");
    expect(() =>
      publicationAuthoredAgendaRoutes({ ...snapshot, authoredAgendaRoutes: [{ ...owner, eventSlug: "missing" }] }),
    ).toThrow("approved agenda");
  });
  it("omits draft/translated/non-event data instead of making extra original aliases", async () => {
    const source = document(owner.sourcePath, "---\ndata: {timezone: UTC, agenda: {}}\n---\n");
    expect(
      await readAuthoredAgendaSources([
        { ...source, data: { ...source.data, draft: true } },
        { ...source, language: "ms" },
        { ...source, sourcePath: "content/blog/event.md" },
      ]),
    ).toEqual([]);
  });
});
