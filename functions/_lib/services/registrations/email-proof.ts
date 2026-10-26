/**
 * Registration verifies the address first. The email-first step queues a
 * signed, short-lived link through the durable outbox; opening it brings the
 * person back to the registration form with the address verified, and the
 * submission carries the same link as its proof, so the registration is final
 * when it is submitted rather than after a second confirmation email.
 *
 * The link is stateless: it names the event, the address and the capacity the
 * person chose, and nothing is stored until they register.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "../../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import type {
  RegistrationEmailProofVerifyResponse,
  registrationEmailProofStartSchema,
} from "../../../../assets/shared/schemas/registration-email-proof";
import { decodeCapabilityPayload, encodeCapabilityPayload } from "../../auth/capability-payload";
import { queuedCapabilityToken, verifyStatelessCapabilityToken } from "../../auth/capability-links";
import { checkEmailDomainMx } from "../../email/mx-check";
import { prepareQueueEmailStatement } from "../../email/outbox-queue";
import { emailPlainText } from "../../email/plain-text";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { EventRecord } from "../events";
import { registrationPageUrl } from "../frontend-links";
import { userRecordColumns, type UserRecord } from "../users";
import { first } from "../../db/queries";
import { readEmailOwnership, provedMailboxUserId } from "../email-ownership";
import { registrationAsksOrganization } from "./confirmation-organization";

const PURPOSE = "registration_email_verify";

const proofPayloadSchema = z
  .object({ eventId: databaseIdSchema, email: normalizedEmailSchema, unaffiliatedAttestation: z.boolean() })
  .strict();
export type RegistrationEmailProof = z.infer<typeof proofPayloadSchema>;

/** Whether an event takes registrations at all; an automatic meeting invites its group itself. */
export function eventTakesRegistrations(registrationMode: string): boolean {
  return registrationMode !== "no_registration" && registrationMode !== "automatic";
}

export async function startRegistrationEmailProof(
  db: DatabaseLike,
  input: {
    event: EventRecord;
    body: z.infer<typeof registrationEmailProofStartSchema>;
    appBaseUrl: string;
    ttlSeconds: number;
  },
): Promise<{ status: "verification_sent"; outboxId: string }> {
  if (!eventTakesRegistrations(input.event.registration_mode))
    throw new AppError(403, "EVENT_REGISTRATION_DISABLED", "This event does not use registration");
  // A link to a domain that takes no mail would never arrive; say so now rather than leave the person waiting.
  if (!(await checkEmailDomainMx(input.body.email)).hasMxRecords)
    throw new AppError(
      422,
      "EMAIL_DOMAIN_INVALID",
      "The email domain does not appear to accept mail. Please check the address and try again.",
      { email: "This email domain does not accept mail. Check the address." },
    );
  const payload: RegistrationEmailProof = {
    eventId: input.event.id,
    email: input.body.email,
    unaffiliatedAttestation: input.body.unaffiliatedAttestation,
  };
  const expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  // Delivery signs this marker with the Worker secret; D1 never stores a usable link.
  const token = queuedCapabilityToken(
    PURPOSE,
    encodeCapabilityPayload(payload),
    input.ttlSeconds,
    undefined,
    expiresAt,
  );
  const entry = input.body.entry ?? {};
  const verificationUrl = `${registrationPageUrl(input.appBaseUrl, input.event, {
    invite: entry.inviteToken,
    inviteId: entry.inviteId,
    ref: entry.referralCode,
    source: entry.sourceType,
  })}#verify=${encodeURIComponent(token)}`;
  const email = prepareQueueEmailStatement(db, {
    eventId: input.event.id,
    templateKey: "registration_email_verify",
    recipientEmail: payload.email,
    recipientUserId: null,
    messageType: "transactional",
    subject: `Verify your email for ${input.event.name}`,
    capabilityLinkValues: [verificationUrl],
    data: { verificationUrl, eventName: emailPlainText(input.event.name) },
  });
  await db.batch([email.statement]);
  return { status: "verification_sent", outboxId: email.id };
}

/** The verified address a link names, for this event; refuses a link for another event, or one that expired. */
export async function readRegistrationEmailProof(
  signingSecret: string,
  token: string,
  eventId: string,
): Promise<RegistrationEmailProof> {
  const verified = await verifyStatelessCapabilityToken({ signingSecret, purpose: PURPOSE, token });
  if (!verified.ok)
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      "REGISTRATION_EMAIL_PROOF_INVALID",
      verified.reason === "expired"
        ? "This verification link has expired. Enter your email again to get a new one."
        : "This verification link is not valid. Enter your email again to get a new one.",
    );
  const payload = decodeCapabilityPayload(verified.resourceId, proofPayloadSchema);
  if (!payload || payload.eventId !== eventId)
    throw new AppError(
      404,
      "REGISTRATION_EMAIL_PROOF_INVALID",
      "This verification link is not valid. Enter your email again to get a new one.",
    );
  return payload;
}

/** What the form continues with once the link is opened. */
export async function verifyRegistrationEmailProof(
  db: DatabaseLike,
  input: { signingSecret: string; token: string; eventId: string },
): Promise<RegistrationEmailProofVerifyResponse> {
  const proof = await readRegistrationEmailProof(input.signingSecret, input.token, input.eventId);
  const ownerId = provedMailboxUserId(await readEmailOwnership(db, proof.email));
  const user = ownerId
    ? await first<UserRecord>(db, `SELECT ${userRecordColumns()} FROM users WHERE id=?`, [ownerId])
    : null;
  return {
    email: proof.email,
    unaffiliatedAttestation: proof.unaffiliatedAttestation,
    person: user ? { firstName: user.first_name, lastName: user.last_name } : null,
    asksOrganization:
      !proof.unaffiliatedAttestation &&
      (await registrationAsksOrganization(db, { userId: user?.id ?? null, normalizedEmail: proof.email })),
  };
}

/** A submission's proof must name the address, capacity and event it registers. */
export async function requireRegistrationEmailProof(
  signingSecret: string,
  input: { token: string; eventId: string; email: string; unaffiliatedAttestation: boolean },
): Promise<void> {
  const proof = await readRegistrationEmailProof(signingSecret, input.token, input.eventId);
  if (proof.email !== input.email || proof.unaffiliatedAttestation !== input.unaffiliatedAttestation)
    throw new AppError(
      422,
      "REGISTRATION_EMAIL_PROOF_MISMATCH",
      "Register with the email address you verified, or verify the new one.",
    );
}
