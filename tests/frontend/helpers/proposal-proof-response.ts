import { eventProposalProofVerifyResponseSchema } from "../../../assets/shared/schemas/event-proposal-proof";

export const proposalProofToken = "v".repeat(40);
export const proposalProofEndpoint = "/api/v1/events/pqc-2026/proposals/proof";

/** Supply the shared affiliation preview for ready organization proof fixtures. */
export function proposalProofResponse(body: unknown, status = 200) {
  const proof = eventProposalProofVerifyResponseSchema.safeParse(body);
  if (
    proof.success &&
    proof.data.status === "ready" &&
    proof.data.applicantKind === "organization" &&
    !proof.data.affiliation
  ) {
    const ready = proof.data;
    const domain = ready.email.split("@")[1];
    body = {
      ...ready,
      affiliation: {
        email: ready.email,
        domain,
        domains: [{ domain, canLink: false, organizationName: ready.organization?.name ?? null }],
        organization: ready.organization ? { id: ready.organization.id, name: ready.organization.name } : null,
        organizations: ready.organization
          ? [
              {
                id: ready.organization.id,
                name: ready.organization.name,
                identityId: null,
                jobTitle: ready.organization.jobTitle,
              },
            ]
          : [],
      },
    };
  }
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
