import { prepareVerifiedAffiliationRead } from "../identities/verified-affiliation-read";
import { verifiedAffiliationPreview } from "../identities/verified-affiliation-preview";
import { planRegistrationAffiliation } from "./affiliation-plan";
import { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import type { registrationEmailProofVerifySchema } from "../../../../assets/shared/schemas/registration-email-proof";
import { signEventAffiliationContext } from "../identities/event-affiliation-context";
import { nowIso } from "../../utils/time";
import { batchFirst } from "../../db/pagination";
/**
 * A registration that waits for email confirmation proves its mailbox with the
 * confirmation link. That link is exchanged for a short-lived, stateless proof
 * bound to the pending registration, which lets the confirmation page ask
 * which organization a work address names before the person confirms.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "../../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import type { RegistrationEmailProofVerifyResponse } from "../../../../assets/shared/schemas/registration-email-proof";
import { decodeCapabilityPayload, encodeCapabilityPayload } from "../../auth/capability-payload";
import { signStatelessCapabilityToken, verifyStatelessCapabilityToken } from "../../auth/capability-links";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

const PURPOSE = "registration_email_verify";

const proofPayloadSchema = z
  .object({
    eventId: databaseIdSchema,
    email: normalizedEmailSchema,
    unaffiliatedAttestation: z.boolean(),
    binding: z.object({
      userId: databaseIdSchema,
      registrationId: databaseIdSchema,
      revision: z.number().int().nonnegative(),
    }),
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
function registrationProofOwner(proof: RegistrationEmailProof) {
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

/** The confirmed address a proof names; refuses one that expired or was not issued here. */
async function readRegistrationEmailProof(signingSecret: string, token: string): Promise<RegistrationEmailProof> {
  const verified = await verifyStatelessCapabilityToken({ signingSecret, purpose: PURPOSE, token });
  if (!verified.ok)
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      "REGISTRATION_EMAIL_PROOF_INVALID",
      verified.reason === "expired"
        ? "This confirmation link has expired. Open the latest confirmation email."
        : "This confirmation link is not valid. Open the latest confirmation email.",
    );
  const payload = decodeCapabilityPayload(verified.resourceId, proofPayloadSchema);
  if (!payload)
    throw new AppError(
      404,
      "REGISTRATION_EMAIL_PROOF_INVALID",
      "This confirmation link is not valid. Open the latest confirmation email.",
    );
  return payload;
}

/** What the confirmation page asks once the confirmation link is opened. */
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
        { verifiedAt: nowIso() },
      );
  const results = await db.batch([
    db.prepare("SELECT id FROM events WHERE id=? AND slug=?").bind(proof.eventId, input.eventSlug),
    db.prepare(`SELECT id,first_name,last_name FROM users WHERE id=(${owner.sql})`).bind(...owner.bindings),
    ...(affiliation?.statements ?? []),
  ]);
  if (!batchFirst(results[0])) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const person = batchFirst<{ id: string; first_name: string | null; last_name: string | null }>(results[1]);
  if (!person)
    throw new AppError(409, "REGISTRATION_CHANGED", "Your registration changed. Open the latest confirmation email.");
  const observed = affiliation?.decode(results.slice(2));
  const preview = observed ? verifiedAffiliationPreview(observed.basis, observed.address) : null;
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
