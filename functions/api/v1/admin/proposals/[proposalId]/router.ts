import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminProposalAuditLogRouteSchema,
  adminProposalCommentsRouteSchema,
  adminProposalFinalizePreviewRouteSchema,
  adminProposalFinalizeRouteSchema,
  adminProposalOpenManageRouteSchema,
  adminProposalPatchRouteSchema,
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
import { AdminProposalsProposalIdReviewsGet, AdminProposalsProposalIdReviewsPost } from "./reviews";
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

const AdminProposalsProposalIdOpenManagePost = openApiRoute(
  adminProposalOpenManageRouteSchema,
  AdminProposalsProposalIdOpenManagePost_l,
);
const AdminProposalsProposalIdPatch = openApiRoute(adminProposalPatchRouteSchema, AdminProposalsProposalIdPatch_l);
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
  adminProposalCommentsRouteSchema,
  AdminProposalsProposalIdCommentsGet_l,
);
const AdminProposalsProposalIdCommentsPost = openApiRoute(
  adminProposalCommentsRouteSchema,
  AdminProposalsProposalIdCommentsPost_l,
);
const AdminProposalsProposalIdSpeakersGet = openApiRoute(
  adminProposalSpeakersRouteSchema,
  AdminProposalsProposalIdSpeakersGet_l,
);

openapi.get("/", AdminProposalsProposalIdGet);
openapi.post("/open-manage", AdminProposalsProposalIdOpenManagePost);
openapi.post("/flag", AdminProposalsProposalIdFlagPost_l);
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
