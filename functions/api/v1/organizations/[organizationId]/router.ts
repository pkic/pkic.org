import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { OrganizationGet, OrganizationUpdate } from "./index";
import { OrganizationLogoDelete, OrganizationLogoPut, OrganizationLogoReviewPost } from "./logo";
import { OrganizationSecondaryContactConfirm } from "./confirm-secondary-contact";
import { OrganizationMemberProfileGet } from "./profile";
import { OrganizationContentReviewPost, OrganizationContentReviewsGet } from "./content-reviews";
import { OrganizationContentReviewDelete } from "./content-reviews/[reviewId]";
import { OrganizationActiveSponsorshipGet } from "./sponsorships/active";
import { OrganizationGroupsGet } from "./groups";
import { OrganizationEventsGet } from "./events";
import { OrganizationProposalsGet } from "./proposals";
import {
  OrganizationSecondaryContactNominationDelete,
  OrganizationSecondaryContactNominationPut,
} from "./secondary-contact-nomination";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationGet);
openapi.patch("/", OrganizationUpdate);
openapi.get("/profile", OrganizationMemberProfileGet);
// The account record's activity: what the organization's representatives do
// elsewhere in the system, each as its own bounded, canonical collection.
openapi.get("/groups", OrganizationGroupsGet);
openapi.get("/events", OrganizationEventsGet);
openapi.get("/proposals", OrganizationProposalsGet);
openapi.get("/content/reviews", OrganizationContentReviewsGet);
openapi.post("/content/reviews", OrganizationContentReviewPost);
openapi.delete("/content/reviews/:reviewId", OrganizationContentReviewDelete);
openapi.get("/sponsors/current", OrganizationActiveSponsorshipGet);
openapi.put("/contacts/secondary/nomination", OrganizationSecondaryContactNominationPut);
openapi.delete("/contacts/secondary/nomination", OrganizationSecondaryContactNominationDelete);
openapi.post("/logo", OrganizationLogoReviewPost);
openapi.put("/logo", OrganizationLogoPut);
openapi.delete("/logo", OrganizationLogoDelete);
openapi.post("/contacts/secondary/confirmation", OrganizationSecondaryContactConfirm);

export default openapi;
