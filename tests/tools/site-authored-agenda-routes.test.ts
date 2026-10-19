import { authoredAgendaPageRoutes as collectAuthoredAgendaPageRoutes } from "../../functions/_lib/services/site-agenda-page-routes";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { agendaTransferDigest } from "../../assets/shared/event-agenda-transfer";
import {
  publicationAuthoredAgendaRoutes,
  publicAgendaChildRoutes,
} from "../../assets/shared/publication-agenda-routes";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { readAuthoredAgendaSources } from "../../functions/_lib/services/site-authored-agenda-sources";
import { contentPathToRoute, parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import { nodePathForSource, type ContentDocument } from "../../functions/_lib/services/site-documents";
import { approvedEventAgendaForRoute } from "../../functions/_lib/services/site-published-event-agendas";
import { createSiteConferencePrograms } from "../../functions/_lib/services/site-conference-program-catalog";
import { collectSessionRedirects } from "../../scripts/publication/collect-session-redirects.mjs";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";

function authoredAgendaPageRoutes(
  documents: ContentDocument[],
  publication?: ReturnType<typeof sitePublicationSnapshotSchema.parse>,
) {
  return collectAuthoredAgendaPageRoutes(
    documents,
    (body) => body.includes("{{< agenda >}}") || body.includes("{{< agenda default="),
    publication,
  );
}

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
  it("leads both agenda addresses to the authored event page that embeds the agenda", () => {
    const snapshot = publication();
    const eventPage = "events/2023/original/index.html";
    expect(collectSessionRedirects(snapshot, [eventPage])).toEqual([
      { from: `${route}agenda/`, to: route, status: 301 },
      { from: agenda.publicAgendaPath, to: route, status: 301 },
    ]);
    expect(() => collectSessionRedirects(snapshot, [])).toThrow("target was not generated");
    expect(() => collectSessionRedirects(snapshot, [eventPage, targetFile])).toThrow("collides");
    expect(() => collectSessionRedirects(snapshot, [eventPage, "events/2023/original/agenda/index.html"])).toThrow(
      "collides",
    );
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

describe("bounded natural agenda child publication", () => {
  it("uses the actual 2026 agenda document and inherited authored dates, retaining its source page", async () => {
    const eventPath = "content/events/2026/pqc-conference-amsterdam-nl/_index.md";
    const agendaPath = "content/events/2026/pqc-conference-amsterdam-nl/agenda/_index.md";
    const event = document(eventPath, await readFile(eventPath, "utf8"));
    const source = document(agendaPath, await readFile(agendaPath, "utf8"));
    const children = authoredAgendaPageRoutes([event, source]);
    expect(children.map((child) => child.route)).toEqual([
      `${source.route}2026-12-01/`,
      `${source.route}2026-12-02/`,
      `${source.route}2026-12-03/`,
      `${source.route}speakers/`,
    ]);
    expect(children.every((child) => child.sourceRoute === source.route && child.agendaBasePath === source.route)).toBe(
      true,
    );
    expect(children.some((child) => child.route.includes("2026-12-04"))).toBe(false);
    expect(authoredAgendaPageRoutes([event, { ...source, data: { ...source.data, draft: true } }])).toEqual([]);
    expect(authoredAgendaPageRoutes([{ ...event, data: { ...event.data, draft: true } }, source])).toEqual([]);
  });

  it("uses approved public days for an embedded authored agenda, without inventing private or unknown children", () => {
    const source = document(
      owner.sourcePath,
      "---\ntitle: Original\ndata:\n  name: Original\n  timezone: UTC\n  agenda: {}\n---\n{{< agenda >}}\n",
    );
    const snapshot = publication();
    snapshot.eventAgendas![agenda.eventSlug]!.occurrences.push({
      ...agenda.occurrences[0]!,
      id: "private-day",
      visibility: "private",
      startAt: "2023-04-02T10:00:00.000Z",
      endAt: "2023-04-02T11:00:00.000Z",
    });
    expect(authoredAgendaPageRoutes([source], snapshot).map((child) => child.route)).toEqual([
      `${route}agenda/2023-04-01/`,
      `${route}agenda/speakers/`,
    ]);
    const children = publicAgendaChildRoutes(agenda.publicAgendaPath!, ["2023-04-01"]);
    expect(children.map((child) => child.route)).toEqual([
      `${agenda.publicAgendaPath}2023-04-01/`,
      `${agenda.publicAgendaPath}speakers/`,
    ]);
    expect(() => publicAgendaChildRoutes("/events/private/../agenda/", ["2023-04-01"])).toThrow();
    expect(() => publicAgendaChildRoutes(agenda.publicAgendaPath!, ["2023-02-30"])).toThrow();
    expect(() =>
      authoredAgendaPageRoutes(
        [source, { ...source, route: `${route}agenda/2023-04-01/`, body: "Already owned" }],
        publication(),
      ),
    ).toThrow("collides");
  });
});
