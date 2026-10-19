import { env } from "cloudflare:workers";
import { callApi } from "./app";
import { createMemberSession } from "./auth";
import { seedEventAndAdmin } from "./context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./membership";
import { withIndependentCapacity } from "./independent-capacity";
import { proposalCreateSchema } from "../../assets/shared/schemas/proposal-management";

export async function proposalIdentityFixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const email = `proposal-identity-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare(
    "UPDATE users SET first_name='Identity',last_name='Speaker',email_verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),email_verification_method='magic_link' WHERE id=?",
  )
    .bind(userId)
    .run();
  const organizationId = await insertOrganization(env.DB, "Chosen organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Chosen role" });
  const otherOrganization = await insertOrganization(env.DB, "Other organization");
  const otherMember = await seedOrganizationAggregate(env.DB, otherOrganization, "A");
  const secondIdentityId = await addRepresentative(env.DB, otherMember, userId, { jobTitle: "Second role" });
  const token = await createMemberSession(env.DB, userId, crypto.randomUUID(), undefined, identityId);
  const body = proposalCreateSchema.parse({
    sourceType: "direct",
    proposer: {
      email,
      firstName: "Identity",
      lastName: "Speaker",
      actingIdentityId: identityId,
      bio: "An experienced speaker with a detailed biography for the proposed conference session.",
    },
    proposal: {
      type: "Talk",
      title: "Deliberate speaker identity selection",
      abstract:
        "A detailed presentation about choosing a deliberate speaker representation, keeping proposal affiliation independent of later account changes, and preserving approved historical appearances.",
    },
    consents: [{ termKey: "speaker-terms", version: "v1" }],
  });
  return { eventId, userId, email, identityId, secondIdentityId, token, body };
}

export function submitIdentityProposal(body: Record<string, unknown>, token?: string) {
  return callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(withIndependentCapacity(body)),
  });
}
