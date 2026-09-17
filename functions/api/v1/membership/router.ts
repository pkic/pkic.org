import { MembershipWorkflowDestinations, MembershipWorkflowDestination } from "./workflows";
import { MembershipPaymentWebhook } from "./payments";
import {
  MembershipWorkflowsList,
  MembershipWorkflowGet,
  MembershipWorkflowCreate,
  MembershipWorkflowUpdate,
  MembershipWorkflowPublish,
} from "./workflows";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  MembershipCategoriesList,
  MembershipCategoryUpdate,
  MembershipCategoryCreate,
  MembershipCategoryDelete,
} from "./categories";
import { MembershipSettingsGet, MembershipSettingsUpdate } from "./settings";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/payments/stripe/webhook", MembershipPaymentWebhook);
openapi.get("/workflows/destinations", MembershipWorkflowDestinations);
openapi.get("/workflows/destinations/:destinationId", MembershipWorkflowDestination);
openapi.get("/workflows/versions", MembershipWorkflowsList);
openapi.post("/workflows/versions", MembershipWorkflowCreate);
openapi.get("/workflows/versions/:versionId", MembershipWorkflowGet);
openapi.patch("/workflows/versions/:versionId", MembershipWorkflowUpdate);
openapi.post("/workflows/versions/:versionId/publication", MembershipWorkflowPublish);
openapi.get("/categories", MembershipCategoriesList);
openapi.post("/categories", MembershipCategoryCreate);
openapi.delete("/categories/:categoryCode", MembershipCategoryDelete);
openapi.patch("/categories/:categoryCode", MembershipCategoryUpdate);
openapi.get("/settings", MembershipSettingsGet);
openapi.patch("/settings", MembershipSettingsUpdate);

export default openapi;
