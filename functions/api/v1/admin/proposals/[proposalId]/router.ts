import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../_lib/http";
import { getCachedAdminForRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { proposalPermissionForRequest } from "../../../../../_lib/auth/proposal-route-policy";
import { first } from "../../../../../_lib/db/queries";
import { requestDb } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminProposalAuditLogRouteSchema,
  adminProposalCommentCreateRouteSchema,
  adminProposalCommentsListRouteSchema,
  adminProposalFinalizePreviewRouteSchema,
  adminProposalFinalizeRouteSchema,
  adminProposalFlagRouteSchema,
  adminProposalOpenManageRouteSchema,
  adminProposalPatchRouteSchema,
  adminProposalReviewsListRouteSchema,
  adminProposalReviewUpsertRouteSchema,
  adminProposalSpeakersRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { AdminProposalsProposalIdGet } from "./index";
import { onRequestPost as AdminProposalsProposalIdOpenManagePost_l } from "./open-manage";
import { onRequestPost as AdminProposalsProposalIdFlagPost_l } from "./flag";
import { onRequestPatch as AdminProposalsProposalIdPatch_l } from "./patch";
import { onRequestPost as AdminProposalsProposalIdFinalizePost_l } from "./finalize";
import { onRequestPost as AdminProposalsProposalIdFinalizePreviewPost_l } from "./finalize-preview";
import { onRequestGet as AdminProposalsProposalIdAuditLogGet_l } from "./audit-log";
import {
  onRequestGet as AdminProposalsProposalIdCommentsGet_l,
  onRequestPost as AdminProposalsProposalIdCommentsPost_l,
} from "./comments";
import {
  onRequestGet as AdminProposalsProposalIdReviewsGet_l,
  onRequestPost as AdminProposalsProposalIdReviewsPost_l,
} from "./reviews";
import { onRequestGet as AdminProposalsProposalIdSpeakersGet_l } from "./speakers";
import { onRequestPost as AdminProposalsProposalIdRemindSpeakersPost_l } from "./remind-speakers";
import { onRequestPost as AdminProposalsProposalIdRemindPresentationPost_l } from "./remind-presentation";
import reviews_Router from "./reviews/router";
import speakers_Router from "./speakers/router";
import presentation_Router from "./presentation/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

/**
 * Floor gate for the whole /admin/proposals/:proposalId/** subtree
 * (detail, audit log, comments, reviews, speakers, presentation uploads/
 * downloads, reminder emails) — requires at least proposals:read, globally
 * or scoped to the proposal's event, matching the same permission
 * events/[eventSlug]/proposals.ts already requires to list an event's
 * proposals. Several handlers in this subtree (audit-log.ts,
 * remind-speakers.ts, remind-presentation.ts, speakers/[userId]/remind*.ts,
 * presentation/versions/**) previously had no permission check at all
 * beyond bare authentication (requireAdminFromRequest), so any
 * authenticated staff-portal actor — including one with zero role/grants —
 * could read or act on any event's proposals. Handlers that need a
 * stricter bar (patch.ts/finalize.ts's canFinalize, comments.ts/
 * reviews.ts's canReview via getProposalAccessForEvent) keep their own
 * additional check on top; canFinalize/canReview are always a subset of
 * proposals:read for every seeded role, so this floor doesn't change
 * behavior for any caller who was already able to reach those checks.
 */
async function requireProposalAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing authenticated admin");
  }

  const proposalId = c.req.param("proposalId") ?? "";
  const proposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  requirePermission(admin, proposalPermissionForRequest(c.req.path, c.req.method), {
    type: "event",
    id: proposal.event_id,
  });

  await next();
}

app.use("*", requireProposalAccess);

const AdminProposalsProposalIdOpenManagePost = openApiRoute(
  adminProposalOpenManageRouteSchema,
  AdminProposalsProposalIdOpenManagePost_l,
);
const AdminProposalsProposalIdPatch = openApiRoute(adminProposalPatchRouteSchema, AdminProposalsProposalIdPatch_l);
const AdminProposalsProposalIdFlagPost = openApiRoute(adminProposalFlagRouteSchema, AdminProposalsProposalIdFlagPost_l);
const AdminProposalsProposalIdFinalizePost = openApiRoute(
  adminProposalFinalizeRouteSchema,
  AdminProposalsProposalIdFinalizePost_l,
);
const AdminProposalsProposalIdFinalizePreviewPost = openApiRoute(
  adminProposalFinalizePreviewRouteSchema,
  AdminProposalsProposalIdFinalizePreviewPost_l,
);
const AdminProposalsProposalIdAuditLogGet = openApiRoute(
  adminProposalAuditLogRouteSchema,
  AdminProposalsProposalIdAuditLogGet_l,
);
const AdminProposalsProposalIdCommentsGet = openApiRoute(
  adminProposalCommentsListRouteSchema,
  AdminProposalsProposalIdCommentsGet_l,
);
const AdminProposalsProposalIdCommentsPost = openApiRoute(
  adminProposalCommentCreateRouteSchema,
  AdminProposalsProposalIdCommentsPost_l,
);
const AdminProposalsProposalIdSpeakersGet = openApiRoute(
  adminProposalSpeakersRouteSchema,
  AdminProposalsProposalIdSpeakersGet_l,
);
const AdminProposalsProposalIdReviewsGet = openApiRoute(
  adminProposalReviewsListRouteSchema,
  AdminProposalsProposalIdReviewsGet_l,
);
const AdminProposalsProposalIdReviewsPost = openApiRoute(
  adminProposalReviewUpsertRouteSchema,
  AdminProposalsProposalIdReviewsPost_l,
);

openapi.get("/", AdminProposalsProposalIdGet);
openapi.post("/open-manage", AdminProposalsProposalIdOpenManagePost);
openapi.post("/flag", AdminProposalsProposalIdFlagPost);
openapi.patch("/", AdminProposalsProposalIdPatch);
openapi.post("/finalize", AdminProposalsProposalIdFinalizePost);
openapi.post("/finalize-preview", AdminProposalsProposalIdFinalizePreviewPost);
openapi.get("/audit-log", AdminProposalsProposalIdAuditLogGet);
openapi.get("/comments", AdminProposalsProposalIdCommentsGet);
openapi.post("/comments", AdminProposalsProposalIdCommentsPost);
openapi.get("/reviews", AdminProposalsProposalIdReviewsGet);
openapi.post("/reviews", AdminProposalsProposalIdReviewsPost);
openapi.get("/speakers", AdminProposalsProposalIdSpeakersGet);
openapi.post("/remind-speakers", AdminProposalsProposalIdRemindSpeakersPost_l);
openapi.post("/remind-presentation", AdminProposalsProposalIdRemindPresentationPost_l);
openapi.route("/reviews", reviews_Router);
openapi.route("/speakers", speakers_Router);
openapi.route("/presentation", presentation_Router);

export default openapi;
