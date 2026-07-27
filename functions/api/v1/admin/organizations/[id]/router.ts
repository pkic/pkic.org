import { Hono } from "hono";
import { fromHono } from "chanfana";
import { OrganizationGet, OrganizationUpdate } from "./index";
import { onRequest as organizationLogoRequest_l } from "./logo";
import { OrganizationAddRepresentative } from "./members";
import { OrganizationConfirmSecondaryContactPost } from "./confirm-secondary-contact";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationGet);
openapi.patch("/", OrganizationUpdate);
app.put("/logo", organizationLogoRequest_l);
app.delete("/logo", organizationLogoRequest_l);
openapi.post("/members", OrganizationAddRepresentative);
openapi.post("/confirm-secondary-contact", OrganizationConfirmSecondaryContactPost);

export default openapi;
