import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../../assets/shared/constants/email-domains";
import type { MemberJoinApplicantKind } from "../../../../../assets/shared/schemas/member-join";
import { prepareQueueEmailStatement } from "../../../email/outbox-queue";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { prepareAuditLog } from "../../audit";
import { newMemberJoinCapabilityPayload, queuedMemberJoinVerificationToken } from "./capabilities";

export async function startMemberJoin(
  db: DatabaseLike,
  input: {
    email: string;
    unaffiliatedAttestation: boolean;
    ttlMinutes: number;
    appBaseUrl: string;
  },
): Promise<
  { status: "unaffiliated_attestation_required"; outboxId: null } | { status: "verification_sent"; outboxId: string }
> {
  const domain = emailDomainOf(input.email);
  if (isDisposableEmailDomain(domain)) {
    throw new AppError(422, "DISPOSABLE_EMAIL_NOT_ALLOWED", "Disposable email providers are not accepted");
  }
  if (isPersonalEmailDomain(domain) && !input.unaffiliatedAttestation) {
    return { status: "unaffiliated_attestation_required", outboxId: null };
  }

  const applicantKind: MemberJoinApplicantKind = input.unaffiliatedAttestation ? "individual" : "organization";
  const capability = newMemberJoinCapabilityPayload(input.email, applicantKind);
  const queuedToken = queuedMemberJoinVerificationToken(capability, input.ttlMinutes * 60);
  const verificationUrl = `${input.appBaseUrl}/join/#verify=${encodeURIComponent(queuedToken)}`;
  const email = prepareQueueEmailStatement(db, {
    templateKey: "membership_join_verify",
    recipientEmail: input.email,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: "Verify your email address to join the PKI Consortium",
    capabilityLinkValues: [verificationUrl],
    data: { verificationUrl },
  });
  await db.batch([
    email.statement,
    prepareAuditLog(
      db,
      "system",
      null,
      "membership_join_verification_queued",
      "membership_join",
      capability.capabilityId,
      {
        domain,
        applicantKind,
      },
    ),
  ]);
  return { status: "verification_sent", outboxId: email.id };
}
