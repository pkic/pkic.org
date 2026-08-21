import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../../_lib/http";
import { onRequestGet as versionsGet } from "./versions/index";
import { onRequestPost as versionsUpload } from "./versions/upload";
import { onRequestGet as versionDownloadGet } from "./versions/[versionId]/download";
import { onRequestPost as versionReviewPost } from "./versions/[versionId]/review";
import { onRequestDelete as versionDelete } from "./versions/[versionId]/index";
import type { RequestDbContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  adminPresentationUploadRouteSchema,
  adminPresentationVersionDeleteRouteSchema,
  adminPresentationVersionDownloadRouteSchema,
  adminPresentationVersionReviewRouteSchema,
  adminPresentationVersionsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.get("/versions", openApiRoute(adminPresentationVersionsListRouteSchema, versionsGet));
openapi.post("/versions", openApiRoute(adminPresentationUploadRouteSchema, versionsUpload));
openapi.get(
  "/versions/:versionId/download",
  openApiRoute(adminPresentationVersionDownloadRouteSchema, versionDownloadGet),
);
openapi.post("/versions/:versionId/review", openApiRoute(adminPresentationVersionReviewRouteSchema, versionReviewPost));
openapi.delete("/versions/:versionId", openApiRoute(adminPresentationVersionDeleteRouteSchema, versionDelete));

export default openapi;
