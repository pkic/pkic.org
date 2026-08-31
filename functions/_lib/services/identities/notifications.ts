import { first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

export interface IdentityNotificationContext {
  email: string;
  recipient_name: string;
  organization_name: string;
}

export async function loadIdentityNotificationContext(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  requireActiveUser: boolean,
): Promise<IdentityNotificationContext> {
  const context = await first<IdentityNotificationContext>(
    db,
    `SELECT user.email,
            trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')) AS recipient_name,
            organization.name AS organization_name
       FROM users user
       JOIN members member ON member.id = ? AND member.organization_id IS NOT NULL
       JOIN organizations organization ON organization.id = member.organization_id
      WHERE user.id = ? AND (? = 0 OR user.active = 1)`,
    [memberId, userId, requireActiveUser ? 1 : 0],
  );
  if (!context) throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
  return context;
}

export function prepareIdentityNotification(
  db: DatabaseLike,
  input: {
    identityId: string;
    userId: string;
    context: IdentityNotificationContext;
    action: "invited" | "activated" | "blocked" | "ended";
    at: string;
  },
): StatementLike {
  const messages = {
    invited: `An authorized contact invited you to act for ${input.context.organization_name}. Sign in to the portal to review and accept this identity.`,
    activated: `Your acting identity for ${input.context.organization_name} is now active.`,
    blocked: `An authorized contact blocked your acting identity for ${input.context.organization_name}.`,
    ended: `Your acting identity for ${input.context.organization_name} has ended.`,
  } as const;
  const subjects = {
    invited: `Invitation to act for ${input.context.organization_name}`,
    activated: `Your identity for ${input.context.organization_name} is active`,
    blocked: `Your identity for ${input.context.organization_name} was blocked`,
    ended: `Your identity for ${input.context.organization_name} ended`,
  } as const;
  return prepareQueueEmailStatement(
    db,
    {
      outboxId: uuid(),
      idempotencyKey: `organization-identity:${input.identityId}:${input.action}:${input.at}`,
      templateKey: "organization-identity-changed",
      recipientUserId: input.userId,
      recipientEmail: input.context.email,
      subject: subjects[input.action],
      messageType: "transactional",
      data: {
        recipientName: input.context.recipient_name || input.context.email,
        organizationName: input.context.organization_name,
        changeMessage: messages[input.action],
      },
    },
    input.at,
  ).statement;
}
