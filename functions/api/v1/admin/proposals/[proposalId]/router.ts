import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminProposalsProposalIdGet_l } from "./index";
import { onRequestPost as AdminProposalsProposalIdOpenManagePost_l } from "./open-manage";
import { onRequestPatch as AdminProposalsProposalIdPatch_l } from "./patch";
import { onRequestPost as AdminProposalsProposalIdFinalizePost_l } from "./finalize";
import { onRequestPost as AdminProposalsProposalIdFinalizePreviewPost_l } from "./finalize-preview";
import { onRequestGet as AdminProposalsProposalIdAuditLogGet_l } from "./audit-log";
import { onRequestGet as AdminProposalsProposalIdReviewsGet_l } from "./reviews";
import { onRequestPost as AdminProposalsProposalIdReviewsPost_l } from "./reviews";
import { onRequestGet as AdminProposalsProposalIdSpeakersGet_l } from "./speakers";
import reviews_Router from "./reviews/router";
import speakers_Router from "./speakers/router";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/", AdminProposalsProposalIdGet_l);
app.post("/open-manage", AdminProposalsProposalIdOpenManagePost_l);
app.patch("/", AdminProposalsProposalIdPatch_l);
app.post("/finalize", AdminProposalsProposalIdFinalizePost_l);
app.post("/finalize-preview", AdminProposalsProposalIdFinalizePreviewPost_l);
app.get("/audit-log", AdminProposalsProposalIdAuditLogGet_l);
app.get("/reviews", AdminProposalsProposalIdReviewsGet_l);
app.post("/reviews", AdminProposalsProposalIdReviewsPost_l);
app.get("/speakers", AdminProposalsProposalIdSpeakersGet_l);
app.route("/reviews", reviews_Router);
app.route("/speakers", speakers_Router);

export default app;
