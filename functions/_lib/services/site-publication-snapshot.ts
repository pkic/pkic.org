import { listPublicVotes } from "./votes/public";
import { publicVotesListQuerySchema } from "../../../assets/shared/schemas/votes";
import { all } from "../db/queries";
import { sha256Hex } from "../utils/crypto";
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
  sitePublicationSnapshotSchema,
  sitePublicationContentSchema,
  type SitePublicationSnapshot,
} from "../../../assets/shared/schemas/site-publication";
import { sponsorPublicationKey, sponsorPublicationQuery } from "../../../assets/shared/sponsor-publication-query";

/** Identify the validated public content, excluding operational timestamps and private source keys. */
export async function createSitePublicationSnapshot(value: unknown): Promise<SitePublicationSnapshot> {
  const content = sitePublicationContentSchema.parse(value);
  return sitePublicationSnapshotSchema.parse({ ...content, snapshotId: await sha256Hex(JSON.stringify(content)) });
}

/** Export only approved, publicly visible projections through native D1 bindings. */
export async function readSitePublicationSnapshot(
  db: DatabaseLike,
  sponsorSelections: Array<Record<string, string | undefined>>,
  authoredEventSlugs: readonly string[] = [],
): Promise<SitePublicationSnapshot> {
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
  snapshot.publicResources["/api/v1/sponsors/tiers?sponsorType=consortium"] = z.json().parse(
    publicSponsorTiersResponseSchema.parse({
      visibility: "public",
      sponsorType: "consortium",
      tiers: (await listActiveSponsorshipTierNames(db, "consortium")).map((tier) => ({ tier })),
    }),
  );
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
  return createSitePublicationSnapshot(snapshot);
}
