import {
  EvidencePurgeRenewalReview,
  EvidencePurgeResumptionCreate,
  EvidencePurgePreview,
  EvidencePurgeReviewCreate,
  EvidencePurgeRunCreate,
  EvidencePurgeRunRead,
  EvidencePurgeChunkCreate,
} from "./event-evidence";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { RetentionDueList } from "./due/index";
import { RetentionRunCreate } from "./runs/index";
import { EventEvidenceRetentionPolicyRead, EventEvidenceRetentionPolicyUpdate } from "./event-policy";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/due", RetentionDueList);
openapi.post("/runs", RetentionRunCreate);
openapi.get("/events/:eventId/policy", EventEvidenceRetentionPolicyRead);
openapi.put("/events/:eventId/policy", EventEvidenceRetentionPolicyUpdate);

openapi.get("/events/:eventId/evidence", EvidencePurgePreview);
openapi.post("/events/:eventId/reviews", EvidencePurgeReviewCreate);
openapi.post("/events/:eventId/runs", EvidencePurgeRunCreate);
openapi.get("/events/:eventId/runs/:runId", EvidencePurgeRunRead);
openapi.post("/events/:eventId/runs/:runId/chunks", EvidencePurgeChunkCreate);
openapi.post("/events/:eventId/runs/:runId/reviews", EvidencePurgeRenewalReview);
openapi.post("/events/:eventId/runs/:runId/resumptions", EvidencePurgeResumptionCreate);
export default openapi;
