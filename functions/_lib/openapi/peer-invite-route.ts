import type { z } from "zod";
import { registrationInviteCreateSchema } from "../../../assets/shared/schemas/registration";
import { processSelectedOutboxBackground } from "../email/outbox";
import { handleError, json } from "../http";
import { createPeerInvitations } from "../services/peer-invitations";
import { parseJsonBody } from "../validation";

type PeerInviteBody = z.infer<typeof registrationInviteCreateSchema>;

interface PeerInviteContext {
  env: Parameters<typeof createPeerInvitations>[0];
  req: {
    raw: Request;
    param(name: "eventSlug"): string;
  };
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
}

/** Builds the common Pages/OpenAPI adapter for attendee and speaker peer invites. */
export function createPeerInviteHandler(inviteType: "attendee" | "speaker") {
  return async function onRequestPost(c: PeerInviteContext, data?: { body: PeerInviteBody }): Promise<Response> {
    try {
      const body = data?.body ?? (await parseJsonBody(c.req, registrationInviteCreateSchema));
      const result = await createPeerInvitations(c.env, c.req.raw, c.req.param("eventSlug"), body, inviteType);
      if (result.outboxIds.length > 0) {
        c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, result.outboxIds));
      }
      return json(result.response);
    } catch (error) {
      return handleError(error);
    }
  };
}
