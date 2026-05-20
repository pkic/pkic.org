import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPatch as AdminProposalsProposalIdReviewsReviewIdPatch_l } from "./[reviewId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.patch("/:reviewId", AdminProposalsProposalIdReviewsReviewIdPatch_l);

export default app;
