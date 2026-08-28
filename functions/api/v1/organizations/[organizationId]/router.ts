import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { OrganizationGet, OrganizationUpdate } from "./index";
import { OrganizationLogoDelete, OrganizationLogoPut } from "./logo";
import { OrganizationSecondaryContactConfirm } from "./confirm-secondary-contact";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationGet);
openapi.patch("/", OrganizationUpdate);
openapi.put("/logo", OrganizationLogoPut);
openapi.delete("/logo", OrganizationLogoDelete);
openapi.post("/confirm-secondary-contact", OrganizationSecondaryContactConfirm);

export default openapi;
