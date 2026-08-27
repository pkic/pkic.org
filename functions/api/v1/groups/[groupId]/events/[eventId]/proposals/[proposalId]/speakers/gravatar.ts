import type { ValidatedData } from "chanfana";
import { groupEventProposalSpeakerGravatarPostRouteSchema } from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { getProposalSpeakerHeadshot } from "../../../../../../../../../_lib/services/admin-proposal-speaker-headshot";
import { replaceProposalSpeakerHeadshot } from "../../../../../../../../../_lib/services/proposal-speaker-headshot";
import { requireUserHeadshotBucket } from "../../../../../../../../../_lib/services/user-headshot";
import { downloadGravatar, gravatarHash } from "../../../../../../../../../_lib/utils/gravatar";
import { groupProposalSpeakerHeadshotUrl, requireGroupProposalSpeakerContext } from "./context";

export const GroupEventProposalSpeakerGravatarPost = openApiRoute(
  groupEventProposalSpeakerGravatarPostRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerGravatarPostRouteSchema>) => {
    const { db, actor, context, contextGuard } = await requireGroupProposalSpeakerContext(
      c,
      data.params,
      "proposals:manage",
    );
    const speaker = await getProposalSpeakerHeadshot(db, context.proposalId!, data.params.userId);
    const image = await downloadGravatar(speaker.email);
    if (!image)
      return json({ error: { code: "NO_GRAVATAR", message: "No Gravatar found for this email address" } }, 404);
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
      source: "group_proposal_gravatar",
      authorization: { contextGuard },
      audit: {
        actorType: "admin",
        actorId: actor.id,
        action: "proposal_speaker_headshot_imported_gravatar_by_manager",
        scope: { type: "proposal", id: context.proposalId! },
        details: {
          proposalId: context.proposalId!,
          speakerUserId: speaker.user_id,
          gravatarHash: await gravatarHash(speaker.email),
        },
      },
    });
    const updated = await getProposalSpeakerHeadshot(db, context.proposalId!, speaker.user_id);
    return json({
      success: true,
      source: "gravatar",
      headshotUrl: groupProposalSpeakerHeadshotUrl(c, data.params, updated.headshot_updated_at),
    });
  },
);
