/**
 * Security notices about an account's addresses. Every verified address can
 * sign in, so adding, removing or promoting one, and the first sign-in through
 * an added one, is told to the account's primary address and to the address
 * concerned: whoever controls either mailbox learns of a change they did not make.
 * Each notice is queued in the same batch as the change it reports.
 */
import { prepareQueueEmailStatement, prepareQueueEmailStatementWhen } from "../email/outbox-queue";
import type { DatabaseLike, StatementLike } from "../types";
import { normalizeEmail } from "../validation";

export const ACCOUNT_SECURITY_NOTICE_TEMPLATE = "account_security_notice";

export type AccountSecurityChange = "address_added" | "address_removed" | "primary_changed" | "first_sign_in";

const SUBJECTS: Record<AccountSecurityChange, string> = {
  address_added: "An email address was added to your PKI Consortium account",
  address_removed: "An email address was removed from your PKI Consortium account",
  primary_changed: "Your PKI Consortium primary email address changed",
  first_sign_in: "New sign-in with an email address on your PKI Consortium account",
};

interface SecurityNotice {
  userId: string;
  change: AccountSecurityChange;
  /** The address the change is about. */
  address: string;
  /** Who else hears of it: the primary address, and the former one when the primary changes. */
  alsoTo: string[];
  at: string;
}

function recipients(notice: SecurityNotice): string[] {
  const seen = new Set<string>();
  return [notice.address, ...notice.alsoTo].filter((email) => {
    const normalized = normalizeEmail(email);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function noticePayload(notice: SecurityNotice, recipientEmail: string) {
  return {
    templateKey: ACCOUNT_SECURITY_NOTICE_TEMPLATE,
    recipientEmail,
    recipientUserId: notice.userId,
    eventId: null,
    messageType: "transactional" as const,
    subject: SUBJECTS[notice.change],
    data: {
      [notice.change]: true,
      address: notice.address,
      userId: notice.userId,
      recipientEmail,
      changedAt: notice.at,
    },
  };
}

/** Queues one notice per distinct mailbox. */
export function prepareAccountSecurityNoticeStatements(db: DatabaseLike, notice: SecurityNotice): StatementLike[] {
  return recipients(notice).map(
    (recipientEmail) => prepareQueueEmailStatement(db, noticePayload(notice, recipientEmail), notice.at).statement,
  );
}

/**
 * Marks the first sign-in through an added address and tells both mailboxes,
 * once: the notices go out only when this batch is the one that set the mark.
 */
export function prepareFirstAddressSignInStatements(
  db: DatabaseLike,
  input: { userId: string; primaryEmail: string; emailId: string; email: string; at: string },
): StatementLike[] {
  const notice: SecurityNotice = {
    userId: input.userId,
    change: "first_sign_in",
    address: input.email,
    alsoTo: [input.primaryEmail],
    at: input.at,
  };
  const markedNow = {
    sql: "SELECT 1 FROM user_emails WHERE id = ? AND user_id = ? AND first_signed_in_at = ?",
    bindings: [input.emailId, input.userId, input.at],
  };
  return [
    db
      .prepare(
        "UPDATE user_emails SET first_signed_in_at = ? WHERE id = ? AND user_id = ? AND first_signed_in_at IS NULL",
      )
      .bind(input.at, input.emailId, input.userId),
    ...recipients(notice).map(
      (recipientEmail) =>
        prepareQueueEmailStatementWhen(db, noticePayload(notice, recipientEmail), markedNow, input.at).statement,
    ),
  ];
}
