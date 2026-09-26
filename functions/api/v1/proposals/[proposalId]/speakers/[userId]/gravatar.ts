import type { ValidatedData } from "chanfana";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { proposalManagementSpeakerGravatarPostRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { downloadGravatar, gravatarHash } from "../../../../../../_lib/utils/gravatar";
import {
  proposalSpeakerHeadshotUrl,
  getProposalSpeakerHeadshot,
} from "../../../../../../_lib/services/proposal-speaker-headshot-read-model";
import { requireProposalSpeakerPermission } from "../../../../../../_lib/services/proposal-speaker-access";
import { requireUserHeadshotBucket } from "../../../../../../_lib/services/user-headshot";
import { replaceProposalSpeakerHeadshot } from "../../../../../../_lib/services/proposal-speaker-headshot";

type Data = ValidatedData<typeof proposalManagementSpeakerGravatarPostRouteSchema>;

async function onPost(c: AdminContext, data: Data): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const speaker = await getProposalSpeakerHeadshot(db, data.params.proposalId, data.params.userId);
  await requireProposalSpeakerPermission(db, admin, speaker.proposal_event_id, "manage");
  const image = await downloadGravatar(speaker.email);
  if (!image) return json({ error: { code: "NO_GRAVATAR", message: "No Gravatar found for this email address" } }, 404);
  const r2Key = await replaceProposalSpeakerHeadshot({
    db,
    bucket: requireUserHeadshotBucket(c.env),
    proposalId: data.params.proposalId,
    proposalEventId: speaker.proposal_event_id,
    permissionActor: admin,
    proposalSpeakerId: speaker.speaker_id,
    speakerUserId: speaker.user_id,
    previousOverrideSet: speaker.headshot_override_set,
    previousOverrideKey: speaker.headshot_override_r2_key,
    image,
    source: "admin_proposal_gravatar",
    audit: {
      actorType: "admin",
      actorId: admin.id,
      action: "proposal_speaker_headshot_imported_gravatar_by_admin",
      scope: { type: "proposal", id: data.params.proposalId },
      details: {
        proposalId: data.params.proposalId,
        speakerUserId: speaker.user_id,
        gravatarHash: await gravatarHash(speaker.email),
      },
    },
  });
  const updated = await getProposalSpeakerHeadshot(db, data.params.proposalId, data.params.userId);
  return json({
    success: true,
    r2Key,
    source: "gravatar",
    headshotUrl: proposalSpeakerHeadshotUrl(
      resolveAppBaseUrl(c.env, c.req.raw),
      data.params.proposalId,
      speaker.user_id,
      updated.headshot_updated_at,
    ),
  });
}

export const ProposalSpeakerGravatarPost = openApiRoute(proposalManagementSpeakerGravatarPostRouteSchema, onPost);
