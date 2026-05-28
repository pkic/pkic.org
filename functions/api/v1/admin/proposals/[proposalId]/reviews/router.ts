import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminProposalsProposalIdReviewsReviewIdPatch } from "./[reviewId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.patch("/:reviewId", AdminProposalsProposalIdReviewsReviewIdPatch);

export default openapi;
