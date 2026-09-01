import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { OrganizationIdentityPatch } from "./[identityId]";
import { OrganizationIdentitiesGet, OrganizationIdentityPost } from "./index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationIdentitiesGet);
openapi.post("/", OrganizationIdentityPost);
openapi.patch("/:identityId", OrganizationIdentityPatch);

export default openapi;
