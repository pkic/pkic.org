import { IDENTITY_NOTIFICATION_EMAIL_TEMPLATE } from "../../../../assets/shared/email-template-actions";
import { first } from "../../db/queries";
import { prepareQueueEmailStatement, prepareQueueNoticeFromSelection } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

export interface IdentityNotificationContext {
  email: string;
  recipient_name: string;
  organization_name: string;
}

function activationCopy(organizationName: string) {
  return {
    subject: `Your identity for ${organizationName} is active`,
    message: `Your acting identity for ${organizationName} is now active.`,
  };
}

export const IDENTITY_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function loadIdentityNotificationContext(
  db: DatabaseLike,
  organizationId: string,
  userId: string,
  requireActiveUser: boolean,
): Promise<IdentityNotificationContext> {
  const context = await first<IdentityNotificationContext>(
    db,
    `SELECT user.email,
            trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')) AS recipient_name,
            organization.name AS organization_name
       FROM users user
       JOIN organizations organization ON organization.id = ?
      WHERE user.id = ? AND (? = 0 OR user.active = 1)`,
    [organizationId, userId, requireActiveUser ? 1 : 0],
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
    action: "invited" | "activated" | "reinstated" | "linked" | "blocked" | "ended";
    /** The email domain an automatic link followed. */
    domain?: string;
    invitationToken?: string;
    outboxId?: string;
    at: string;
  },
): StatementLike {
  if (input.action === "invited" && !input.invitationToken) {
    throw new AppError(500, "IDENTITY_INVITATION_LINK_MISSING", "Identity invitation link is required");
  }
  const messages = {
    invited: `An authorized contact invited you to act for ${input.context.organization_name}. Use the link below to review and accept this identity. If the link is unavailable, sign in to the portal and open Account Settings.`,
    activated: activationCopy(input.context.organization_name).message,
    reinstated: `Your acting identity for ${input.context.organization_name} is active again. Its end was removed, and the group seats and roles that ended with it are restored where they are still available.`,
    linked: `You're now linked to ${input.context.organization_name} (from your @${input.domain ?? ""} email). If this is not your organization, sign in to the portal and choose "Not my organization".`,
    blocked: `An authorized contact blocked your acting identity for ${input.context.organization_name}.`,
    ended: `Your acting identity for ${input.context.organization_name} has ended.`,
  } as const;
  const subjects = {
    invited: `Invitation to act for ${input.context.organization_name}`,
    activated: activationCopy(input.context.organization_name).subject,
    reinstated: `Your identity for ${input.context.organization_name} is active again`,
    linked: `You're now linked to ${input.context.organization_name}`,
    blocked: `Your identity for ${input.context.organization_name} was blocked`,
    ended: `Your identity for ${input.context.organization_name} ended`,
  } as const;
  return prepareQueueEmailStatement(
    db,
    {
      outboxId: input.outboxId ?? uuid(),
      idempotencyKey: `organization-identity:${input.identityId}:${input.action}:${input.at}`,
      templateKey: IDENTITY_NOTIFICATION_EMAIL_TEMPLATE.key,
      recipientUserId: input.userId,
      recipientEmail: input.context.email,
      subject: subjects[input.action],
      messageType: "transactional",
      data: {
        __subjectOverride: subjects[input.action],
        recipientName: input.context.recipient_name || input.context.email,
        organizationName: input.context.organization_name,
        changeMessage: messages[input.action],
        ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}),
      },
      capabilityLinkValues: input.invitationToken ? [input.invitationToken] : [],
    },
    input.at,
  ).statement;
}

/** Activation notices resolve names and the account address in the same atomic command. */
export function prepareIdentityActivationNotification(
  db: DatabaseLike,
  input: { identityId: string; userId: string; at: string },
): StatementLike {
  const copy = activationCopy("{{organizationName}}");
  return prepareQueueNoticeFromSelection(
    db,
    {
      outboxId: uuid(),
      templateKey: IDENTITY_NOTIFICATION_EMAIL_TEMPLATE.key,
      idempotencyKey: `organization-identity:${input.identityId}:activated:${input.at}`,
      at: input.at,
    },
    {
      sql: `SELECT person.id AS recipient_user_id,person.email AS recipient_email,
      replace(?,'{{organizationName}}',organization.name) AS subject,
      json_object('__subjectOverride',replace(?,'{{organizationName}}',organization.name),
        'recipientName',COALESCE(NULLIF(trim(COALESCE(person.first_name,'') || ' ' || COALESCE(person.last_name,'')),''),person.email),
        'organizationName',organization.name,
        'changeMessage',replace(?,'{{organizationName}}',organization.name)) AS payload_json
      FROM identities identity JOIN users person ON person.id=identity.user_id
      JOIN organizations organization ON organization.id=identity.organization_id
      WHERE identity.id=? AND identity.user_id=? AND identity.started_at IS NOT NULL`,
      bindings: [copy.subject, copy.subject, copy.message, input.identityId, input.userId],
    },
  );
}

/** Stop unsent invitation mail after activation or cancellation; sent mail stays in the outbox. */
export function prepareCancelIdentityInvitationEmails(db: DatabaseLike, identityId: string, at: string): StatementLike {
  const prefix = `organization-identity:${identityId}:invited:`;
  return db
    .prepare(
      "UPDATE email_outbox SET status='cancelled',updated_at=? WHERE template_key=? AND status IN ('queued','retrying') AND substr(idempotency_key,1,length(?))=?",
    )
    .bind(at, IDENTITY_NOTIFICATION_EMAIL_TEMPLATE.key, prefix, prefix);
}
