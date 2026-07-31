import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WgMeetingIcsUploadPost } from "./index";
import { WgMeetingIcsUpdatePatch, WgMeetingIcsDelete } from "./[fileId]";
import type { RequestDbContext } from "../../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/", WgMeetingIcsUploadPost);
openapi.patch("/:fileId", WgMeetingIcsUpdatePatch);
openapi.delete("/:fileId", WgMeetingIcsDelete);

export default openapi;
