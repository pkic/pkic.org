import type { ValidatedData } from "chanfana";
import {
  groupEventProposalSpeakerInviteRouteSchema,
  groupEventProposalSpeakersRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { coSpeakerInviteResponseSchema } from "../../../../../../../../../../assets/shared/schemas/proposal-management";
import { preparePermissionsAuthorizationGuard } from "../../../../../../../../../_lib/auth/permissions";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { processOutboxByIdBackground } from "../../../../../../../../../_lib/email/outbox";
import { getEventById } from "../../../../../../../../../_lib/services/events";
import { inviteProposalSpeaker } from "../../../../../../../../../_lib/services/proposal-speaker-invitations";
import { getProposalById } from "../../../../../../../../../_lib/services/proposals";
import { getProposalSpeakerRoster } from "../../../../../../../../../_lib/services/proposal-speaker-admin";
import { groupProposalSpeakerHeadshotUrl, requireGroupProposalSpeakerContext } from "./context";

export const GroupEventProposalSpeakersGet = openApiRoute(
  groupEventProposalSpeakersRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakersRouteSchema>) => {
    const { db, actor, context } = await requireGroupProposalSpeakerContext(c, data.params, "proposals:score");
    return json(
      await getProposalSpeakerRoster(db, actor, context.proposalId!, resolveAppBaseUrl(c.env, c.req.raw), {
        proposalHeadshotUrl: (userId, updatedAt) =>
          groupProposalSpeakerHeadshotUrl(c, { ...data.params, userId }, updatedAt),
      }),
    );
  },
);

export const GroupEventProposalSpeakerInvitePost = openApiRoute(
  groupEventProposalSpeakerInviteRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerInviteRouteSchema>) => {
    const { db, actor, context, contextGuard } = await requireGroupProposalSpeakerContext(
      c,
      data.params,
      "proposals:manage",
    );
    const [event, proposal] = await Promise.all([
      getEventById(db, context.eventId),
      getProposalById(db, context.proposalId!),
    ]);
    const invited = await inviteProposalSpeaker(db, {
      proposal,
      event,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      ...data.body,
      authorization: { contextGuard },
      permissionGuard: preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "proposals:manage", context: { type: "event", id: context.eventId } },
      ]),
      auditActor: { type: "admin", id: actor.id },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, invited.outboxId));
    return json(
      coSpeakerInviteResponseSchema.parse({
        success: true,
        email: invited.email,
        role: data.body.role,
        expiresAt: invited.expiresAt,
        queued: invited.queued,
      }),
    );
  },
);
