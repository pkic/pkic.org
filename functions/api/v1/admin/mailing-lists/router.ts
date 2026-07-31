import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MailingListsCreate, MailingListsList } from "./index";
import { MailingListDelete, MailingListUpdate } from "./[id]/index";
import { MailingListsSync } from "./sync";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MailingListsList);
openapi.post("/", MailingListsCreate);
// Registered ahead of the "/:id" routes so the literal "sync" segment isn't
// swallowed as an :id value.
openapi.post("/sync", MailingListsSync);
openapi.patch("/:id", MailingListUpdate);
openapi.delete("/:id", MailingListDelete);

export default openapi;
