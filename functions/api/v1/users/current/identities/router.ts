import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { CurrentUserActiveIdentityPut } from "./active";
import { CurrentUserIdentitiesGet, CurrentUserIdentityPost } from "./index";
import { CurrentUserIdentityPatch } from "./[identityId]";
import { CurrentUserIdentityProfileGet, CurrentUserIdentityProfilePatch } from "./profile";
import { CurrentUserIdentityPreviewPost } from "./preview";
import {
  CurrentUserIdentityReinstatementConfirmationPost,
  CurrentUserIdentityReinstatementPost,
  CurrentUserIdentityReinstatementPreviewPost,
} from "./reinstatement";
import {
  CurrentUserAffiliationLinkKeptPost,
  CurrentUserAffiliationOfferDismissalPost,
  CurrentUserAffiliationOfferGet,
} from "./offer";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserIdentitiesGet);
openapi.post("/", CurrentUserIdentityPost);
openapi.post("/preview", CurrentUserIdentityPreviewPost);
openapi.put("/active", CurrentUserActiveIdentityPut);
openapi.get("/offer", CurrentUserAffiliationOfferGet);
openapi.post("/offer/dismissals", CurrentUserAffiliationOfferDismissalPost);
openapi.post("/offer/confirmations", CurrentUserAffiliationLinkKeptPost);
openapi.post("/reinstatement/preview", CurrentUserIdentityReinstatementPreviewPost);
openapi.post("/reinstatement/confirmation", CurrentUserIdentityReinstatementConfirmationPost);
openapi.patch("/:identityId", CurrentUserIdentityPatch);
openapi.post("/:identityId/reinstatement", CurrentUserIdentityReinstatementPost);
openapi.get("/:identityId/profile", CurrentUserIdentityProfileGet);
openapi.patch("/:identityId/profile", CurrentUserIdentityProfilePatch);

export default openapi;
