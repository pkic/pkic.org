import { resolveAuthoredAgendaRouteOwners } from "./site-publication-agenda-routes";
import { publicationAuthoredAgendaRoutes } from "../../../assets/shared/publication-agenda-routes";
import type { AuthoredAgendaSource } from "../../../assets/shared/schemas/site-publication-agenda-routes";
import { storedAgendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda-stored";
import { readPublicAgendaCalendars } from "./site-publication-agenda-calendars";
import { publicAgendaProjection } from "./event-agenda/public-projection";
import { projectLiveAgendaMaterialBatch } from "./site-agenda-material-eligibility";
import { listPublicVotes } from "./votes/public";
import { publicVotesListQuerySchema } from "../../../assets/shared/schemas/votes";
import { all, first } from "../db/queries";
import { createSitePublicationSnapshot } from "./site-publication-snapshot-identity";
export { createSitePublicationSnapshot } from "./site-publication-snapshot-identity";
import { readMemberNews, readSponsorNews } from "./member-news/read";
import { memberNewsQuerySchema } from "../../../assets/shared/schemas/member-news";
import type { DatabaseLike } from "../types";
import { readPublicMemberPublicationBatch, listPublicMembers } from "./membership/directory";
import { getPublicGroupDirectory } from "./groups/public-directory";
import { listMemberWall } from "./membership/member-wall";
import { listPublicSponsorDisplay } from "./public-sponsors";
import { getPublicMembershipApplicationForm } from "./membership/application-form";
import { listActiveSponsorshipTierNames } from "./sponsorship/tier-catalog";
import { publicSponsorTiersResponseSchema } from "../../../assets/shared/schemas/sponsors";
import { getEventBySlug } from "./events";
import { getEventRegistrationConfiguration } from "./events/registration-configuration";
import { resolveEventFrontendRoutes } from "./event-presentation";
import { parseEventFlowPath } from "../../../assets/shared/event-flow-paths";
import { z } from "zod";
import { membersListQuerySchema } from "../../../assets/shared/schemas/members-directory";
import {
  sitePublicationContentSchema,
  type SitePublicationSnapshot,
} from "../../../assets/shared/schemas/site-publication";
import { sponsorPublicationKey, sponsorPublicationQuery } from "../../../assets/shared/sponsor-publication-query";

async function publicationHighwater(db: DatabaseLike): Promise<number | null> {
  const tables = await first<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('site_publication_requests','site_publication_delivery_state')",
    [],
  );
  // Explicit pre-ledger extraction compatibility; remote assembly refuses
  // to treat a snapshot without a tracked highwater as proven publication.
  if (tables?.count === 0) return null;
  if (tables?.count !== 2) throw new Error("Site publication provenance schema is incomplete");
  const state = await first<{ sequence: number }>(
    db,
    "SELECT COALESCE((SELECT desired_sequence FROM site_publication_delivery_state WHERE id=1),(SELECT MAX(sequence) FROM site_publication_requests),0) AS sequence",
    [],
  );
  if (!state) throw new Error("Site publication highwater is unavailable");
  return state.sequence;
}

/** Export only approved, publicly visible projections through native D1 bindings. */
export async function readSitePublicationSnapshot(
  db: DatabaseLike,
  sponsorSelections: Array<Record<string, string | undefined>>,
  authoredEventSlugs: readonly string[] = [],
  authoredAgendaSources: readonly AuthoredAgendaSource[] = [],
): Promise<SitePublicationSnapshot> {
  const sourceSequence = await publicationHighwater(db);
  const snapshot: z.infer<typeof sitePublicationContentSchema> = {
    version: 1,
    votes: [],
    publicResources: {},
    eventFlows: [],
    members: [],
    groups: {},
    groupMembers: {},
    sponsors: {},
    memberWall: [],
    news: [],
    sponsorNews: [],
  };
  let voteOffset = 0;
  for (;;) {
    const page = await listPublicVotes(
      db,
      publicVotesListQuerySchema.parse({
        limit: 100,
        offset: voteOffset,
        sort: "closes_at",
        status: "open,scheduled,closed",
      }),
    );
    snapshot.votes.push(...page.votes);
    voteOffset += page.votes.length;
    if (voteOffset >= page.total) break;
    if (!page.votes.length) throw new Error("Public vote pagination stopped before completion");
  }
  let after = "";
  for (;;) {
    const members = await readPublicMemberPublicationBatch(db, after);
    if (!members.length) break;
    snapshot.members.push(...members);
    after = members[members.length - 1]!.id;
  }
  let groupAfter = "";
  for (;;) {
    const groups = await all<{ id: string; slug: string }>(
      db,
      `SELECT id, slug FROM groups WHERE active = 1 AND slug > ? AND (visibility = 'public' OR public_leadership = 1 OR public_roster = 1) ORDER BY slug LIMIT 20`,
      [groupAfter],
    );
    if (!groups.length) break;
    for (const group of groups) {
      snapshot.groups[group.slug] = await getPublicGroupDirectory(db, group.id);
      const members = [];
      let offset = 0;
      for (;;) {
        const page = await listPublicMembers(
          db,
          membersListQuerySchema.parse({
            group: "organization",
            workingGroup: group.slug,
            sort: "name",
            limit: 100,
            offset,
          }),
        );
        members.push(...page.members);
        offset += page.members.length;
        if (offset >= page.total) break;
        if (!page.members.length) throw new Error("Public group member pagination stopped before completion");
      }
      snapshot.groupMembers[group.slug] = members;
    }
    groupAfter = groups[groups.length - 1]!.slug;
  }
  for (const selection of sponsorSelections) {
    const key = sponsorPublicationKey(selection);
    if (snapshot.sponsors[key]) continue;
    const query = sponsorPublicationQuery(selection);
    const groups = new Map<number, Awaited<ReturnType<typeof listPublicSponsorDisplay>>["groups"][number]>();
    let offset = 0;
    for (;;) {
      const page = await listPublicSponsorDisplay(db, { ...query, offset });
      for (const group of page.groups) {
        const previous = groups.get(group.weight);
        if (previous) previous.sponsors.push(...group.sponsors);
        else groups.set(group.weight, group);
      }
      offset += page.groups.reduce((count, group) => count + group.sponsors.length, 0);
      if (!page.page.hasMore || selection.mode === "strip") break;
      if (!page.groups.length) throw new Error("Public sponsor pagination stopped before completion");
    }
    snapshot.sponsors[key] = [...groups.values()];
  }
  snapshot.memberWall = await listMemberWall(db, 200);
  let newsOffset = 0;
  for (;;) {
    const page = await readMemberNews(db, memberNewsQuerySchema.parse({ limit: 100, offset: newsOffset }));
    snapshot.news.push(...page.articles);
    if (!page.page.hasMore) break;
    if (!page.articles.length) throw new Error("Public news pagination stopped before completion");
    newsOffset += page.articles.length;
  }
  snapshot.sponsorNews = await readSponsorNews(db);
  snapshot.publicResources["/api/v1/members/applications/form"] = z
    .json()
    .parse(await getPublicMembershipApplicationForm(db));
  for (const sponsorType of ["consortium", "event"] as const) {
    snapshot.publicResources[`/api/v1/sponsors/tiers?sponsorType=${sponsorType}`] = z.json().parse(
      publicSponsorTiersResponseSchema.parse({
        visibility: "public",
        sponsorType,
        tiers: (await listActiveSponsorshipTierNames(db, sponsorType)).map((tier) => ({ tier })),
      }),
    );
  }
  async function publishEventForms(slug: string) {
    const key = `/api/v1/events/${encodeURIComponent(slug)}/forms/placements/`;
    if (`${key}event_registration` in snapshot.publicResources) return;
    const event = await getEventBySlug(db, slug);
    if (event.visibility === "public") {
      for (const route of Object.values(resolveEventFrontendRoutes(event))) {
        if (typeof route !== "string") continue;
        const parsed = parseEventFlowPath(route);
        if (parsed?.eventSlug === event.slug)
          snapshot.eventFlows!.push({ eventName: event.name, flow: parsed.flow, route });
      }
    }
    for (const purpose of ["event_registration", "proposal_submission"] as const)
      snapshot.publicResources[`${key}${purpose}`] = z
        .json()
        .parse(JSON.parse(JSON.stringify(await getEventRegistrationConfiguration(db, event, purpose))));
  }
  // Legacy event visibility defaults predate authored public registration pages.
  // Only published content may nominate legacy events; private portal events
  // remain excluded even if an authored slug accidentally matches them.
  const authored = [...new Set(authoredEventSlugs)];
  for (let offset = 0; offset < authored.length; offset += 20) {
    const slugs = authored.slice(offset, offset + 20);
    const events = await all<{ slug: string }>(
      db,
      `SELECT slug FROM events WHERE COALESCE(source_mode, 'hugo') = 'hugo' AND slug IN (${slugs.map(() => "?").join(", ")}) ORDER BY slug`,
      slugs,
    );
    for (const event of events) await publishEventForms(event.slug);
  }
  let eventAfter = "";
  for (;;) {
    const events = await all<{ slug: string }>(
      db,
      "SELECT slug FROM events WHERE slug > ? AND visibility = 'public' ORDER BY slug LIMIT 20",
      [eventAfter],
    );
    if (!events.length) break;
    for (const row of events) await publishEventForms(row.slug);
    eventAfter = events[events.length - 1]!.slug;
  }
  snapshot.eventAgendas = {};
  snapshot.authoredAgendaRoutes = [];
  const agendaTables = await all<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('event_agenda_publications','event_agenda_state')",
  );
  // Preview builds may run against the baseline database before additive migration 0038.
  // Only the entirely absent feature schema falls back; partial migrations and query failures remain fatal.
  if (!agendaTables.length) return createSitePublicationSnapshot(snapshot);
  if (agendaTables.length !== 2) throw new Error("Event agenda publication schema is incomplete; apply migration 0038");
  let agendaAfter = "";
  for (;;) {
    const agendas = await all<{ event_id: string; slug: string; base_path: string | null; snapshot_json: string }>(
      db,
      `SELECT e.id AS event_id,e.slug, e.base_path, p.snapshot_json FROM event_agenda_publications p
       JOIN event_agenda_state s ON s.event_id = p.event_id AND s.published_revision = p.revision
       JOIN events e ON e.id = p.event_id WHERE e.visibility = 'public' AND e.slug > ? ORDER BY e.slug LIMIT 100`,
      [agendaAfter],
    );
    if (!agendas.length) break;
    const projected = await projectLiveAgendaMaterialBatch(
      db,
      agendas.map((row) => ({
        eventId: row.event_id,
        snapshot: storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      })),
    );
    for (const [index, row] of agendas.entries()) {
      const approved = projected[index]!;
      const publicAgenda = publicAgendaProjection(approved, row.base_path);
      snapshot.eventAgendas[row.slug] = publicAgenda;
      snapshot.authoredAgendaRoutes.push(
        ...(await resolveAuthoredAgendaRouteOwners(db, row.event_id, approved, authoredAgendaSources)),
      );
    }
    agendaAfter = agendas[agendas.length - 1]!.slug;
  }
  snapshot.authoredAgendaRoutes = publicationAuthoredAgendaRoutes(snapshot);
  snapshot.eventAgendaCalendars = await readPublicAgendaCalendars(db, new Date().toISOString());
  if ((await publicationHighwater(db)) !== sourceSequence)
    throw new Error("Site publication source changed during extraction; rebuild from the newest requested state");
  return createSitePublicationSnapshot(snapshot, sourceSequence);
}
