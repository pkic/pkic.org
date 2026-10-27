/** Email proof and domain policy are production services; these adapters compose one batch per request. */
import { z } from "zod";
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { prepareClaimDomainForOrganization } from "../membership/organization-domain-claims";
import {
  identityAffiliationPrepareSchema,
  identityAffiliationPreviewResponseSchema,
  type identityAffiliationPreviewSchema,
} from "../../../../assets/shared/schemas/identity-affiliation";
import { resolveDomainOrganization } from "../../../../assets/shared/organization-domain";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { signJwt, verifyJwt } from "../../utils/jwt";
import { isAuditChangeGuardFailure, prepareAuditLog } from "../audit";
import { prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { isConcurrentIdentityConflict } from "./conflicts";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { prepareVerifiedAffiliationRead } from "./verified-affiliation-read";
import { verifiedDomainOrganizationId, verifiedRepresentationDomainCandidates } from "./verified-email-domain";

const contextSchema = z.object({
  typ: z.literal("verified-affiliation"),
  userId: z.string(),
  sessionId: z.string(),
  exp: z.number(),
  input: identityAffiliationPrepareSchema,
  basis: verifiedAffiliationBasisSchema,
});
async function affiliationPlan(
  db: DatabaseLike,
  claims: { sub: string; sid: string },
  input: z.infer<typeof identityAffiliationPrepareSchema>,
  basis: z.infer<typeof verifiedAffiliationBasisSchema>,
  at: string,
) {
  const domainToLink =
    input.domain && basis.domain !== workEmailDomain(input.email) && !basis.claim ? basis.domain : null;
  if (
    domainToLink &&
    (!verifiedRepresentationDomainCandidates(input.email, basis.claims).includes(domainToLink) ||
      basis.claims.some((claim) => claim.applicationId))
  )
    throw new AppError(
      409,
      "IDENTITY_DOMAIN_UNAVAILABLE",
      "This email domain cannot be linked. Choose another domain.",
    );
  const plan = await prepareVerifiedOrganizationAffiliation(
    db,
    {
      userId: claims.sub,
      normalizedEmail: input.email,
      emailId: input.emailId,
      organizationName: input.organizationName,
      organizationId: input.organizationId ?? undefined,
      organizationChoice: { organizationId: input.organizationId },
      profile: { jobTitle: input.jobTitle },
      at,
      proofEvidence: {
        sql: `SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?`,
        bindings: [claims.sid, claims.sub, at],
      },
    },
    basis,
  );
  return { ...plan, domainToLink };
}

export async function previewOwnAffiliation(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  input: z.infer<typeof identityAffiliationPreviewSchema>,
) {
  const actor = await prepareUserSessionRequest(db, request, env);
  const source = prepareVerifiedAffiliationRead(db, actor.claims.sub, input);
  const results = await db.batch([...actor.statements, ...source.statements]);
  await actor.decode(results.slice(0, actor.statements.length));
  const { basis, address } = source.decode(results.slice(actor.statements.length));
  if (input.phase === "resolve" && input.unaffiliatedAttestation) {
    const identity = basis.identities.find(
      (item) => item.organization_id === null && item.started_at && item.ended_at === null && item.blocked_at === null,
    );
    if (!identity)
      throw new AppError(
        409,
        "PERSONAL_IDENTITY_REQUIRED",
        "Refresh your profile before selecting your personal identity.",
      );
    return identityAffiliationPreviewResponseSchema.parse({
      email: address.email,
      domain: basis.domain,
      organization: null,
      organizations: [],
      domains: [],
      identityId: identity.id,
    });
  }
  // The mapping supplies the chooser's default without excluding other proved organizations.
  const resolution = resolveDomainOrganization(
    basis.facts,
    basis.facts.claimed ? { organizationId: basis.facts.claimed.organizationId } : undefined,
  );
  if (resolution.kind === "held") verifiedDomainOrganizationId(basis.domain, resolution);
  const organizationId = resolution.kind === "organization" ? resolution.organizationId : null;
  const organizations = basis.organizations.filter((organization) => {
    return resolveDomainOrganization(basis.facts, { organizationId: organization.id }).kind === "organization";
  });
  const organization = organizations.find((item) => item.id === organizationId) ?? null;
  let contextToken: string | undefined;
  if (input.phase === "prepare") {
    if (input.organizationId && !organizations.some((item) => item.id === input.organizationId))
      throw new AppError(
        422,
        "IDENTITY_DOMAIN_MISMATCH",
        "Choose an organization confirmed by your verified work domain.",
      );
    if (input.organizationId && input.organizationName !== undefined)
      throw new AppError(
        422,
        "IDENTITY_ORGANIZATION_RESOLVED",
        "Choose an existing organization or enter a new organization name.",
      );
    await affiliationPlan(db, actor.claims, input, basis, nowIso());
    contextToken = await signJwt(
      env.INTERNAL_SIGNING_SECRET!,
      contextSchema.parse({
        typ: "verified-affiliation",
        userId: actor.claims.sub,
        sessionId: actor.claims.sid,
        exp: Math.floor(Date.now() / 1000) + 120,
        input,
        basis,
      }),
    );
  }
  const rootDomain = workEmailDomain(address.email);
  const mayLinkSubdomains = !basis.claims.some((item) => item.applicationId);
  return identityAffiliationPreviewResponseSchema.parse({
    email: address.email,
    domain: basis.domain,
    organization: organization ? { id: organization.id, name: organization.name } : null,
    domains: verifiedRepresentationDomainCandidates(address.email, basis.claims).map((domain) => {
      const claim = basis.claims.find((item) => item.domain === domain);
      return {
        domain,
        canLink: !claim && domain !== rootDomain && mayLinkSubdomains,
        organizationName: basis.organizations.find((item) => item.id === claim?.organizationId)?.name ?? null,
      };
    }),
    organizations: organizations.map(({ id, name }) => {
      const identity = basis.identities.find(
        (item) => item.organization_id === id && item.started_at && item.ended_at === null && item.blocked_at === null,
      );
      return { id, name, identityId: identity?.id ?? null, jobTitle: identity?.job_title ?? null };
    }),
    contextToken,
    identityId: organizationId
      ? basis.identities.find(
          (identity) =>
            identity.organization_id === organizationId &&
            identity.started_at &&
            identity.started_at <= nowIso() &&
            identity.ended_at === null &&
            identity.blocked_at === null,
        )?.id
      : undefined,
  });
}

export async function commitOwnAffiliation(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  contextToken: string,
) {
  const actor = await prepareUserSessionRequest(db, request, env);
  const verified = await verifyJwt(env.INTERNAL_SIGNING_SECRET!, contextToken);
  const context = verified.ok ? contextSchema.safeParse(verified.claims) : null;
  if (!context?.success || context.data.userId !== actor.claims.sub || context.data.sessionId !== actor.claims.sid)
    throw new AppError(403, "IDENTITY_CONTEXT_INVALID", "Confirm your representation details again.");
  const at = nowIso();
  const plan = await affiliationPlan(db, actor.claims, context.data.input, context.data.basis, at);
  const domainStatements: StatementLike[] = [];
  if (plan.domainToLink) {
    const domain = plan.domainToLink;
    domainStatements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM organizations WHERE id=? AND merged_into_organization_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)`,
        bindings: [plan.organizationId, domain],
      }),
      (await prepareClaimDomainForOrganization(db, { domain, organizationId: plan.organizationId, now: at }, null))!,
      prepareAuditLog(
        db,
        "user",
        actor.claims.sub,
        "organization_domain_claimed",
        "organization",
        plan.organizationId,
        { domain: { from: null, to: domain }, reason: "Confirmed through a verified work email address" },
        at,
      ),
    );
  }
  try {
    await db.batch([
      prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(actor.claims)),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims
          WHERE domain IN (SELECT value FROM json_each(?)) AND (application_id IS NOT NULL OR length(domain)>?))`,
        bindings: [
          JSON.stringify(organizationDomainCandidates(context.data.input.email)),
          context.data.basis.domain.length,
        ],
      }),
      ...plan.statements,
      ...domainStatements,
      prepareOwnAffiliationReviewResolution(db, { userId: actor.claims.sub, identityId: plan.identityId, at }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error) || isConcurrentIdentityConflict(error))
      throw new AppError(
        409,
        "IDENTITY_CONTEXT_CHANGED",
        "Your email or organization relationship changed. Confirm your details again.",
      );
    throw error;
  }
  return { success: true, identityId: plan.identityId, state: "active" as const };
}
