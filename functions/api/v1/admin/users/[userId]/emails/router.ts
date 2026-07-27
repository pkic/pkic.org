import { Hono } from "hono";
import { fromHono } from "chanfana";
import { UserEmailsList, UserEmailsAdd } from "./index";
import { UserEmailsRemove } from "./[emailId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", UserEmailsList);
openapi.post("/", UserEmailsAdd);
openapi.delete("/:emailId", UserEmailsRemove);

export default openapi;
