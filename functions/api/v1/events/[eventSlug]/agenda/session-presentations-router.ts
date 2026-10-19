import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import {
  SessionPresentationPublicRelease,
  SessionPresentationList,
  SessionPresentationUpload,
  SessionPresentationReview,
  SessionPresentationDelete,
  SessionPresentationDownload,
} from "./session-presentations";

const app = new Hono<RequestDbContext>();
const openapi = fromHono(app);
openapi.get("/", SessionPresentationList);
openapi.post("/", SessionPresentationUpload);
openapi.post("/:versionId/reviews", SessionPresentationReview);
openapi.get("/:versionId/content", SessionPresentationDownload);
openapi.delete("/:versionId", SessionPresentationDelete);
openapi.get("/:versionId/releases/:digest/content", SessionPresentationPublicRelease);
export default openapi;
