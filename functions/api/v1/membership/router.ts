import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembershipCategoriesList, MembershipCategoryUpdate } from "./categories";
import { MembershipBatchRunCreate } from "./batches/[batchKey]/runs/index";
import { MembershipSettingsGet, MembershipSettingsUpdate } from "./settings";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/categories", MembershipCategoriesList);
openapi.patch("/categories/:categoryCode", MembershipCategoryUpdate);
openapi.get("/settings", MembershipSettingsGet);
openapi.patch("/settings", MembershipSettingsUpdate);
openapi.post("/batches/:batchKey/runs", MembershipBatchRunCreate);

export default openapi;
