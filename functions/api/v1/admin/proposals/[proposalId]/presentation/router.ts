import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../../_lib/http";
import { onRequestGet as versionsGet } from "./versions/index";
import { onRequestPost as versionsUpload } from "./versions/upload";
import { onRequestGet as versionDownloadGet } from "./versions/[versionId]/download";
import { onRequestPost as versionReviewPost } from "./versions/[versionId]/review";
import { onRequestDelete as versionDelete } from "./versions/[versionId]/index";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.get("/versions", versionsGet);
openapi.post("/versions", versionsUpload);
openapi.get("/versions/:versionId/download", versionDownloadGet);
openapi.post("/versions/:versionId/review", versionReviewPost);
openapi.delete("/versions/:versionId", versionDelete);

export default openapi;
