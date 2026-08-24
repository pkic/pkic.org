import { first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

export interface RepresentationNotificationContext {
  email: string;
  recipient_name: string;
  organization_name: string;
}

export async function loadRepresentationNotificationContext(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  requireActiveUser: boolean,
): Promise<RepresentationNotificationContext> {
  const context = await first<RepresentationNotificationContext>(
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

export function prepareRepresentationNotification(
  db: DatabaseLike,
  input: {
    representativeId: string;
    userId: string;
    context: RepresentationNotificationContext;
    action: "associated" | "blocked" | "restored";
    at: string;
  },
): StatementLike {
  const messages = {
    associated: `An authorized contact has associated your account with ${input.context.organization_name}.`,
    blocked: `An authorized contact has removed your representative access for ${input.context.organization_name}.`,
    restored: `An authorized contact has restored your representative access for ${input.context.organization_name}.`,
  } as const;
  const subjects = {
    associated: `You now represent ${input.context.organization_name}`,
    blocked: `Your representative access for ${input.context.organization_name} was removed`,
    restored: `Your representative access for ${input.context.organization_name} was restored`,
  } as const;
  return prepareQueueEmailStatement(
    db,
    {
      outboxId: uuid(),
      idempotencyKey: `organization-representative:${input.representativeId}:${input.action}:${input.at}`,
      templateKey: "organization-representation-changed",
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
