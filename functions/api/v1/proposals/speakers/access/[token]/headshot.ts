import { OpenAPIRoute } from "chanfana";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { getSpeakerByManageToken } from "../../../../../../_lib/services/proposals";
import { privateUserHeadshotResponse, requireUserHeadshotBucket } from "../../../../../../_lib/services/user-headshot";
import {
  removeProposalSpeakerSelfHeadshot,
  uploadProposalSpeakerSelfHeadshot,
} from "../../../../../../_lib/services/proposal-speaker-self-headshot";
import { readValidatedUploadedImage } from "../../../../../../_lib/utils/image-upload";
import { SPEAKER_HEADSHOT_MAX_BYTES } from "../../../../../../../assets/shared/schemas/images";
import {
  proposalSpeakerHeadshotDeleteRouteSchema,
  proposalSpeakerHeadshotGetRouteSchema,
  proposalSpeakerHeadshotPutRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";
import { proposalSpeakerAccessPath } from "../../../../../../../assets/shared/proposal-access-paths";

async function loadContext(c: AdminContext, token: string) {
  c.set?.("sensitive", true);
  return getSpeakerByManageToken(requestDb(c), token, requireInternalSecret(c.env));
}

async function onGet(c: AdminContext, token: string): Promise<Response> {
  const { user } = await loadContext(c, token);
  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }
  return privateUserHeadshotResponse(requireUserHeadshotBucket(c.env), user.headshot_r2_key);
}

async function onPut(c: AdminContext, token: string): Promise<Response> {
  const { proposal, speaker, user } = await loadContext(c, token);
  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }

  const image = await readValidatedUploadedImage(c.req.raw, "Headshot", SPEAKER_HEADSHOT_MAX_BYTES);
  const { r2Key, origin } = await uploadProposalSpeakerSelfHeadshot(
    {
      db: requestDb(c),
      env: c.env,
      request: c.req.raw,
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
      proposalId: proposal.id,
      proposalSpeakerId: speaker.id,
      userId: user.id,
      proposalStatus: proposal.status,
      proposalUpdatedAt: proposal.updated_at,
      currentStatus: speaker.status,
      inviteGeneration: speaker.invite_generation,
      accountHeadshotKey: user.accountHeadshotR2Key,
      proposalOverrideSet: user.proposalHeadshotOverrideSet,
      proposalOverrideKey: user.proposalHeadshotOverrideKey,
    },
    image,
  );
  return json({
    success: true,
    r2Key,
    headshotUrl: `${proposalSpeakerAccessPath(`${origin}/api/v1`, token, "headshot")}?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

async function onDelete(c: AdminContext, token: string): Promise<Response> {
  const { proposal, speaker, user } = await loadContext(c, token);
  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }
  await removeProposalSpeakerSelfHeadshot({
    db: requestDb(c),
    env: c.env,
    request: c.req.raw,
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    proposalId: proposal.id,
    proposalSpeakerId: speaker.id,
    userId: user.id,
    proposalStatus: proposal.status,
    proposalUpdatedAt: proposal.updated_at,
    currentStatus: speaker.status,
    inviteGeneration: speaker.invite_generation,
    accountHeadshotKey: user.accountHeadshotR2Key,
    proposalOverrideSet: user.proposalHeadshotOverrideSet,
    proposalOverrideKey: user.proposalHeadshotOverrideKey,
  });
  return json({ success: true });
}

export const ProposalSpeakerHeadshotGet = openApiRoute(proposalSpeakerHeadshotGetRouteSchema, (c, data) =>
  onGet(c, data.params.token),
);

export class ProposalSpeakerHeadshotPut extends OpenAPIRoute {
  schema = proposalSpeakerHeadshotPutRouteSchema;

  async handle(c: AdminContext) {
    return onPut(c, c.req.param("token"));
  }
}

export const ProposalSpeakerHeadshotDelete = openApiRoute(proposalSpeakerHeadshotDeleteRouteSchema, (c, data) =>
  onDelete(c, data.params.token),
);
