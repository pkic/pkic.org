import { OpenAPIRoute, type ValidatedData } from "chanfana";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { json } from "../../../../../../_lib/http";
import {
  proposalManagementSpeakerHeadshotDeleteRouteSchema,
  proposalManagementSpeakerHeadshotGetRouteSchema,
  proposalManagementSpeakerHeadshotPutRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getProposalSpeakerHeadshot,
  proposalSpeakerHeadshotUrl,
} from "../../../../../../_lib/services/proposal-speaker-headshot-read-model";
import {
  requireProposalSpeakerPermission,
  type ProposalSpeakerPermission,
} from "../../../../../../_lib/services/proposal-speaker-access";
import { privateUserHeadshotResponse, requireUserHeadshotBucket } from "../../../../../../_lib/services/user-headshot";
import {
  removeProposalSpeakerHeadshot,
  replaceProposalSpeakerHeadshot,
} from "../../../../../../_lib/services/proposal-speaker-headshot";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../../../_lib/utils/image-upload";

type GetData = ValidatedData<typeof proposalManagementSpeakerHeadshotGetRouteSchema>;
type DeleteData = ValidatedData<typeof proposalManagementSpeakerHeadshotDeleteRouteSchema>;
type HeadshotParams = { proposalId: string; userId: string };

async function load(c: AdminContext, proposalId: string, userId: string, permission: ProposalSpeakerPermission) {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const speaker = await getProposalSpeakerHeadshot(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, admin, speaker.proposal_event_id, permission);
  return { db, admin, speaker };
}

async function onGet(c: AdminContext, data: GetData): Promise<Response> {
  const { speaker } = await load(c, data.params.proposalId, data.params.userId, "review");
  if (!speaker.headshot_r2_key) return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  return privateUserHeadshotResponse(requireUserHeadshotBucket(c.env), speaker.headshot_r2_key);
}

async function onPut(c: AdminContext, params: HeadshotParams): Promise<Response> {
  const { db, admin, speaker } = await load(c, params.proposalId, params.userId, "manage");
  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const image = await resizeHeadshot(uploaded.buffer, c.env.IMAGES);
  const r2Key = await replaceProposalSpeakerHeadshot({
    db,
    bucket: requireUserHeadshotBucket(c.env),
    proposalId: params.proposalId,
    proposalEventId: speaker.proposal_event_id,
    permissionActor: admin,
    proposalSpeakerId: speaker.speaker_id,
    speakerUserId: speaker.user_id,
    previousOverrideSet: speaker.headshot_override_set,
    previousOverrideKey: speaker.headshot_override_r2_key,
    image,
    source: "admin_proposal_upload",
    audit: {
      actorType: "admin",
      actorId: admin.id,
      action: "proposal_speaker_headshot_uploaded_by_admin",
      scope: { type: "proposal", id: params.proposalId },
      details: { proposalId: params.proposalId, speakerUserId: speaker.user_id },
    },
  });
  const updated = await getProposalSpeakerHeadshot(db, params.proposalId, params.userId);
  return json({
    success: true,
    r2Key,
    headshotUrl: proposalSpeakerHeadshotUrl(
      resolveAppBaseUrl(c.env, c.req.raw),
      params.proposalId,
      speaker.user_id,
      updated.headshot_updated_at,
    ),
  });
}

async function onDelete(c: AdminContext, data: DeleteData): Promise<Response> {
  const { db, admin, speaker } = await load(c, data.params.proposalId, data.params.userId, "manage");
  await removeProposalSpeakerHeadshot({
    db,
    proposalId: data.params.proposalId,
    proposalEventId: speaker.proposal_event_id,
    permissionActor: admin,
    proposalSpeakerId: speaker.speaker_id,
    speakerUserId: speaker.user_id,
    previousOverrideSet: speaker.headshot_override_set,
    previousOverrideKey: speaker.headshot_override_r2_key,
    audit: {
      actorType: "admin",
      actorId: admin.id,
      action: "proposal_speaker_headshot_removed_by_admin",
      scope: { type: "proposal", id: data.params.proposalId },
      details: { proposalId: data.params.proposalId, speakerUserId: speaker.user_id },
    },
  });
  return json({ success: true });
}

export const ProposalSpeakerHeadshotGet = openApiRoute(proposalManagementSpeakerHeadshotGetRouteSchema, onGet);
export const ProposalSpeakerHeadshotDelete = openApiRoute(proposalManagementSpeakerHeadshotDeleteRouteSchema, onDelete);

export class ProposalSpeakerHeadshotPut extends OpenAPIRoute {
  schema = proposalManagementSpeakerHeadshotPutRouteSchema;

  async handle(c: AdminContext): Promise<Response> {
    return onPut(c, c.req.param() as HeadshotParams);
  }
}
