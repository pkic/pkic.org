import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../_lib/http";
import { onRequestGet as versionsGet } from "./versions/index";
import { onRequestPost as versionsUpload } from "./versions/upload";
import { onRequestGet as versionDownloadGet } from "./versions/[versionId]/download";
import { onRequestPost as versionReviewPost } from "./versions/[versionId]/review";
import { onRequestDelete as versionDelete } from "./versions/[versionId]/index";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  proposalPresentationUploadRouteSchema,
  proposalPresentationVersionContentRouteSchema,
  proposalPresentationVersionDeleteRouteSchema,
  proposalPresentationVersionReviewRouteSchema,
  proposalPresentationVersionsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.get("/", openApiRoute(proposalPresentationVersionsListRouteSchema, versionsGet));
openapi.post("/", openApiRoute(proposalPresentationUploadRouteSchema, versionsUpload));
openapi.get("/:versionId/content", openApiRoute(proposalPresentationVersionContentRouteSchema, versionDownloadGet));
openapi.post("/:versionId/reviews", openApiRoute(proposalPresentationVersionReviewRouteSchema, versionReviewPost));
openapi.delete("/:versionId", openApiRoute(proposalPresentationVersionDeleteRouteSchema, versionDelete));

export default openapi;
