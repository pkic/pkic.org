import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../_lib/http";
import { getCachedAdminForRequest } from "../../../../_lib/auth/admin";
import { requireAnyPermission } from "../../../../_lib/auth/permissions";
import {
  getProposalEventScope,
  proposalPermissionAlternativesForRequest,
} from "../../../../_lib/auth/proposal-route-policy";
import { requestDb } from "../../../../_lib/db/context";
import { createRequestScopedD1SessionMiddleware } from "../../../../_lib/db/request-session-middleware";
import { AppError } from "../../../../_lib/errors";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  proposalAccessLinkRouteSchema,
  proposalAuditLogRouteSchema,
  proposalCancellationRouteSchema,
  proposalCommentCreateRouteSchema,
  proposalCommentsListRouteSchema,
  proposalDecisionPreviewRouteSchema,
  proposalDecisionRouteSchema,
  proposalModerationRouteSchema,
  proposalPatchRouteSchema,
  proposalSpeakerInviteRouteSchema,
  proposalReviewsListRouteSchema,
  proposalReviewUpsertRouteSchema,
  proposalSpeakersReminderRouteSchema,
  proposalSpeakersRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts";
import { ProposalGet } from "./index";
import { onRequestPost as issueProposalAccessLink } from "./open-manage";
import { onRequestPost as moderateProposal } from "./flag";
import { onRequestPatch as patchProposal } from "./patch";
import { onRequestPost as cancelProposal } from "./cancel";
import { onRequestPost as decideProposal } from "./finalize";
import { onRequestPost as previewProposalDecision } from "./finalize-preview";
import { onRequestGet as listProposalAuditLog } from "./audit-log";
import { onRequestGet as listProposalComments, onRequestPost as createProposalComment } from "./comments";
import { onRequestGet as listProposalReviews, onRequestPost as upsertProposalReview } from "./reviews";
import { onRequestGet as listProposalSpeakers, onRequestPost as inviteProposalSpeaker } from "./speakers";
import { sendProposalReminder } from "../../../../_lib/routes/proposal-reminders";
import reviews_Router from "./reviews/router";
import speakers_Router from "./speakers/router";
import presentation_Router from "./presentation/router";
import type { AdminContext, RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

/**
 * Contextual gate for the canonical /proposals/:proposalId/** resource.
 * Detail reads require proposals:read; audit, comments, and reviews require
 * proposals:score because their payloads can contain private reviewer notes;
 * other writes require proposals:manage. The proposal PATCH route also admits
 * the narrow proposals:edit_accepted_abstract capability; its service selects
 * the exact required capability from the proposal status and validated body.
 * Permissions may be global or scoped to the proposal's event, matching the
 * permission required to list that event's proposals. Handlers that need a
 * stricter bar keep their own domain check on top of this shared resource
 * boundary.
 */
async function requireProposalAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const actor = getCachedAdminForRequest(c.req.raw);
  if (!actor) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing authenticated user");
  }

  const proposalId = c.req.param("proposalId") ?? "";
  const eventId = await getProposalEventScope(requestDb(c), proposalId);

  requireAnyPermission(actor, proposalPermissionAlternativesForRequest(c.req.path, c.req.method), {
    type: "event",
    id: eventId,
  });

  await next();
}

app.use("*", createRequestScopedD1SessionMiddleware());
app.use("*", requireProposalAccess);

const ProposalAccessLinkPost = openApiRoute(proposalAccessLinkRouteSchema, issueProposalAccessLink);
const ProposalPatch = openApiRoute(proposalPatchRouteSchema, patchProposal);
const ProposalCancellationPost = openApiRoute(proposalCancellationRouteSchema, cancelProposal);
const ProposalModerationPost = openApiRoute(proposalModerationRouteSchema, moderateProposal);
const ProposalDecisionPost = openApiRoute(proposalDecisionRouteSchema, decideProposal);
const ProposalDecisionPreviewPost = openApiRoute(proposalDecisionPreviewRouteSchema, previewProposalDecision);
const ProposalAuditLogGet = openApiRoute(proposalAuditLogRouteSchema, listProposalAuditLog);
const ProposalCommentsGet = openApiRoute(proposalCommentsListRouteSchema, listProposalComments);
const ProposalCommentsPost = openApiRoute(proposalCommentCreateRouteSchema, createProposalComment);
const ProposalSpeakersGet = openApiRoute(proposalSpeakersRouteSchema, listProposalSpeakers);
const ProposalSpeakerInvitePost = openApiRoute(proposalSpeakerInviteRouteSchema, inviteProposalSpeaker);
const ProposalReviewsGet = openApiRoute(proposalReviewsListRouteSchema, listProposalReviews);
const ProposalReviewsPost = openApiRoute(proposalReviewUpsertRouteSchema, upsertProposalReview);
const ProposalSpeakersReminderPost = openApiRoute(proposalSpeakersReminderRouteSchema, async (c: AdminContext, data) =>
  sendProposalReminder(c, data.body.kind, undefined, data.params.proposalId),
);

openapi.get("/", ProposalGet);
openapi.post("/access-links", ProposalAccessLinkPost);
openapi.post("/moderations", ProposalModerationPost);
openapi.patch("/", ProposalPatch);
openapi.post("/cancellations", ProposalCancellationPost);
openapi.post("/decisions", ProposalDecisionPost);
openapi.post("/decisions/previews", ProposalDecisionPreviewPost);
openapi.get("/audit-log", ProposalAuditLogGet);
openapi.get("/comments", ProposalCommentsGet);
openapi.post("/comments", ProposalCommentsPost);
openapi.get("/reviews", ProposalReviewsGet);
openapi.post("/reviews", ProposalReviewsPost);
openapi.get("/speakers", ProposalSpeakersGet);
openapi.post("/speakers", ProposalSpeakerInvitePost);
openapi.post("/speakers/reminders", ProposalSpeakersReminderPost);
openapi.route("/reviews", reviews_Router);
openapi.route("/speakers", speakers_Router);
openapi.route("/presentations", presentation_Router);

export default openapi;
