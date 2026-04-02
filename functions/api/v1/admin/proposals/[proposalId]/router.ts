import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminProposalsProposalIdFinalizePost_l } from "./finalize";
import { onRequestGet as AdminProposalsProposalIdReviewsGet_l } from "./reviews";
import { onRequestPost as AdminProposalsProposalIdReviewsPost_l } from "./reviews";
import { onRequestGet as AdminProposalsProposalIdSpeakersGet_l } from "./speakers";
import reviews_Router from "./reviews/router";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/finalize", AdminProposalsProposalIdFinalizePost_l);
app.get("/reviews", AdminProposalsProposalIdReviewsGet_l);
app.post("/reviews", AdminProposalsProposalIdReviewsPost_l);
app.get("/speakers", AdminProposalsProposalIdSpeakersGet_l);
app.route("/reviews", reviews_Router);

export default app;
