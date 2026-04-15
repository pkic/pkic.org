/**
 * Proposer-only: invite a co-speaker to an existing proposal.
 *
 * POST /api/v1/proposals/manage/[token]/speakers
 *   Body: { email, firstName?, lastName?, role }
 *   Auth: possession of the proposal manage token proves proposer identity.
 *
 * Only the proposer holds the proposal manage token — co-speakers hold separate
 * per-speaker tokens and cannot reach this endpoint.
 */
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import {
  getProposalByManageToken,
  addProposalSpeaker,
  buildProposalInviteEmailContext,
} from "../../../../../_lib/services/proposals";
import { findOrCreateUser } from "../../../../../_lib/services/users";
import { buildEventEmailVariables } from "../../../../../_lib/services/events";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { first } from "../../../../../_lib/db/queries";
import type { EventRecord } from "../../../../../_lib/services/events";
import { z } from "zod";
import { normalizedEmailSchema, firstNameSchema, lastNameSchema } from "../../../../../../assets/shared/schemas/api";

const coSpeakerInviteSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  role: z.enum(["speaker", "co_speaker", "moderator", "panelist"]).default("speaker"),
});

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, coSpeakerInviteSchema);
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"));

  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    return json({ error: { code: "PROPOSAL_CLOSED", message: "Cannot invite speakers to a closed proposal" } }, 400);
  }

  const event = await first<EventRecord>(c.env.DB, "SELECT * FROM events WHERE id = ?", [proposal.event_id]);
  if (!event) {
    return json({ error: { code: "EVENT_NOT_FOUND", message: "Event not found" } }, 404);
  }
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const speakerUser = await findOrCreateUser(c.env.DB, {
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
  });

  const { manageToken: speakerToken } = await addProposalSpeaker(c.env.DB, {
    proposalId: proposal.id,
    userId: speakerUser.id,
    role: body.role,
  });

  const speakerManageUrl = speakerManagePageUrl(appBaseUrl, event, speakerToken);

  const proposer = await first<{ first_name: string | null }>(c.env.DB, "SELECT first_name FROM users WHERE id = ?", [
    proposal.proposer_user_id,
  ]);

  const inviteContext = await buildProposalInviteEmailContext(c.env.DB, {
    proposalId: proposal.id,
    inviterUserId: proposal.proposer_user_id,
  });

  const outboxId = await queueEmail(c.env.DB, {
    eventId: event.id,
    templateKey: "co_speaker_invite",
    recipientEmail: speakerUser.email,
    recipientUserId: speakerUser.id,
    messageType: "transactional",
    subject: `You have been added as a speaker — ${event.name}`,
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: speakerUser.first_name ?? "",
      lastName: speakerUser.last_name ?? "",
      proposerFirstName: proposer?.first_name ?? "",
      invitedByDisplay: inviteContext.invitedByDisplay,
      proposalTitle: inviteContext.proposalTitle,
      proposalAbstract: inviteContext.proposalAbstract,
      speakerLineupText: inviteContext.speakerLineupText,
      manageUrl: speakerManageUrl,
    },
  });

  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

  return json({ success: true, email: speakerUser.email, role: body.role });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
