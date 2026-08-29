import type { ValidatedData } from "chanfana";
import {
  proposalSpeakerInviteRouteSchema,
  proposalSpeakersRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts";
import { coSpeakerInviteResponseSchema } from "../../../../../assets/shared/schemas/proposal-management";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { preparePermissionsAuthorizationGuard } from "../../../../_lib/auth/permissions";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { json } from "../../../../_lib/http";
import { getEventById } from "../../../../_lib/services/events";
import { inviteProposalSpeaker } from "../../../../_lib/services/proposal-speaker-invitations";
import { getProposalSpeakerRoster } from "../../../../_lib/services/proposal-speaker-management";
import { getProposalById } from "../../../../_lib/services/proposals";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof proposalSpeakersRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(await getProposalSpeakerRoster(db, admin, data.params.proposalId, resolveAppBaseUrl(c.env, c.req.raw)));
}

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof proposalSpeakerInviteRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const proposal = await getProposalById(db, data.params.proposalId);
  const event = await getEventById(db, proposal.event_id);
  const invited = await inviteProposalSpeaker(db, {
    proposal,
    event,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    ...data.body,
    permissionGuard: preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
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
}
