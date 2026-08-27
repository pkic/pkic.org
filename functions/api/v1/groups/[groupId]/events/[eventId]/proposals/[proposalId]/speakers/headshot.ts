import { OpenAPIRoute, type ValidatedData } from "chanfana";
import {
  groupEventProposalSpeakerHeadshotDeleteRouteSchema,
  groupEventProposalSpeakerHeadshotGetRouteSchema,
  groupEventProposalSpeakerHeadshotPutRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { getProposalSpeakerHeadshot } from "../../../../../../../../../_lib/services/admin-proposal-speaker-headshot";
import {
  removeProposalSpeakerHeadshot,
  replaceProposalSpeakerHeadshot,
} from "../../../../../../../../../_lib/services/proposal-speaker-headshot";
import {
  privateUserHeadshotResponse,
  requireUserHeadshotBucket,
} from "../../../../../../../../../_lib/services/user-headshot";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../../../../../../_lib/utils/image-upload";
import {
  groupProposalSpeakerHeadshotUrl,
  requireGroupProposalSpeakerContext,
  type GroupProposalSpeakerParams,
} from "./context";

async function load(
  c: AdminContext,
  params: GroupProposalSpeakerParams,
  permission: "proposals:score" | "proposals:manage",
) {
  const state = await requireGroupProposalSpeakerContext(c, params, permission);
  return { ...state, speaker: await getProposalSpeakerHeadshot(state.db, state.context.proposalId!, params.userId) };
}

export const GroupEventProposalSpeakerHeadshotGet = openApiRoute(
  groupEventProposalSpeakerHeadshotGetRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerHeadshotGetRouteSchema>) => {
    const { speaker } = await load(c, data.params, "proposals:score");
    if (!speaker.headshot_r2_key) return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
    return privateUserHeadshotResponse(requireUserHeadshotBucket(c.env), speaker.headshot_r2_key);
  },
);

async function upload(c: AdminContext, params: GroupProposalSpeakerParams): Promise<Response> {
  const { db, actor, context, contextGuard, speaker } = await load(c, params, "proposals:manage");
  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const image = await resizeHeadshot(uploaded.buffer, c.env.IMAGES);
  await replaceProposalSpeakerHeadshot({
    db,
    bucket: requireUserHeadshotBucket(c.env),
    proposalId: context.proposalId!,
    proposalEventId: context.eventId,
    permissionActor: actor,
    proposalSpeakerId: speaker.speaker_id,
    speakerUserId: speaker.user_id,
    previousOverrideSet: speaker.headshot_override_set,
    previousOverrideKey: speaker.headshot_override_r2_key,
    image,
    source: "group_proposal_upload",
    authorization: { contextGuard },
    audit: {
      actorType: "admin",
      actorId: actor.id,
      action: "proposal_speaker_headshot_uploaded_by_manager",
      scope: { type: "proposal", id: context.proposalId! },
      details: { proposalId: context.proposalId!, speakerUserId: speaker.user_id },
    },
  });
  const updated = await getProposalSpeakerHeadshot(db, context.proposalId!, speaker.user_id);
  return json({
    success: true,
    headshotUrl: groupProposalSpeakerHeadshotUrl(c, params, updated.headshot_updated_at),
  });
}

export class GroupEventProposalSpeakerHeadshotPut extends OpenAPIRoute {
  schema = groupEventProposalSpeakerHeadshotPutRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return upload(c, c.req.param() as unknown as GroupProposalSpeakerParams);
  }
}

export const GroupEventProposalSpeakerHeadshotDelete = openApiRoute(
  groupEventProposalSpeakerHeadshotDeleteRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerHeadshotDeleteRouteSchema>) => {
    const { db, actor, context, contextGuard, speaker } = await load(c, data.params, "proposals:manage");
    await removeProposalSpeakerHeadshot({
      db,
      proposalId: context.proposalId!,
      proposalEventId: context.eventId,
      permissionActor: actor,
      proposalSpeakerId: speaker.speaker_id,
      speakerUserId: speaker.user_id,
      previousOverrideSet: speaker.headshot_override_set,
      previousOverrideKey: speaker.headshot_override_r2_key,
      authorization: { contextGuard },
      audit: {
        actorType: "admin",
        actorId: actor.id,
        action: "proposal_speaker_headshot_removed_by_manager",
        scope: { type: "proposal", id: context.proposalId! },
        details: { proposalId: context.proposalId!, speakerUserId: speaker.user_id },
      },
    });
    return json({ success: true });
  },
);
