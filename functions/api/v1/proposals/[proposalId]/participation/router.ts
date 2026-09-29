import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { AdminContext, RequestDbContext } from "../../../../../_lib/db/context";
import { markResponseSensitive } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireParticipantAuthority } from "../../../../../_lib/routes/participant-authority";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-proposal-participant";
import { onRequestGet, onRequestParticipationPatch, onRequestProfilePatch } from "../../speakers/access/[token]";
import * as photo from "../../speakers/access/[token]/headshot";
import * as presentation from "../../speakers/access/[token]/presentation";

const app = new Hono<RequestDbContext>();
const routes = fromHono(app);

async function params(c: AdminContext, proposalId: string) {
  return { token: await requireParticipantAuthority(c, proposalId) };
}

routes.get(
  "/",
  openApiRoute(
    contracts.participantRead,
    async (c: AdminContext, data) => onRequestGet(c, { ...data, params: await params(c, data.params.proposalId) }),
    markResponseSensitive,
  ),
);
routes.patch(
  "/",
  openApiRoute(
    contracts.participantRespond,
    async (c: AdminContext, data) =>
      onRequestParticipationPatch(c, { ...data, params: await params(c, data.params.proposalId) }),
    markResponseSensitive,
  ),
);
routes.patch(
  "/profile",
  openApiRoute(
    contracts.participantProfileUpdate,
    async (c: AdminContext, data) =>
      onRequestProfilePatch(c, { ...data, params: await params(c, data.params.proposalId) }),
    markResponseSensitive,
  ),
);
routes.get(
  "/headshot",
  openApiRoute(
    contracts.participantPhotoRead,
    async (c: AdminContext, data) => photo.onGet(c, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);
routes.put(
  "/headshot",
  openApiRoute(
    contracts.participantPhotoUpdate,
    async (c: AdminContext, data) => photo.onPut(c, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);
routes.delete(
  "/headshot",
  openApiRoute(
    contracts.participantPhotoDelete,
    async (c: AdminContext, data) => photo.onDelete(c, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);
routes.get(
  "/presentation",
  openApiRoute(
    contracts.participantPresentationRead,
    async (c: AdminContext, data) =>
      presentation.onRequestGet(c, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);
routes.put(
  "/presentation",
  openApiRoute(
    contracts.participantPresentationUpdate,
    async (c: AdminContext, data) =>
      presentation.onRequestPut(c, await requireParticipantAuthority(c, data.params.proposalId)),
    markResponseSensitive,
  ),
);

export default routes;
