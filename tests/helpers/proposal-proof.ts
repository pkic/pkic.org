import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { speakerProfileUpdateResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { expect } from "vitest";
import {
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import type { Env } from "../../functions/_lib/types";
import { callApi } from "./app";
import { deliveredEmailPayload, queryAll } from "./context";

/** Explicit positive-fixture mailbox authorization through the mounted email API. */
export async function prepareProposalProof(input: {
  environment: Env;
  eventSlug: string;
  email: string;
  consents: Array<{ termKey: string; version: string }>;
  unaffiliatedAttestation: boolean;
  speakerManagementToken?: string;
}) {
  const body = eventProposalProofStartSchema.parse({
    email: input.email,
    consents: input.consents,
    unaffiliatedAttestation: input.unaffiliatedAttestation,
    speakerManagementToken: input.speakerManagementToken,
  });
  const environment = input.environment;
  if (!environment.INTERNAL_SIGNING_SECRET)
    throw new Error("Proposal proof requires the exact environment signing secret.");
  const previous = await queryAll<{ id: string }>(environment.DB, "SELECT id FROM email_outbox");
  const request = (suffix: string, payload: unknown) =>
    callApi(environment, `/api/v1/events/${input.eventSlug}/proposals/proof${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const started = await request("", body);
  const startedBody = await started.json();
  expect(started.status, JSON.stringify(startedBody)).toBe(200);
  expect(eventProposalProofStartResponseSchema.parse(startedBody).status).toBe("verification_sent");
  const rows = await queryAll<{ id: string; payload_json: string }>(
    environment.DB,
    "SELECT id, payload_json FROM email_outbox WHERE template_key = 'event_proposal_verify' AND recipient_email = ? AND recipient_user_id IS NULL",
    body.email,
  );
  const queued = rows.filter((row) => !previous.some((before) => before.id === row.id));
  expect(queued).toHaveLength(1);
  const delivered = await deliveredEmailPayload<{ verificationUrl: string }>(
    environment.DB,
    environment,
    queued[0].payload_json,
  );
  const token = new URLSearchParams(new URL(delivered.verificationUrl).hash.slice(1)).get("verify");
  const verified = await request(
    "/verify",
    eventProposalProofVerifySchema.parse({ token, speakerManagementToken: input.speakerManagementToken }),
  );
  const verifiedBody = await verified.json();
  expect(verified.status, JSON.stringify(verifiedBody)).toBe(200);
  const proof = eventProposalProofVerifyResponseSchema.parse(verifiedBody);
  if (proof.status !== "ready") throw new Error("The explicit proposal fixture requires a ready verified mailbox.");
  expect(proof.email).toBe(body.email);
  expect(proof.applicantKind).toBe(body.unaffiliatedAttestation ? "individual" : "organization");
  return {
    continuationToken: proof.continuationToken,
    unaffiliatedAttestation: body.unaffiliatedAttestation,
    ...(proof.speakerManagementToken ? { speakerManagementToken: proof.speakerManagementToken } : {}),
  };
}

/** Explicit positive speaker fixture; never silently qualifies every invitation. */
export async function selectIndividualSpeakerRepresentation(input: {
  environment: Env;
  eventSlug: string;
  email: string;
  consents: Array<{ termKey: string; version: string }>;
  speakerManagementToken: string;
}): Promise<void> {
  const proof = await prepareProposalProof({
    ...input,
    unaffiliatedAttestation: true,
  });
  const selectedToken = proof.speakerManagementToken ?? input.speakerManagementToken;
  const response = await callApi(input.environment, `/api/v1/proposals/speakers/access/${selectedToken}/profile`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      speakerSelfProfilePatchSchema.parse({
        continuationToken: proof.continuationToken,
        unaffiliatedAttestation: true,
        actingIdentityId: null,
        organizationName: null,
        jobTitle: null,
        consents: input.consents,
      }),
    ),
  });
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  const saved = speakerProfileUpdateResponseSchema.parse(result);
  expect(saved.currentRepresentation?.actingIdentitySelection).toBe("individual");
  expect(saved.currentRepresentation?.actingIdentityId).toBeNull();
}
