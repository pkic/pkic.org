import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MailingListsCreate, MailingListsList } from "./index";
import { MailingListDelete, MailingListUpdate } from "./[id]/index";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MailingListsList);
openapi.post("/", MailingListsCreate);
openapi.patch("/:id", MailingListUpdate);
openapi.delete("/:id", MailingListDelete);

export default openapi;
