import { prepareVerifiedAffiliationRead } from "../identities/verified-affiliation-read";
import { verifiedAffiliationPreview } from "../identities/verified-affiliation-preview";
import { planRegistrationAffiliation } from "./affiliation-plan";
import { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import type { registrationEmailProofVerifySchema } from "../../../../assets/shared/schemas/registration-email-proof";
import { provedMailboxUserIdSelection } from "../email-ownership";
import { signEventAffiliationContext } from "../identities/event-affiliation-context";
import { nowIso } from "../../utils/time";
import { batchFirst } from "../../db/pagination";
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
import {
  signStatelessCapabilityToken,
  queuedCapabilityToken,
  verifyStatelessCapabilityToken,
} from "../../auth/capability-links";
import { checkEmailDomainMx } from "../../email/mx-check";
import { prepareQueueEmailStatement } from "../../email/outbox-queue";
import { emailPlainText } from "../../email/plain-text";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { EventRecord } from "../events";
import { registrationPageUrl } from "../frontend-links";

const PURPOSE = "registration_email_verify";

const proofPayloadSchema = z
  .object({
    eventId: databaseIdSchema,
    email: normalizedEmailSchema,
    unaffiliatedAttestation: z.boolean(),
    binding: z
      .object({ userId: databaseIdSchema, registrationId: databaseIdSchema, revision: z.number().int().nonnegative() })
      .optional(),
  })
  .strict();
export type RegistrationEmailProof = z.infer<typeof proofPayloadSchema>;

/** Exchange an already verified confirmation capability without another email challenge. */
export function registrationConfirmationMailboxProof(secret: string, proof: RegistrationEmailProof, expiresAt: number) {
  return signStatelessCapabilityToken({
    signingSecret: secret,
    purpose: PURPOSE,
    resourceId: encodeCapabilityPayload(proofPayloadSchema.parse(proof)),
    ttlSeconds: Math.max(1, Math.min(600, expiresAt - Math.floor(Date.now() / 1000))),
  });
}

/** A confirmation's mailbox proof remains bound to the same pending registration and account. */
export function registrationProofOwner(proof: RegistrationEmailProof) {
  if (!proof.binding) return provedMailboxUserIdSelection(proof.email);
  return {
    sql: `SELECT person.id FROM users person JOIN registrations registration ON registration.user_id=person.id
      WHERE person.id=? AND registration.id=? AND registration.transition_revision=?
        AND registration.status='pending_email_confirmation' AND person.active=1
        AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
        AND (person.normalized_email=? OR (person.pending_email=? AND person.pending_email_change_registration_id=registration.id))`,
    bindings: [proof.binding.userId, proof.binding.registrationId, proof.binding.revision, proof.email, proof.email],
  };
}

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
  eventId?: string,
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
  if (!payload || (eventId !== undefined && payload.eventId !== eventId))
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
  input: {
    signingSecret: string;
    token: string;
    eventSlug: string;
    domain?: string;
    affiliation?: z.infer<typeof registrationEmailProofVerifySchema>["affiliation"];
  },
): Promise<RegistrationEmailProofVerifyResponse> {
  const proof = await readRegistrationEmailProof(input.signingSecret, input.token);
  const owner = registrationProofOwner(proof);
  const affiliation = proof.unaffiliatedAttestation
    ? null
    : prepareVerifiedAffiliationRead(
        db,
        owner,
        {
          email: proof.email,
          emailId: null,
          domain: input.affiliation?.domain ?? input.domain,
          organizationName: input.affiliation?.organizationName,
        },
        { verifiedAt: nowIso(), pendingApplicationReview: true },
      );
  const results = await db.batch([
    db.prepare("SELECT id FROM events WHERE id=? AND slug=?").bind(proof.eventId, input.eventSlug),
    db.prepare(`SELECT id,first_name,last_name FROM users WHERE id=(${owner.sql})`).bind(...owner.bindings),
    ...(affiliation?.statements ?? []),
  ]);
  if (!batchFirst(results[0])) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const person = batchFirst<{ id: string; first_name: string | null; last_name: string | null }>(results[1]);
  if (proof.binding && !person)
    throw new AppError(409, "REGISTRATION_CHANGED", "Your registration changed. Open the latest confirmation email.");
  const observed = affiliation?.decode(results.slice(2));
  const preview = observed
    ? verifiedAffiliationPreview(observed.basis, observed.address, { pendingApplicationReview: true })
    : null;
  if (input.affiliation && observed && preview) {
    const selection = identityAffiliationPrepareSchema.parse({
      ...input.affiliation,
      phase: "prepare",
      email: proof.email,
      emailId: observed.address.id,
    });
    if (selection.organizationId && !preview.organizations.some((item) => item.id === selection.organizationId))
      throw new AppError(
        422,
        "IDENTITY_DOMAIN_MISMATCH",
        "Choose an organization confirmed by your verified work domain.",
      );
    await planRegistrationAffiliation(
      db,
      { userId: crypto.randomUUID(), proofEvidence: { sql: "SELECT 1", bindings: [] } },
      selection,
      { ...observed.basis, identities: [], emailOwner: null },
      nowIso(),
    );
    preview.contextToken = await signEventAffiliationContext(
      input.signingSecret,
      {
        eventId: proof.eventId,
        input: selection,
        basis: observed.basis,
      },
      "registration-affiliation",
    );
  }
  return {
    email: proof.email,
    unaffiliatedAttestation: proof.unaffiliatedAttestation,
    person: person ? { userId: person.id, firstName: person.first_name, lastName: person.last_name } : null,
    asksOrganization: !proof.unaffiliatedAttestation,
    affiliation: preview,
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
