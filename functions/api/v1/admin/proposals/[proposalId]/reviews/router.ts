import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPatch as AdminProposalsProposalIdReviewsReviewIdPatch_l } from "./[reviewId]";

const app = new Hono();
export const openapi = fromHono(app);

app.patch("/:reviewId", AdminProposalsProposalIdReviewsReviewIdPatch_l);

export default app;
