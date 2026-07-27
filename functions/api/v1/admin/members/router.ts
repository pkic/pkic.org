import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersList, MembersCreate } from "./index";
import { MemberUpdate, MemberDelete } from "./[id]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MembersList);
openapi.post("/", MembersCreate);
openapi.patch("/:id", MemberUpdate);
openapi.delete("/:id", MemberDelete);

export default openapi;
