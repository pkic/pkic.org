import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import {
  nextPublicPageSlug,
  personProfileSlugBase,
  publicPageSlugSchema,
} from "../../assets/shared/schemas/public-page-slug";
import { planSessionPageSlugs } from "../../functions/_lib/services/event-agenda/session-page-slugs";
import {
  planPersonProfileSlugs,
  type PersonProfileSlugRow,
} from "../../functions/_lib/services/people/profile-addresses";
import {
  personProfileRedirects,
  publishedPersonPages,
  publishedSessionHistory,
  publishedSpeakerHistory,
  sessionPageRedirects,
} from "../../functions/_lib/services/site-session-history";
import type { PublishedPerson } from "../../assets/shared/schemas/person-profile";
import {
  sessionHistoryStructuredData,
  personProfileStructuredData,
} from "../../functions/_lib/services/site-history-structured-data";
import { publishedPersonProfile } from "../../functions/_lib/services/site-person-profile";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/site-publication.json", import.meta.url), "utf8"));
const approvedAt = "2026-10-01T00:00:00.000Z";
const appearance = (userId: string, displayName: string) => ({
  userId,
  affiliations: [
    { identityId: null, title: "Engineer", organizationId: null, organizationName: "Example organization" },
  ],
  displayName,
  biography: "Approved biography",
  photoUrl: null,
  approvedAt,
});
const session = (id: string, userId: string, patch: Record<string, unknown> = {}) => ({
  id,
  title: `Session ${id}`,
  description: "A substantial approved abstract describing this conference session in detail.",
  startAt: "2026-12-01T09:00:00.000Z",
  endAt: "2026-12-01T10:00:00.000Z",
  roomId: null,
  speakers: [{ userId, displayName: `Roster ${userId}` }],
  history: { appearances: [appearance(userId, `Speaker ${userId}`)] },
  ...patch,
});
const agenda = (eventSlug: string, patch: Partial<AgendaSnapshot>, occurrences: unknown[]) =>
  agendaSnapshotSchema.parse({
    eventSlug,
    eventName: eventSlug,
    timeZone: "Europe/Amsterdam",
    revision: 2,
    publishedRevision: 2,
    approvedAt,
    publicPages: true,
    rooms: [],
    shifts: [],
    roleMembers: [],
    assignments: [],
    occurrences,
    ...patch,
  });

/** Every agenda shape a portal or the site may present, published or not. */
const agendas = {
  published: agenda("published", { speakerProfileSlugs: { a: "speaker-a", b: "speaker-b", c: "speaker-c" } }, [
    session("public", "a"),
    session("private", "b", { visibility: "private" }),
    session("thin", "c", { description: "Brief" }),
    session("roster-only", "c", { history: { appearances: [] } }),
  ]),
  portalOnly: agenda("portal-only", { publicPages: false, speakerProfileSlugs: { d: "speaker-d" } }, [
    session("public", "d"),
  ]),
  draft: agenda("draft", { revision: 3, speakerProfileSlugs: { e: "speaker-e" } }, [session("public", "e")]),
  unaddressed: agenda("unaddressed", {}, [session("public", "f")]),
};
const publication = sitePublicationSnapshotSchema.parse({ ...fixture, eventAgendas: agendas });

function agendaLinks(snapshot: AgendaSnapshot) {
  const content = agendaContent(snapshot);
  return content.days.flatMap((day) =>
    day.slots.flatMap((slot) =>
      slot.sessions.flatMap((item) => [
        ...(item.sessionUrl ? [item.sessionUrl] : []),
        ...item.speakers.flatMap((speaker) => (speaker.personPath ? [speaker.personPath] : [])),
      ]),
    ),
  );
}
function graphUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(graphUrls);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "url" && typeof entry === "string" ? [new URL(entry).pathname] : graphUrls(entry),
  );
}

describe("one public page rule", () => {
  const sessions = publishedSessionHistory(publication);
  const people = publishedSpeakerHistory(publication);
  const pages = new Set([...sessions.map((item) => item.route), ...people.map((person) => person.route)]);

  it("renders pages only for public sessions of approved public-event revisions and people with an approved appearance", () => {
    expect(sessions.map((item) => item.route)).toEqual([
      "/events/published/sessions/public/",
      "/events/published/sessions/roster-only/",
      "/events/unaddressed/sessions/public/",
    ]);
    expect(people.map((person) => person.route)).toEqual(["/people/speaker-a/"]);
  });

  it("never links an agenda, session page or structured-data graph to a page the build does not render", () => {
    const links = [
      ...Object.values(agendas).flatMap(agendaLinks),
      ...sessions.flatMap((item) => item.credits.flatMap((credit) => (credit.personPath ? [credit.personPath] : []))),
      ...graphUrls(sessions.map((item) => sessionHistoryStructuredData(publication, item, "https://pkic.org"))),
      ...graphUrls(
        people.map((person) =>
          personProfileStructuredData(
            publication,
            person,
            publishedPersonProfile(publication, person),
            "https://pkic.org",
          ),
        ),
      ),
    ].filter((link) => link.startsWith("/people/") || link.includes("/sessions/"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(pages, link).toContain(link);
    // And every rendered page is reachable from an agenda.
    for (const page of pages) expect(links).toContain(page);
  });
});

describe("person pages beyond the agenda", () => {
  const person = (slug: string | null, patch: Partial<PublishedPerson> = {}): PublishedPerson => ({
    name: `Person ${slug ?? "unaddressed"}`,
    slug,
    identities: [],
    groups: [],
    candidacies: [],
    ...patch,
  });
  const seat = { groupSlug: "pqc", groupName: "PQC", title: "Member", leadership: false, startsAt: null, endsAt: null };
  const identity = (visibility: PublishedPerson["identities"][number]["visibility"]) => ({
    id: `identity-${visibility}`,
    title: "Chair",
    organizationId: null,
    organizationName: null,
    organizationLogoUrl: null,
    startedAt: null,
    endedAt: null,
    biography: "",
    links: [],
    visibility,
  });
  const withPeople = sitePublicationSnapshotSchema.parse({
    ...fixture,
    eventAgendas: agendas,
    votes: [],
    people: {
      a: person("speaker-a"),
      seat: person("seat-holder", {
        groups: [seat],
        identities: [{ ...identity("public"), startedAt: approvedAt, endedAt: "2026-11-01T00:00:00.000Z" }],
      }),
      shown: person("shown-person", { identities: [identity("public")] }),
      hidden: person("hidden-person", { identities: [identity("hidden")] }),
      candidate: person("candidate", {
        candidacies: [{ voteSlug: "unpublished", voteTitle: "Election", ownerGroupName: "", closesAt: approvedAt }],
      }),
      unaddressed: person(null, { groups: [seat] }),
    },
    personProfileRedirects: [
      { fromSlug: "former-seat", toSlug: "seat-holder" },
      { fromSlug: "former-hidden", toSlug: "hidden-person" },
    ],
  });
  const pages = publishedPersonPages(withPeople);

  it("renders a page for an addressed person with a public contribution, never for an identity alone", () => {
    expect(pages.map((page) => page.route)).toEqual(["/people/seat-holder/", "/people/speaker-a/"]);
    const seatPage = pages.find((page) => page.userId === "seat")!;
    const profile = publishedPersonProfile(withPeople, seatPage);
    expect(profile).toMatchObject({ name: "Person seat-holder", route: "/people/seat-holder/", events: [] });
    // An ended identity still shows, as past.
    expect(profile.identities.map((item) => item.endedAt)).toEqual(["2026-11-01T00:00:00.000Z"]);
    expect(
      personProfileStructuredData(withPeople, seatPage, profile, "https://pkic.org").mainEntity,
    ).not.toHaveProperty("performerIn");
  });

  it("redirects a former address only to a page the build renders", () => {
    expect(personProfileRedirects(withPeople)).toEqual([
      { from: "/people/former-seat/", to: "/people/seat-holder/", status: 301 },
    ]);
  });
});

describe("person profile addresses", () => {
  const person = (userId: string, displayName: string, at = "2026-10-05T00:00:00.000Z") => ({
    userId,
    displayName,
    approvedAt: at,
  });
  const row = (slug: string, userId: string, retiredAt: string | null = null): PersonProfileSlugRow => ({
    slug,
    userId,
    createdAt: "2026-10-02T00:00:00.000Z",
    retiredAt,
  });

  it("derives readable ASCII addresses with collision suffixes", () => {
    expect(personProfileSlugBase("Zoë Ångström-Ødegaard")).toBe("zoe-angstrom-odegaard");
    expect(personProfileSlugBase("Dr. Max Müller (PhD)")).toBe("dr-max-muller-phd");
    expect(personProfileSlugBase("李明")).toBe("person");
    expect(publicPageSlugSchema.parse(personProfileSlugBase("x".repeat(300)))).toHaveLength(76);
    expect(nextPublicPageSlug("jane-doe", new Set(["jane-doe", "jane-doe-2"]))).toBe("jane-doe-3");
  });

  it("mints once, keeps an address through older approvals, and moves only for a later approved name", () => {
    expect(planPersonProfileSlugs([person("a", "Jane Doe"), person("b", "Jane Doe")], [], new Set())).toEqual([
      { kind: "mint", userId: "a", slug: "jane-doe" },
      { kind: "mint", userId: "b", slug: "jane-doe-2" },
    ]);
    const rows = [row("jane-doe", "a")];
    expect(planPersonProfileSlugs([person("a", "Jane Doe")], rows, new Set(["jane-doe"]))).toEqual([]);
    expect(planPersonProfileSlugs([person("a", "Jane Smith", "2026-10-01T00:00:00.000Z")], rows, new Set())).toEqual(
      [],
    );
    expect(planPersonProfileSlugs([person("a", "Jane Smith")], rows, new Set(["jane-doe"]))).toEqual([
      { kind: "retire", userId: "a", slug: "jane-doe" },
      { kind: "mint", userId: "a", slug: "jane-smith" },
    ]);
    expect(
      planPersonProfileSlugs(
        [person("a", "Jane Doe")],
        [row("jane-doe", "a", "2026-10-03T00:00:00.000Z"), row("jane-smith", "a")],
        new Set(["jane-doe", "jane-smith"]),
      ),
    ).toEqual([
      { kind: "retire", userId: "a", slug: "jane-smith" },
      { kind: "restore", userId: "a", slug: "jane-doe" },
    ]);
  });
});

describe("session page addresses", () => {
  const titled = (occurrenceId: string, title: string) => ({ occurrenceId, title });

  it("keeps an address while the approved title yields it, and moves or restores it when the title changes", () => {
    expect(planSessionPageSlugs([titled("a", "PQC: Lessons"), titled("b", "PQC — lessons!")], [], new Set())).toEqual([
      { kind: "mint", occurrenceId: "a", slug: "pqc-lessons" },
      { kind: "mint", occurrenceId: "b", slug: "pqc-lessons-2" },
    ]);
    const current = { slug: "pqc-lessons", occurrenceId: "a", retiredAt: null };
    expect(planSessionPageSlugs([titled("a", "PQC lessons")], [current], new Set(["pqc-lessons"]))).toEqual([]);
    expect(planSessionPageSlugs([titled("a", "Hybrid certificates")], [current], new Set(["pqc-lessons"]))).toEqual([
      { kind: "retire", occurrenceId: "a", slug: "pqc-lessons" },
      { kind: "mint", occurrenceId: "a", slug: "hybrid-certificates" },
    ]);
    const retired = { ...current, retiredAt: "2026-10-02T00:00:00.000Z" };
    const renamed = { slug: "hybrid-certificates", occurrenceId: "a", retiredAt: null };
    expect(
      planSessionPageSlugs(
        [titled("a", "PQC lessons")],
        [retired, renamed],
        new Set(["pqc-lessons", "hybrid-certificates"]),
      ),
    ).toEqual([
      { kind: "retire", occurrenceId: "a", slug: "hybrid-certificates" },
      { kind: "restore", occurrenceId: "a", slug: "pqc-lessons" },
    ]);
    // Another session never receives a retired address.
    expect(planSessionPageSlugs([titled("c", "PQC lessons")], [retired], new Set(["pqc-lessons"]))).toEqual([
      { kind: "mint", occurrenceId: "c", slug: "pqc-lessons-2" },
    ]);
  });

  it("links and renders the readable address and redirects the ID and former addresses to it", () => {
    const addressed = sitePublicationSnapshotSchema.parse({
      ...fixture,
      eventAgendas: {
        published: { ...agendas.published, sessionSlugs: { public: "session-public" } },
      },
      sessionPageRedirects: [{ eventSlug: "published", occurrenceId: "public", fromSlug: "old-title" }],
    });
    const routes = publishedSessionHistory(addressed).map((item) => item.route);
    expect(routes).toContain("/events/published/sessions/session-public/");
    expect(agendaLinks(addressed.eventAgendas!.published!)).toContain("/events/published/sessions/session-public/");
    expect(sessionPageRedirects(addressed)).toEqual(
      expect.arrayContaining([
        { from: "/events/published/sessions/public/", to: "/events/published/sessions/session-public/", status: 301 },
        {
          from: "/events/published/sessions/old-title/",
          to: "/events/published/sessions/session-public/",
          status: 301,
        },
      ]),
    );
    for (const redirect of sessionPageRedirects(addressed)) expect(routes).toContain(redirect.to);
  });
});
