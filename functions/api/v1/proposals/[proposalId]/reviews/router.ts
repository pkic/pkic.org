import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { proposalReviewPatchRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { onRequestPatch } from "./[reviewId]";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.patch("/:reviewId", openApiRoute(proposalReviewPatchRouteSchema, onRequestPatch));

export default openapi;
