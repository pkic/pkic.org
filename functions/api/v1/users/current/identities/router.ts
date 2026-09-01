import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { CurrentUserActiveIdentityPut } from "./active";
import { CurrentUserIdentitiesGet, CurrentUserIdentityPost } from "./index";
import { CurrentUserIdentityPatch } from "./[identityId]";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserIdentitiesGet);
openapi.post("/", CurrentUserIdentityPost);
openapi.put("/active", CurrentUserActiveIdentityPut);
openapi.patch("/:identityId", CurrentUserIdentityPatch);

export default openapi;
