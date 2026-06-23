import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../../_lib/http";
import { AdminProposalsProposalIdReviewsReviewIdPatch } from "./[reviewId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.patch("/:reviewId", AdminProposalsProposalIdReviewsReviewIdPatch);

export default openapi;
