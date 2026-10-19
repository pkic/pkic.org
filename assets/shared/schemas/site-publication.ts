import { publicationAuthoredAgendaRoutesSchema } from "./site-publication-agenda-routes";
import { publicAgendaCalendarSchema } from "./site-agenda-calendar";
import { agendaSnapshotSchema } from "./event-agenda";
import { publicVoteSchema } from "./votes";
import { z } from "zod";
import { publicPageSlugSchema } from "./public-page-slug";
import { sitePublicationSnapshotIdSchema, sitePublicationSourceSequenceSchema } from "./site-publication-release";
import { publishedFormResourcesSchema } from "../published-resource-url";
import { publicMemberDetailSchema, publicMemberSummarySchema, memberWallEntrySchema } from "./members-directory";
import { groupDirectoryResponseSchema } from "./group-directory";
import { publicSponsorDisplayGroupSchema } from "./public-sponsors";
import { memberNewsArticleSchema } from "./member-news";
import { EVENT_FLOW_SUFFIXES, parseEventFlowPath, type EventFlowKind } from "../event-flow-paths";
import { sameOriginPathSchema } from "./urls";
import { publishedPersonSchema } from "./person-profile";

export const sitePublishedEventFlowSchema = z
  .object({
    eventName: z.string().min(1),
    flow: z.enum(Object.keys(EVENT_FLOW_SUFFIXES) as [EventFlowKind, ...EventFlowKind[]]),
    route: sameOriginPathSchema.refine(
      (path) => parseEventFlowPath(path) !== null,
      "Use a canonical event workflow path",
    ),
  })
  .refine((page) => parseEventFlowPath(page.route)?.flow === page.flow, "The route must match its workflow");

/** Only canonical public projections may cross the publication boundary. */
export const sitePublicationContentSchema = z.object({
  version: z.literal(1),
  eventAgendas: z.record(z.string(), agendaSnapshotSchema).optional(),
  authoredAgendaRoutes: publicationAuthoredAgendaRoutesSchema.optional(),
  eventAgendaCalendars: z.record(z.string(), publicAgendaCalendarSchema).optional(),
  /** Former speaker profile addresses, each leading to the same person's current address. */
  personProfileRedirects: z
    .array(z.object({ fromSlug: publicPageSlugSchema, toSlug: publicPageSlugSchema }))
    .optional(),
  /** Keyed by user ID: the public contributions of each person with a profile address. */
  people: z.record(z.string(), publishedPersonSchema).optional(),
  /** A merged organization's member page address, leading to the organization it was merged into. */
  memberPageRedirects: z.array(z.object({ fromSlug: z.string().min(1), toSlug: z.string().min(1) })).optional(),
  /** Former session page addresses, each leading to the same session's current page. */
  sessionPageRedirects: z
    .array(z.object({ eventSlug: z.string().min(1), occurrenceId: z.string().min(1), fromSlug: publicPageSlugSchema }))
    .optional(),
  votes: z.array(publicVoteSchema),
  publicResources: publishedFormResourcesSchema,
  eventFlows: z.array(sitePublishedEventFlowSchema).optional(),
  members: z.array(publicMemberDetailSchema),
  groups: z.record(z.string(), groupDirectoryResponseSchema),
  groupMembers: z.record(z.string(), z.array(publicMemberSummarySchema)),
  sponsors: z.record(z.string(), z.array(publicSponsorDisplayGroupSchema)),
  memberWall: z.array(memberWallEntrySchema),
  news: z.array(memberNewsArticleSchema),
  sponsorNews: z.array(memberNewsArticleSchema),
});
export const sitePublicationSnapshotSchema = sitePublicationContentSchema.extend({
  snapshotId: sitePublicationSnapshotIdSchema,
  sourceSequence: sitePublicationSourceSequenceSchema.nullable().default(null),
});
export type SitePublicationSnapshot = z.infer<typeof sitePublicationSnapshotSchema>;
