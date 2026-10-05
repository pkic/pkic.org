import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EventsEventSlugProposalsResendSpeakerManageLinkPost } from "./resend-speaker-manage-link";
import { EventsEventSlugProposalsResendManageLinkPost } from "./resend-manage-link";
import {
  EventProposalProofIdentityPatch,
  EventProposalProofPersonPatch,
  EventProposalProofPost,
  EventProposalProofVerifyPost,
  EventProposalProofIdentitiesPost,
} from "./proof";

const app = new Hono();
export const openapi = fromHono(app);

openapi.patch("/proof/identities/:identityId", EventProposalProofIdentityPatch);
openapi.patch("/proof/person", EventProposalProofPersonPatch);
openapi.post("/proof", EventProposalProofPost);
openapi.post("/proof/verify", EventProposalProofVerifyPost);
openapi.post("/proof/identities", EventProposalProofIdentitiesPost);
openapi.post("/resend-speaker-manage-link", EventsEventSlugProposalsResendSpeakerManageLinkPost);
openapi.post("/resend-manage-link", EventsEventSlugProposalsResendManageLinkPost);

export default openapi;
