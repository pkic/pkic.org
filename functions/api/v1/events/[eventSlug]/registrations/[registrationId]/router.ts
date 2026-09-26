import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../../_lib/db/context";
import { EventRegistrationAccessCreate } from "./access";
import { EventRegistrationAdmissionsCreate } from "./admissions";
import { EventRegistrationAuditGet } from "./audit";
import { EventRegistrationBadgeCreate, EventRegistrationBadgeGet, EventRegistrationBadgePatch } from "./badge";
import { EventRegistrationDetailGet, EventRegistrationPatch } from "./index";
import { EventRegistrationNotificationsCreate } from "./notifications";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", EventRegistrationDetailGet);
openapi.patch("/", EventRegistrationPatch);
openapi.post("/access", EventRegistrationAccessCreate);
openapi.post("/admissions", EventRegistrationAdmissionsCreate);
openapi.get("/audit", EventRegistrationAuditGet);
openapi.get("/badge", EventRegistrationBadgeGet);
openapi.patch("/badge", EventRegistrationBadgePatch);
openapi.post("/badge", EventRegistrationBadgeCreate);
openapi.post("/notifications", EventRegistrationNotificationsCreate);

export default openapi;
