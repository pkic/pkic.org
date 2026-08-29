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
import {
  OrganizationSecondaryContactNominationDelete,
  OrganizationSecondaryContactNominationPut,
} from "./secondary-contact-nomination";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationGet);
openapi.patch("/", OrganizationUpdate);
openapi.get("/profile", OrganizationMemberProfileGet);
openapi.get("/content/reviews", OrganizationContentReviewsGet);
openapi.post("/content/reviews", OrganizationContentReviewPost);
openapi.delete("/content/reviews/:reviewId", OrganizationContentReviewDelete);
openapi.get("/sponsorships/current", OrganizationActiveSponsorshipGet);
openapi.put("/contacts/secondary/nomination", OrganizationSecondaryContactNominationPut);
openapi.delete("/contacts/secondary/nomination", OrganizationSecondaryContactNominationDelete);
openapi.post("/logo", OrganizationLogoReviewPost);
openapi.put("/logo", OrganizationLogoPut);
openapi.delete("/logo", OrganizationLogoDelete);
openapi.post("/contacts/secondary/confirmation", OrganizationSecondaryContactConfirm);

export default openapi;
