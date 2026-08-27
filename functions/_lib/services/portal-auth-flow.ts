import { queuePortalSignInCapability } from "../auth/portal";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";

export async function requestPortalSignInLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash: string | null;
    userAgentHash: string | null;
    ttlMinutes: number;
    appBaseUrl: string;
    signingSecret: string;
  },
): Promise<{ outboxId: string | null; identityFound: boolean }> {
  const magic = await queuePortalSignInCapability(db, payload);
  if (!magic) return { outboxId: null, identityFound: false };

  const email = prepareQueueEmailStatement(db, {
    templateKey: "portal_magic_link",
    recipientEmail: magic.identity.email,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium portal sign-in link",
    data: {
      email: magic.identity.email,
      magicLinkUrl: `${payload.appBaseUrl}/portal/#/verify?token=${encodeURIComponent(magic.queuedToken)}`,
      expiresInMinutes: payload.ttlMinutes,
    },
    capabilityLinkValues: [magic.queuedToken],
  });

  await db.batch([
    email.statement,
    prepareAuditLog(
      db,
      "user",
      magic.identity.id,
      "portal_magic_link_requested",
      "portal_identity",
      magic.identity.id,
      { capacities: magic.capacities, email: magic.identity.email },
    ),
  ]);
  return { outboxId: email.id, identityFound: true };
}
