import { publicVoteSchema } from "./votes";
import { z } from "zod";
import { sitePublicationSnapshotIdSchema } from "./site-publication-release";
import { publishedFormResourcesSchema } from "../published-resource-url";
import { publicMemberDetailSchema, publicMemberSummarySchema, memberWallEntrySchema } from "./members-directory";
import { groupDirectoryResponseSchema } from "./group-directory";
import { publicSponsorDisplayGroupSchema } from "./public-sponsors";
import { memberNewsArticleSchema } from "./member-news";
import { EVENT_FLOW_SUFFIXES, parseEventFlowPath, type EventFlowKind } from "../event-flow-paths";
import { sameOriginPathSchema } from "./urls";

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
});
export type SitePublicationSnapshot = z.infer<typeof sitePublicationSnapshotSchema>;
