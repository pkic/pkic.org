import { MembershipWorkflowDestinations, MembershipWorkflowDestination } from "./workflows";
import {
  MembershipWorkflowsList,
  MembershipWorkflowGet,
  MembershipWorkflowCreate,
  MembershipWorkflowUpdate,
  MembershipWorkflowPublish,
  MembershipWorkflowRemove,
} from "./workflows";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  MembershipCategoryOrder,
  MembershipCategoriesList,
  MembershipCategoryUpdate,
  MembershipCategoryCreate,
  MembershipCategoryDelete,
} from "./categories";
import { MembershipSettingsGet, MembershipSettingsUpdate } from "./settings";
import { MembershipFeeSettlementCreate } from "./fees/[feeId]/settlements";
import { MembershipFeeSync } from "./fees/[feeId]/sync";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/workflows/destinations", MembershipWorkflowDestinations);
openapi.get("/workflows/destinations/:destinationId", MembershipWorkflowDestination);
openapi.get("/workflows/versions", MembershipWorkflowsList);
openapi.post("/workflows/versions", MembershipWorkflowCreate);
openapi.get("/workflows/versions/:versionId", MembershipWorkflowGet);
openapi.patch("/workflows/versions/:versionId", MembershipWorkflowUpdate);
openapi.delete("/workflows/versions/:versionId", MembershipWorkflowRemove);
openapi.post("/workflows/versions/:versionId/publication", MembershipWorkflowPublish);
openapi.get("/categories", MembershipCategoriesList);
openapi.post("/categories", MembershipCategoryCreate);
openapi.put("/categories/order", MembershipCategoryOrder);
openapi.delete("/categories/:categoryCode", MembershipCategoryDelete);
openapi.patch("/categories/:categoryCode", MembershipCategoryUpdate);
openapi.get("/settings", MembershipSettingsGet);
openapi.patch("/settings", MembershipSettingsUpdate);
openapi.post("/fees/:feeId/settlements", MembershipFeeSettlementCreate);
openapi.post("/fees/:feeId/sync", MembershipFeeSync);

export default openapi;
