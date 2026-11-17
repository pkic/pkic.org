/**
 * Account setup's organization step, shared by every redemption that would
 * start a session from an email link (sign-in and sign-up).
 *
 * A work address is not proof of an organization, so the person says which:
 * an organization (verified through the shared affiliation planner), or, on
 * a domain no organization has claimed, a personal address. Until then no
 * session is created. The answer is asked once: an organization identity or a
 * recorded personal answer settles it, and a later claim of the domain asks
 * again because a claimed domain is never personal.
 *
 * The personal answer is the existing "I am independent" record
 * (`affiliation_offer_dismissals` with no organization), not new storage.
 */
import { z } from "zod";
import {
  identityAffiliationPrepareSchema,
  identityAffiliationPreviewResponseSchema,
} from "../../../../assets/shared/schemas/identity-affiliation";
import type {
  AccountOrganizationAnswer,
  AccountOrganizationRequired,
  accountOrganizationAffiliationRequestSchema,
} from "../../../../assets/shared/schemas/account-organization";
import { prepareStateGuard } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { mailboxKind, organizationDomainCandidates } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { signJwt, verifyJwt } from "../../utils/jwt";
import { nowIso } from "../../utils/time";
import { prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { planVerifiedAffiliation } from "./verified-affiliation-plan";
import { verifiedAffiliationPreview } from "./verified-affiliation-preview";
import { prepareVerifiedAffiliationRead } from "./verified-affiliation-read";

const CONTEXT_TYPE = "account-organization";
const CONTEXT_TTL_SECONDS = 600;

const contextSchema = z.object({
  typ: z.literal(CONTEXT_TYPE),
  exp: z.number(),
  input: identityAffiliationPrepareSchema,
  basis: verifiedAffiliationBasisSchema,
});

type AffiliationRequest = z.infer<typeof accountOrganizationAffiliationRequestSchema>;

/** The person the link names; null while a sign-up link has not created the account yet. */
export type AccountOrganizationSubject = { userId: string } | { userId: null };

function subjectSql(subject: AccountOrganizationSubject) {
  return { sql: "?", bindings: [subject.userId] };
}

function claimedDomainSql(email: string) {
  return {
    sql: `SELECT 1 FROM organization_domain_claims claim JOIN json_each(?) requested ON requested.value=claim.domain
      WHERE claim.organization_id IS NOT NULL LIMIT 1`,
    bindings: [JSON.stringify(organizationDomainCandidates(email))],
  };
}

/**
 * Reads, in one batch, whether the step is open for this address and what the
 * chooser shows. A free mailbox never asks: it is personal by its kind.
 */
export async function readAccountOrganizationStep(
  db: DatabaseLike,
  input: {
    subject: AccountOrganizationSubject;
    email: string;
    verifiedAt: string;
    affiliation?: AffiliationRequest;
  },
) {
  if (mailboxKind(input.email) !== "work") return null;
  const selection = input.affiliation && "selection" in input.affiliation ? input.affiliation.selection : undefined;
  const domain =
    selection?.domain ?? (input.affiliation && "domain" in input.affiliation ? input.affiliation.domain : undefined);
  const read = prepareVerifiedAffiliationRead(
    db,
    subjectSql(input.subject),
    { email: input.email, emailId: null, domain, organizationName: selection?.organizationName },
    { verifiedAt: input.verifiedAt },
  );
  const claimed = claimedDomainSql(input.email);
  const results = await db.batch([
    db
      .prepare(`SELECT
        EXISTS (SELECT 1 FROM identities WHERE user_id=? AND organization_id IS NOT NULL
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL) AS has_organization,
        EXISTS (SELECT 1 FROM affiliation_offer_dismissals WHERE user_id=? AND organization_id IS NULL) AS said_personal,
        EXISTS (${claimed.sql}) AS claimed`)
      .bind(input.subject.userId, input.subject.userId, ...claimed.bindings),
    ...read.statements,
  ]);
  const facts = batchFirst<{ has_organization: number; said_personal: number; claimed: number }>(results[0]);
  if (facts?.has_organization) return null;
  const personalAllowed = !facts?.claimed;
  if (personalAllowed && facts?.said_personal) return null;
  const { basis, address } = read.decode(results.slice(1));
  return { basis, address, personalAllowed };
}

/** What the verify request answers while the step is open, with a signed selection once one is complete. */
export async function accountOrganizationRequired(
  db: DatabaseLike,
  signingSecret: string,
  email: string,
  step: NonNullable<Awaited<ReturnType<typeof readAccountOrganizationStep>>>,
  input: { affiliation?: AffiliationRequest; newAccount: boolean },
): Promise<AccountOrganizationRequired> {
  const preview = identityAffiliationPreviewResponseSchema.parse(
    verifiedAffiliationPreview(step.basis, step.address, { unrecordedAddress: input.newAccount }),
  );
  const selection = input.affiliation && "selection" in input.affiliation ? input.affiliation.selection : undefined;
  if (selection) {
    const prepared = identityAffiliationPrepareSchema.parse({
      ...selection,
      phase: "prepare",
      email,
      emailId: step.address.id ?? null,
    });
    if (prepared.organizationId && !preview.organizations.some((item) => item.id === prepared.organizationId))
      throw new AppError(
        422,
        "IDENTITY_DOMAIN_MISMATCH",
        "Choose an organization confirmed by your verified work domain.",
      );
    // Refuses now what the commit would refuse, on the field the person can correct.
    await planVerifiedAffiliation(
      db,
      { userId: crypto.randomUUID(), proofEvidence: { sql: "SELECT 1", bindings: [] } },
      prepared,
      { ...step.basis, identities: [], emailOwner: null },
      nowIso(),
    );
    preview.contextToken = await signJwt(
      signingSecret,
      contextSchema.parse({
        typ: CONTEXT_TYPE,
        exp: Math.floor(Date.now() / 1000) + CONTEXT_TTL_SECONDS,
        input: prepared,
        basis: step.basis,
      }),
    );
  }
  return { success: true, organizationRequired: { affiliation: preview, personalAllowed: step.personalAllowed } };
}

/**
 * The answer's statements for the redemption's own batch, placed after the
 * statements that create or verify the account. `proofEvidence` must hold
 * only once that account is live in the same batch.
 */
export async function planAccountOrganizationAnswer(
  db: DatabaseLike,
  input: {
    signingSecret: string;
    userId: string;
    email: string;
    answer: AccountOrganizationAnswer;
    personalAllowed: boolean;
    at: string;
  },
): Promise<{ statements: StatementLike[]; identityId?: string }> {
  const proofEvidence = { sql: "SELECT 1 FROM users WHERE id=? AND active=1", bindings: [input.userId] };
  if ("personal" in input.answer) {
    if (!input.personalAllowed)
      throw new AppError(
        409,
        "ORGANIZATION_REQUIRED",
        "An organization uses this email domain. Choose your organization.",
      );
    const claimed = claimedDomainSql(input.email);
    return {
      statements: [
        // A domain claimed while the person answered is no longer a personal address.
        prepareStateGuard(db, { sql: `SELECT 1 WHERE NOT EXISTS (${claimed.sql})`, bindings: claimed.bindings }),
        db
          .prepare(
            `INSERT INTO affiliation_offer_dismissals (id, user_id, organization_id, created_at)
           SELECT ?, ?, NULL, ? WHERE NOT EXISTS
             (SELECT 1 FROM affiliation_offer_dismissals WHERE user_id=? AND organization_id IS NULL)`,
          )
          .bind(uuid(), input.userId, input.at, input.userId),
      ],
    };
  }
  const verified = await verifyJwt(input.signingSecret, input.answer.contextToken);
  const context = verified.ok ? contextSchema.safeParse(verified.claims) : null;
  if (!context?.success || context.data.input.email !== input.email)
    throw new AppError(409, "IDENTITY_CONTEXT_INVALID", "Confirm your organization details again.");
  const plan = await planVerifiedAffiliation(
    db,
    { userId: input.userId, proofEvidence },
    context.data.input,
    context.data.basis,
    input.at,
  );
  return {
    statements: [
      ...plan.statements,
      prepareOwnAffiliationReviewResolution(db, { userId: input.userId, identityId: plan.identityId, at: input.at }),
    ],
    // The person just said they represent this organization: their new session acts as it.
    identityId: plan.identityId,
  };
}

/** The organization step as a redemption sees it: what the verify request carries. */
export interface AccountOrganizationStepInput {
  affiliation?: AffiliationRequest;
  answer?: AccountOrganizationAnswer;
}

/**
 * Either the statements that settle the step inside the redemption's batch
 * (none when it is not open), or what to ask before any session exists.
 */
export async function accountOrganizationStepStatements(
  db: DatabaseLike,
  input: {
    signingSecret: string;
    subject: AccountOrganizationSubject;
    /** The account a sign-up link creates in the same batch. */
    newUserId?: string;
    email: string;
    verifiedAt: string;
    input?: AccountOrganizationStepInput;
  },
): Promise<{ statements: StatementLike[]; identityId?: string } | { required: AccountOrganizationRequired }> {
  const step = await readAccountOrganizationStep(db, {
    subject: input.subject,
    email: input.email,
    verifiedAt: input.verifiedAt,
    affiliation: input.input?.affiliation,
  });
  if (!step) return { statements: [] };
  const userId = input.subject.userId ?? input.newUserId;
  const answer = input.input?.answer;
  // A personal answer on a domain an organization has claimed asks for the organization instead.
  const answerable = answer && !("personal" in answer && !step.personalAllowed);
  if (answerable && userId)
    return planAccountOrganizationAnswer(db, {
      signingSecret: input.signingSecret,
      userId,
      email: input.email,
      answer,
      personalAllowed: step.personalAllowed,
      at: input.verifiedAt,
    });
  return {
    required: await accountOrganizationRequired(db, input.signingSecret, input.email, step, {
      affiliation: input.input?.affiliation,
      newAccount: input.subject.userId === null,
    }),
  };
}
