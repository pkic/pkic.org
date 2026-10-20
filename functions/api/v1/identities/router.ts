import { Hono } from "hono";
import { fromHono } from "chanfana";
import invitations_Router from "./invitations/router";
import {
  AffiliationReviewGroupApprove,
  AffiliationReviewGroupDismiss,
  AffiliationReviewGroupGet,
  AffiliationReviewGroupsList,
  AffiliationReviewsList,
} from "./reviews";
import { IdentityGet, IdentityPatch } from "./[identityId]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/invitations", invitations_Router);
openapi.get("/reviews", AffiliationReviewsList);
openapi.get("/reviews/groups", AffiliationReviewGroupsList);
openapi.get("/reviews/groups/:groupKey", AffiliationReviewGroupGet);
openapi.post("/reviews/groups/:groupKey/dismiss", AffiliationReviewGroupDismiss);
openapi.post("/reviews/groups/:groupKey/approve", AffiliationReviewGroupApprove);
openapi.get("/:identityId", IdentityGet);
openapi.patch("/:identityId", IdentityPatch);

export default openapi;
