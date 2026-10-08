import { requireIdentityFromRequest } from "../../../../../../_lib/auth/user-session";
import type { ParticipantRouteData } from "../../../../../../_lib/routes/participant-authority";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requestDb, markResponseSensitive, type AdminContext } from "../../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../../_lib/http";
import { AppError } from "../../../../../../_lib/errors";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import { listUserIdentities } from "../../../../../../_lib/services/identities";
import { proposalSpeakerIdentitiesRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { isProposalSpeakerRosterEditableStatus } from "../../../../../../../assets/shared/schemas/proposal-status";

export async function onRequestGet(
  c: AdminContext,
  data: ParticipantRouteData<typeof proposalSpeakerIdentitiesRouteSchema>,
) {
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const { speaker, proposal } = await getSpeakerByManageToken(db, data.params.token, requireInternalSecret(c.env));
  if (identity.userId !== speaker.user_id) {
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "View only your own speaker identities.");
  }
  if (speaker.status === "declined") throw new AppError(403, "SPEAKER_DECLINED", "You have declined participation.");
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker representation cannot be changed on a closed proposal.");
  }
  return jsonPrivate(await listUserIdentities(db, speaker.user_id, { ...data.query, active: true, blocked: false }));
}

export const ProposalSpeakerIdentitiesGet = openApiRoute(
  proposalSpeakerIdentitiesRouteSchema,
  onRequestGet,
  markResponseSensitive,
);
