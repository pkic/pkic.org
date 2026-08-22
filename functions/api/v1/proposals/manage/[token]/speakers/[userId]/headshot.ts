import { OpenAPIRoute } from "chanfana";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { getProposerManagedSpeakerContext } from "../../../../../../../_lib/services/proposer-speaker-profile";
import {
  privateUserHeadshotResponse,
  requireUserHeadshotBucket,
  removeUserHeadshotForRequest,
  uploadUserHeadshotForRequest,
} from "../../../../../../../_lib/services/user-headshot";
import { readValidatedUploadedImage } from "../../../../../../../_lib/utils/image-upload";
import {
  proposerManagedSpeakerHeadshotDeleteRouteSchema,
  proposerManagedSpeakerHeadshotGetRouteSchema,
  proposerManagedSpeakerHeadshotPutRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts";
import { SPEAKER_HEADSHOT_MAX_BYTES } from "../../../../../../../../assets/shared/schemas/images";

interface HeadshotParams {
  token: string;
  userId: string;
}

async function loadContext(c: AdminContext, params: HeadshotParams) {
  c.set?.("sensitive", true);
  return getProposerManagedSpeakerContext(requestDb(c), params.token, params.userId, requireInternalSecret(c.env));
}

async function onGet(c: AdminContext, params: HeadshotParams): Promise<Response> {
  const { speaker } = await loadContext(c, params);
  if (!speaker.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }
  return privateUserHeadshotResponse(requireUserHeadshotBucket(c.env), speaker.headshot_r2_key);
}

async function onPut(c: AdminContext, params: HeadshotParams): Promise<Response> {
  const { proposal, speaker } = await loadContext(c, params);
  const image = await readValidatedUploadedImage(c.req.raw, "Headshot", SPEAKER_HEADSHOT_MAX_BYTES);
  const { r2Key, origin } = await uploadUserHeadshotForRequest(
    requestDb(c),
    c.env,
    c.req.raw,
    c.executionCtx.waitUntil.bind(c.executionCtx),
    {
      userId: speaker.user_id,
      previousKey: speaker.headshot_r2_key,
      image,
      source: "proposal_manage_upload",
      audit: {
        actorType: "user",
        actorId: proposal.proposer_user_id,
        action: "speaker_headshot_uploaded_by_proposer",
        entityType: "proposal_speaker",
        entityId: speaker.id,
        scope: { type: "proposal", id: proposal.id },
        details: { proposalId: proposal.id, speakerUserId: speaker.user_id },
      },
    },
  );
  return json({
    success: true,
    r2Key,
    headshotUrl: `${origin}/api/v1/proposals/manage/${encodeURIComponent(params.token)}/speakers/${encodeURIComponent(speaker.user_id)}/headshot?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

async function onDelete(c: AdminContext, params: HeadshotParams): Promise<Response> {
  const { proposal, speaker } = await loadContext(c, params);
  await removeUserHeadshotForRequest(requestDb(c), c.env, c.req.raw, c.executionCtx.waitUntil.bind(c.executionCtx), {
    userId: speaker.user_id,
    previousKey: speaker.headshot_r2_key,
    audit: {
      actorType: "user",
      actorId: proposal.proposer_user_id,
      action: "speaker_headshot_deleted_by_proposer",
      entityType: "proposal_speaker",
      entityId: speaker.id,
      scope: { type: "proposal", id: proposal.id },
      details: { proposalId: proposal.id, speakerUserId: speaker.user_id },
    },
  });
  return json({ success: true });
}

export const ProposerManagedSpeakerHeadshotGet = openApiRoute(proposerManagedSpeakerHeadshotGetRouteSchema, (c, data) =>
  onGet(c, data.params as HeadshotParams),
);

export class ProposerManagedSpeakerHeadshotPut extends OpenAPIRoute {
  schema = proposerManagedSpeakerHeadshotPutRouteSchema;

  async handle(c: AdminContext) {
    return onPut(c, c.req.param() as unknown as HeadshotParams);
  }
}

export const ProposerManagedSpeakerHeadshotDelete = openApiRoute(
  proposerManagedSpeakerHeadshotDeleteRouteSchema,
  (c, data) => onDelete(c, data.params as HeadshotParams),
);
