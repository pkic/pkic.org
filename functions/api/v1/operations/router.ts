import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { DueWorkList } from "./due-work";
import { OperationsRemindersPreviewPost } from "./reminders/preview";
import { OperationsRemindersRunPost } from "./reminders/run";
import { OperationsRetentionRunPost } from "./retention/run";
import {
  OperationsConsultationBatchRunPost,
  OperationsEcReviewBatchRunPost,
  OperationsWgChairDigestRunPost,
} from "./membership-batches/run";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/due-work", DueWorkList);
openapi.post("/reminders/preview", OperationsRemindersPreviewPost);
openapi.post("/reminders/run", OperationsRemindersRunPost);
openapi.post("/retention/run", OperationsRetentionRunPost);
openapi.post("/membership-batches/consultation/run", OperationsConsultationBatchRunPost);
openapi.post("/membership-batches/ec-review/run", OperationsEcReviewBatchRunPost);
openapi.post("/membership-batches/wg-chair-digest/run", OperationsWgChairDigestRunPost);

export default openapi;
