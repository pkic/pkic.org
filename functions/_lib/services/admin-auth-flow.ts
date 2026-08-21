import { prepareAdminMagicLink } from "../auth/admin";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import type { DatabaseLike } from "../types";
import { prepareAuditLog } from "./audit";

export async function requestAdminSignInLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash: string | null;
    userAgentHash: string | null;
    ttlMinutes: number;
    appBaseUrl: string;
  },
): Promise<{ outboxId: string | null; adminFound: boolean }> {
  const magic = await prepareAdminMagicLink(db, payload);
  if (!magic.token || !magic.admin || !magic.statement) {
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
      magicLinkUrl: `${payload.appBaseUrl}/admin/?token=${encodeURIComponent(magic.token)}`,
      expiresInMinutes: payload.ttlMinutes,
    },
  });

  await db.batch([
    magic.statement,
    email.statement,
    prepareAuditLog(db, "admin", magic.admin.id, "admin_magic_link_requested", "admin_user", magic.admin.id, {
      email: magic.admin.email,
    }),
  ]);

  return { outboxId: email.id, adminFound: true };
}
