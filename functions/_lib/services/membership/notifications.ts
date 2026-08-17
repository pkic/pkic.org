/**
 * Membership notification-intent draft builders (PR #1 review §1.5).
 *
 * Each builder returns the exact payload shape `queueEmail` (the generic
 * outbox helper, functions/_lib/email/outbox.ts) accepts — no delivery or
 * outbox SQL of its own, no `db`/`env` access. Callers still own
 * `queueEmail(db, draft)` + `processOutboxByIdBackground(db, env, outboxId)`
 * themselves, same as before this split.
 *
 * Pulled out of scheduled-jobs.ts and the two approveApplication callers
 * (admin/applications/[id]/approve.ts and scheduled-jobs.ts's
 * runEcWindowAutoApprove) — those two built near-identical
 * member-account-claim and application-approved-welcome payloads
 * independently; buildMemberAccountClaimEmail and
 * buildApplicationApprovedWelcomeEmail are now the one definition both use.
 */
import type { queueEmail } from "../../email/outbox";

export type EmailDraft = Parameters<typeof queueEmail>[1];

function maskEmail(email: string): string {
  const [, domain] = email.split("@");
  return domain ? `***@${domain}` : "***";
}

export function buildConsultationBatchEmail(params: {
  recipientEmail: string;
  applications: Array<{ applicantEmail: string; organizationName: string; membershipCategory: string }>;
}): EmailDraft {
  return {
    templateKey: "consultation-batch",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: `PKI Consortium member consultation — ${params.applications.length} application(s)`,
    data: {
      applicationCount: params.applications.length,
      applications: params.applications.map((a) => ({
        maskedEmail: maskEmail(a.applicantEmail),
        organizationName: a.organizationName,
        membershipCategory: a.membershipCategory,
      })),
    },
  };
}

export function buildEcReviewBatchEmail(params: {
  recipientEmail: string;
  ecReviewWindowDays: number;
  applications: Array<{ organizationName: string; membershipCategory: string; reviewUrl: string }>;
}): EmailDraft {
  return {
    templateKey: "ec-review-batch",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: `PKI Consortium EC review — ${params.applications.length} application(s)`,
    data: {
      applicationCount: params.applications.length,
      ecReviewWindowDays: params.ecReviewWindowDays,
      applications: params.applications,
    },
  };
}

export function buildApplicationClosedNoResponseEmail(params: {
  recipientEmail: string;
  applicantName: string;
  deadlineDays: number;
}): EmailDraft {
  return {
    templateKey: "application-closed-no-response",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "Your PKI Consortium membership application has been closed",
    data: { applicantName: params.applicantName, deadlineDays: params.deadlineDays },
  };
}

export function buildOnHoldReminderEmail(params: {
  templateKey: string;
  recipientEmail: string;
  applicantName: string;
  deadlineDays: number;
}): EmailDraft {
  return {
    templateKey: params.templateKey,
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "Reminder: action needed on your PKI Consortium membership application",
    data: { applicantName: params.applicantName, deadlineDays: params.deadlineDays },
  };
}

export function buildMemberAccountClaimEmail(params: {
  recipientEmail: string;
  memberName: string;
  loginUrl: string;
}): EmailDraft {
  return {
    templateKey: "member-account-claim",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "Set up your PKI Consortium member account",
    data: { memberName: params.memberName, loginUrl: params.loginUrl },
  };
}

export function buildApplicationApprovedWelcomeEmail(params: {
  recipientEmail: string;
  applicantName: string;
  loginUrl: string;
  workingGroupNames: string[];
  icsAttachments?: EmailDraft["attachments"];
}): EmailDraft {
  return {
    templateKey: "application-approved-welcome",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "Welcome to the PKI Consortium!",
    data: {
      applicantName: params.applicantName,
      loginUrl: params.loginUrl,
      workingGroups: params.workingGroupNames.join(", "),
    },
    attachments: params.icsAttachments,
  };
}

export function buildOrgContactAssignedEmail(params: {
  recipientEmail: string;
  memberName: string;
  contactRole: string;
}): EmailDraft {
  return {
    templateKey: "org-contact-assigned",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "You have been designated an organization contact",
    data: { memberName: params.memberName, contactRole: params.contactRole },
  };
}

export function buildMailingListEnrolledEmail(params: {
  recipientEmail: string;
  memberName: string;
  lists: string[];
}): EmailDraft {
  return {
    templateKey: "mailing-list-enrolled",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: "You have been added to PKI Consortium mailing lists",
    data: { memberName: params.memberName, lists: params.lists },
  };
}

export function buildWgCalendarInviteEmail(params: {
  recipientEmail: string;
  memberName: string;
  workingGroupName: string;
  attachments: EmailDraft["attachments"];
}): EmailDraft {
  return {
    templateKey: "wg-calendar-invite",
    recipientEmail: params.recipientEmail,
    messageType: "transactional",
    subject: `Calendar invite: ${params.workingGroupName}`,
    data: { memberName: params.memberName, workingGroupName: params.workingGroupName },
    attachments: params.attachments,
  };
}
