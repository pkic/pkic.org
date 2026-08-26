import { queueAdminSignInCapability } from "../auth/admin";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";
import { buildManagementLink } from "./management-links";

export async function requestAdminSignInLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash: string | null;
    userAgentHash: string | null;
    ttlMinutes: number;
    appBaseUrl: string;
    signingSecret: string;
  },
): Promise<{ outboxId: string | null; adminFound: boolean }> {
  const magic = await queueAdminSignInCapability(db, payload);
  if (!magic.queuedToken || !magic.admin) {
    return { outboxId: null, adminFound: false };
  }

  const email = prepareQueueEmailStatement(db, {
    templateKey: "admin_magic_link",
    recipientEmail: magic.admin.email,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium admin sign-in link",
    data: {
      email: magic.admin.email,
      magicLinkUrl: buildManagementLink(payload.appBaseUrl, {
        kind: "admin-sign-in",
        token: magic.queuedToken,
      }),
      expiresInMinutes: payload.ttlMinutes,
    },
    capabilityLinkValues: [magic.queuedToken],
  });

  await db.batch([
    email.statement,
    prepareAuditLog(db, "admin", magic.admin.id, "admin_magic_link_requested", "admin_user", magic.admin.id, {
      email: magic.admin.email,
    }),
  ]);

  return { outboxId: email.id, adminFound: true };
}
