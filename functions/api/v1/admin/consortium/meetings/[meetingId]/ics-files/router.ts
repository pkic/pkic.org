import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ConsortiumMeetingIcsUploadPost } from "./index";
import { ConsortiumMeetingIcsUpdatePatch, ConsortiumMeetingIcsDelete } from "./[fileId]";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/", ConsortiumMeetingIcsUploadPost);
openapi.patch("/:fileId", ConsortiumMeetingIcsUpdatePatch);
openapi.delete("/:fileId", ConsortiumMeetingIcsDelete);

export default openapi;
