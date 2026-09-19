import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { AdminContext, RequestDbContext } from "../../../../../_lib/db/context";
import { markResponseSensitive } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireParticipantAuthority } from "../../../../../_lib/routes/participant-authority";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-proposal-participant";
import { onRequestGet, onRequestPatch } from "../../access/[token]";
import { handleCoSpeakerInvite } from "../../access/[token]/speakers";
import { handleProposalSpeakerPatch, onRequestDelete } from "../../access/[token]/speakers/[userId]";
import { handleProposalSpeakerReminder } from "../../access/[token]/speakers/[userId]/reminders";
import * as photo from "../../access/[token]/speakers/[userId]/headshot";

const app = new Hono<RequestDbContext>();
const routes = fromHono(app);

async function params(c: AdminContext, input: { proposalId: string }) {
  return { ...input, token: await requireParticipantAuthority(c, input.proposalId) };
}

routes.get(
  "/",
  openApiRoute(
    contracts.participantSubmissionRead,
    async (c: AdminContext, data) => onRequestGet(c, { ...data, params: await params(c, data.params) }),
    markResponseSensitive,
  ),
);
routes.patch(
  "/",
  openApiRoute(
    contracts.participantSubmissionUpdate,
    async (c: AdminContext, data) => onRequestPatch(c, { ...data, params: await params(c, data.params) }),
    markResponseSensitive,
  ),
);
routes.post(
  "/speakers",
  openApiRoute(
    contracts.participantSpeakerInvite,
    async (c: AdminContext, data) =>
      handleCoSpeakerInvite(c, data.body, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);
routes.patch(
  "/speakers/:userId",
  openApiRoute(
    contracts.participantSpeakerUpdate,
    async (c: AdminContext, data) =>
      handleProposalSpeakerPatch(c, { ...data, params: { ...data.params, ...(await params(c, data.params)) } }),
    markResponseSensitive,
  ),
);
routes.delete(
  "/speakers/:userId",
  openApiRoute(
    contracts.participantSpeakerRemove,
    async (c: AdminContext, data) =>
      onRequestDelete(c, { ...data, params: { ...data.params, ...(await params(c, data.params)) } }),
    markResponseSensitive,
  ),
);
routes.post(
  "/speakers/:userId/reminders",
  openApiRoute(
    contracts.participantSpeakerRemind,
    async (c: AdminContext, data) =>
      handleProposalSpeakerReminder(c, { ...data, params: { ...data.params, ...(await params(c, data.params)) } }),
    markResponseSensitive,
  ),
);
routes.get(
  "/speakers/:userId/headshot",
  openApiRoute(
    contracts.participantSpeakerPhotoRead,
    async (c: AdminContext, data) => photo.onGet(c, { ...data.params, ...(await params(c, data.params)) }),
    markResponseSensitive,
  ),
);
routes.put(
  "/speakers/:userId/headshot",
  openApiRoute(
    contracts.participantSpeakerPhotoUpdate,
    async (c: AdminContext, data) => photo.onPut(c, { ...data.params, ...(await params(c, data.params)) }),
    markResponseSensitive,
  ),
);
routes.delete(
  "/speakers/:userId/headshot",
  openApiRoute(
    contracts.participantSpeakerPhotoDelete,
    async (c: AdminContext, data) => photo.onDelete(c, { ...data.params, ...(await params(c, data.params)) }),
    markResponseSensitive,
  ),
);

export default routes;
