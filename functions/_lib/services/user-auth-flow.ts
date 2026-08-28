import { queueUserSignInCapability } from "../auth/user-session";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";

export async function requestUserSignInLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash: string | null;
    userAgentHash: string | null;
    ttlMinutes: number;
    magicLinkBaseUrl: string;
    signingSecret: string;
  },
): Promise<{ outboxId: string | null; identityFound: boolean }> {
  const magic = await queueUserSignInCapability({ db, ...payload });
  if (!magic) return { outboxId: null, identityFound: false };

  const email = prepareQueueEmailStatement(db, {
    templateKey: "user_magic_link",
    recipientEmail: magic.identity.email,
    recipientUserId: magic.identity.id,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium sign-in link",
    data: {
      email: magic.identity.email,
      magicLinkUrl: `${payload.magicLinkBaseUrl}?token=${encodeURIComponent(magic.queuedToken)}`,
      expiresInMinutes: payload.ttlMinutes,
    },
    capabilityLinkValues: [magic.queuedToken],
  });

  await db.batch([
    email.statement,
    prepareAuditLog(db, "user", magic.identity.id, "user_magic_link_requested", "user_identity", magic.identity.id, {
      capacities: magic.capacities,
      email: magic.identity.email,
    }),
  ]);
  return { outboxId: email.id, identityFound: true };
}
