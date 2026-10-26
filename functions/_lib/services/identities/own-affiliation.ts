/** Email proof and domain policy are production services; these adapters compose one batch per request. */
import { z } from "zod";
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
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { signJwt, verifyJwt } from "../../utils/jwt";
import { isAuditChangeGuardFailure } from "../audit";
import { prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { isConcurrentIdentityConflict } from "./conflicts";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { prepareVerifiedAffiliationRead } from "./verified-affiliation-read";
import { verifiedDomainOrganizationId } from "./verified-email-domain";

const contextSchema = z.object({
  typ: z.literal("verified-affiliation"),
  userId: z.string(),
  sessionId: z.string(),
  exp: z.number(),
  input: identityAffiliationPrepareSchema,
  basis: verifiedAffiliationBasisSchema,
});
function affiliationPlan(
  db: DatabaseLike,
  claims: { sub: string; sid: string },
  input: z.infer<typeof identityAffiliationPrepareSchema>,
  basis: z.infer<typeof verifiedAffiliationBasisSchema>,
  at: string,
) {
  return prepareVerifiedOrganizationAffiliation(
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
      identityId: identity.id,
    });
  }
  const resolution = resolveDomainOrganization(basis.facts);
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
  return identityAffiliationPreviewResponseSchema.parse({
    email: address.email,
    domain: basis.domain,
    organization: organization ? { id: organization.id, name: organization.name } : null,
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
  try {
    await db.batch([
      prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(actor.claims)),
      ...plan.statements,
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
