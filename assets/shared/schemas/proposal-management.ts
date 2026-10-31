import { z } from "zod";
import { identityAffiliationContextSchema } from "./identity-affiliation";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import {
  boundedJsonObject,
  emailRecoveryRequestSchema,
  firstNameSchema,
  JOB_TITLE_REQUIRED,
  jobTitleSchema,
  lastNameSchema,
  normalizedEmailSchema,
  organizationNameSchema,
  successResponseSchema,
  tokenSchema,
  trimmedString,
  utcInstantSchema,
} from "./api-common";
import { consentItemSchema, proposerProfileSchema, speakerRoleSchema, userProfileSchema } from "./registration";
import { proposalDecisionStatusSchema, proposalStatusSchema } from "./proposal-status";
import { addDuplicateStringIssues } from "./refinements";
import { httpCapabilityUrlSchema, httpUrlSchema } from "./urls";
import { proposalActingIdentitySchema, proposalActingIdentitySelectionShape } from "./proposal-acting-identity";
import { eventProposalContinuationTokenSchema } from "./event-proposal-proof";
import { proposalEntryContextShape } from "./proposal-entry";
import { independentCapacityDisclosureSchema, requireIndependentCapacity } from "./independent-capacity";

/** Event-defined session-type label; allowed values are checked against the event in the service layer. */
export const proposalTypeSchema = trimmedString(2, 64);
export type ProposalType = z.infer<typeof proposalTypeSchema>;
export const proposalSessionTypeSchema = z.object({
  label: proposalTypeSchema,
  name: trimmedString(1, 100).optional(),
  requiresPresentation: z.boolean(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
});
export const proposalSessionTypesSchema = z
  .array(proposalSessionTypeSchema)
  .max(20)
  .superRefine((sessionTypes, context) =>
    addDuplicateStringIssues(sessionTypes, context, {
      value: (sessionType) => sessionType.label.toLocaleLowerCase("en-US"),
      path: (index) => [index, "label"],
      label: "Session type",
    }),
  );

const proposalTitleSchema = trimmedString(8, 180);
const proposalAbstractSchema = z
  .string()
  .trim()
  .min(80, "Write at least 80 characters, so reviewers can assess your session.")
  .max(8000, "Keep the abstract to 8,000 characters or fewer.");
/**
 * Notes for the program committee: private context for reviewers and
 * organizers. Never published, and never part of the abstract.
 */
export const proposalCommitteeNotesSchema = z.string().trim().max(4000, "Keep the notes to 4,000 characters or fewer.");
export const MAX_PROPOSAL_ADDITIONAL_SPEAKERS = 8;
export const MAX_PROPOSAL_PARTICIPANTS = MAX_PROPOSAL_ADDITIONAL_SPEAKERS + 1;

/**
 * Details of the organization identity the CFP identity step creates from a
 * confirmed email (a continuation token). They are identity-creation input
 * only: a speaker's organization and job title are always projected from
 * identities, never stored on the person or overridden on a proposal roster row.
 */
export const proposalNewAffiliationShape = {
  organizationName: optionalNullableOrEmpty(organizationNameSchema),
  jobTitle: optionalNullableOrEmpty(jobTitleSchema),
  organizationContextToken: identityAffiliationContextSchema.optional(),
};

/**
 * The one rule for an organization affiliation a confirmed email creates: its
 * organization and job title are accepted only with that confirmation, and
 * taking part on behalf of the organization requires the job title. An
 * existing representation (`actingIdentityId`) carries its own.
 */
function checkNewAffiliation(
  value: {
    continuationToken?: string;
    /** `false` takes part on behalf of an organization; `undefined` leaves the proved capacity unchanged. */
    unaffiliatedAttestation?: boolean;
    actingIdentityId?: string | null;
    organizationName?: string | null;
    jobTitle?: string | null;
  },
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[] = [],
): void {
  if (value.continuationToken === undefined) {
    for (const key of ["organizationName", "jobTitle"] as const) {
      if (value[key])
        context.addIssue({
          code: "custom",
          path: [...path, key],
          message: "Organization and job title come from the identity you speak as.",
        });
    }
    return;
  }
  if (value.unaffiliatedAttestation === false && value.actingIdentityId === undefined && !value.jobTitle)
    context.addIssue({ code: "custom", path: [...path, "jobTitle"], message: JOB_TITLE_REQUIRED });
}

/**
 * Who a proposal's contact takes part as: the identity step's part of the
 * proposal contract, checked when the contact step is left and again by the
 * route through `proposalCreateSchema`.
 */
export const proposalContactSchema = z
  .object({
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    unaffiliatedAttestation: z.boolean().default(false),
    proposer: z.object({ ...proposalActingIdentitySelectionShape, ...proposalNewAffiliationShape }),
  })
  .superRefine((value, context) =>
    checkNewAffiliation(
      {
        continuationToken: value.continuationToken,
        unaffiliatedAttestation: value.unaffiliatedAttestation,
        ...value.proposer,
      },
      context,
      ["proposer"],
    ),
  );

export const proposalCreateSchema = boundedJsonObject(
  {
    ...proposalEntryContextShape,
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    unaffiliatedAttestation: z.boolean().default(false),
    /** Required with, and only with, the individual capacity. */
    independentCapacity: independentCapacityDisclosureSchema.optional(),
    proposer: proposerProfileSchema
      .partial({ email: true, firstName: true, lastName: true })
      .extend({ ...proposalActingIdentitySelectionShape, ...proposalNewAffiliationShape }),
    proposal: z.object({
      type: proposalTypeSchema,
      title: proposalTitleSchema,
      abstract: proposalAbstractSchema,
      committeeNotes: proposalCommitteeNotesSchema.optional(),
      details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
    }),
    speakers: z
      .array(
        /** Who to invite; each co-speaker writes their own bio, links and photo when they confirm. */
        userProfileSchema.extend({ role: speakerRoleSchema.default("speaker") }),
      )
      .max(MAX_PROPOSAL_ADDITIONAL_SPEAKERS)
      .default([]),
    consents: z.array(consentItemSchema).max(20),
  },
  40_000,
).superRefine((value, ctx) => {
  requireIndependentCapacity(value, value.unaffiliatedAttestation, ctx);
  checkNewAffiliation(
    {
      continuationToken: value.continuationToken,
      unaffiliatedAttestation: value.unaffiliatedAttestation,
      ...value.proposer,
    },
    ctx,
    ["proposer"],
  );
  const participantEmails = [value.proposer.email, ...value.speakers.map((speaker) => speaker.email)].filter(
    (email) => email !== undefined,
  );
  if (new Set(participantEmails).size !== participantEmails.length) {
    ctx.addIssue({
      code: "custom",
      path: ["speakers"],
      message: "Each proposal participant must use a unique email address",
    });
  }
  if (value.proposal.type === "panel") {
    const panelParticipants = value.speakers.filter((speaker) => speaker.role === "panelist");
    if (panelParticipants.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["speakers"],
        message: "Panel proposals require at least one speaker with role 'panelist'",
      });
    }
  }
});

/** The signed-in proposer must make an explicit choice, including individual presentation. */
export const authenticatedProposalCreateSchema = proposalCreateSchema.superRefine((value, context) => {
  if (value.proposer.actingIdentityId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["proposer", "actingIdentityId"],
      message: "Choose the identity you will speak as, or choose individual presentation.",
    });
  }
});

export const proposalCreateResponseSchema = successResponseSchema.extend({
  proposalId: databaseIdSchema,
  status: proposalStatusSchema,
  manageToken: z.string().nullable(),
  manageUrl: httpCapabilityUrlSchema.nullable(),
  shareUrl: httpUrlSchema,
});

export const proposalResendManageLinkSchema = emailRecoveryRequestSchema;

export const proposalResendSpeakerManageLinkSchema = proposalResendManageLinkSchema;

export const inviteResendLinkSchema = proposalResendManageLinkSchema;

export const proposalAccessPatchSchema = boundedJsonObject(
  {
    status: z.literal("withdrawn").optional(),
    proposalType: proposalTypeSchema.optional(),
    title: proposalTitleSchema.optional(),
    abstract: proposalAbstractSchema.optional(),
    /** Private to reviewers and organizers; editable only while the proposal is under review. */
    committeeNotes: proposalCommitteeNotesSchema.nullable().optional(),
    details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  },
  30_000,
).superRefine((value, context) => {
  const updateFields = [value.proposalType, value.title, value.abstract, value.details, value.committeeNotes];
  if (value.status === undefined && updateFields.every((field) => field === undefined)) {
    context.addIssue({ code: "custom", message: "Provide at least one proposal field to update" });
  }
  if (value.status === "withdrawn" && updateFields.some((field) => field !== undefined)) {
    context.addIssue({ code: "custom", message: "A withdrawal cannot include proposal field updates" });
  }
});

export const proposalAccessTokenParamsSchema = z.object({ token: tokenSchema });

export const proposalAccessRecordSchema = z.object({
  event_id: databaseIdSchema.optional(),
  id: databaseIdSchema,
  proposer_user_id: databaseIdSchema,
  status: proposalStatusSchema,
  proposal_type: proposalTypeSchema,
  title: z.string(),
  abstract: z.string(),
  /** The proposer's own private notes for the program committee. */
  committee_notes: z.string().nullable().default(null),
  details: z.record(z.string(), z.unknown()).nullable(),
});

export const proposalAccessSpeakerStatusSchema = z.enum(["pending", "invited", "confirmed", "declined"]);
export type ProposalAccessSpeakerStatus = z.infer<typeof proposalAccessSpeakerStatusSchema>;
/** Canonical transport fields shared by proposer and admin speaker views. */
export const proposalSpeakerProfileSchema = proposalActingIdentitySchema.extend({
  userId: databaseIdSchema,
  role: speakerRoleSchema,
  status: proposalAccessSpeakerStatusSchema,
  email: normalizedEmailSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  links: linksSchema,
  headshotUpdatedAt: z.string().nullable(),
  headshotUrl: httpUrlSchema.nullable(),
});

export const proposalAccessSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  /** What a speaker who declined told the proposer, if anything. */
  declineReason: z.string().nullable(),
  bio: z.string().nullable(),
  headshotUploaded: z.boolean(),
});

export const proposalAccessReadResponseSchema = successResponseSchema.extend({
  proposal: proposalAccessRecordSchema,
  speakers: z.array(proposalAccessSpeakerSchema).max(MAX_PROPOSAL_PARTICIPANTS),
});

export const proposalAccessPatchResponseSchema = successResponseSchema.extend({
  proposal: proposalAccessRecordSchema,
});

export type ProposalAccessResponse = z.infer<typeof proposalAccessReadResponseSchema>;

export const finalizeProposalSchema = z
  .object({
    finalStatus: proposalDecisionStatusSchema,
    decisionNote: trimmedString(3, 10_000).optional(),
    presentationDeadline: utcInstantSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.finalStatus === "needs-work" && !value.decisionNote) {
      context.addIssue({
        code: "custom",
        path: ["decisionNote"],
        message: "A decision note is required when requesting changes",
      });
    }
    if (value.finalStatus !== "accepted" && value.presentationDeadline) {
      context.addIssue({
        code: "custom",
        path: ["presentationDeadline"],
        message: "A presentation deadline is only valid for accepted proposals",
      });
    }
  });

export const finalizeProposalResponseSchema = successResponseSchema.extend({
  decisionId: databaseIdSchema,
  reviewRound: z.number().int().positive(),
  reviewCount: z.number().int().nonnegative(),
  minReviewsRequired: z.number().int().nonnegative(),
});

export const proposalPatchSchema = z
  .object({
    title: proposalTitleSchema.optional(),
    abstract: proposalAbstractSchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.abstract !== undefined, {
    message: "Provide a title or abstract to update",
  });

export const proposalEditableSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  abstract: z.string(),
  updated_at: z.string(),
});

export const proposalPatchResponseSchema = z.object({
  proposal: proposalEditableSchema,
});

export const cancelAcceptedProposalSchema = z.object({
  comment: z.string().trim().min(1).max(5_000),
});

export const cancelAcceptedProposalResponseSchema = successResponseSchema.extend({
  proposalId: databaseIdSchema,
  status: z.literal("canceled"),
  canceledAt: z.string(),
  notifiedSpeakerCount: z.number().int().nonnegative(),
});

function optionalNullableOrEmpty<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal(""), z.null()]).optional();
}

/**
 * The person's names, which a speaker may complete on their own page. Their
 * biography, links and title belong to the identity they speak as and are
 * edited there (`eventProposalProofIdentityPatchSchema`), never on the proposal.
 */
export const speakerProfilePatchSchema = z
  .object({
    firstName: optionalNullableOrEmpty(firstNameSchema),
    lastName: optionalNullableOrEmpty(lastNameSchema),
  })
  .strict();

/**
 * A bound speaker can select only their own representation; roster patches
 * cannot. Organization and job title are accepted only to create the
 * affiliation a confirmed email proves.
 */
export const speakerSelfProfilePatchSchema = speakerProfilePatchSchema
  .extend({
    ...proposalActingIdentitySelectionShape,
    ...proposalNewAffiliationShape,
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    unaffiliatedAttestation: z.boolean().optional(),
    /** Required whenever this patch selects the individual capacity. */
    independentCapacity: independentCapacityDisclosureSchema.optional(),
    consents: z.array(consentItemSchema).max(20).optional(),
  })
  .superRefine((value, context) => {
    checkNewAffiliation(value, context);
    const selectsIndividual = value.unaffiliatedAttestation === true || value.actingIdentityId === null;
    const selectsOrganization = value.unaffiliatedAttestation === false || typeof value.actingIdentityId === "string";
    if (selectsIndividual || selectsOrganization || value.independentCapacity !== undefined)
      requireIndependentCapacity(value, selectsIndividual && !selectsOrganization, context);
  });

export const speakerParticipationPatchSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmed"),
    consents: z.array(consentItemSchema).min(1).max(20),
  }),
  z.object({
    status: z.literal("declined"),
    reason: z.string().trim().max(2000).optional(),
  }),
]);

/**
 * What an organizer or the proposer changes on a roster row: the speaker's role on this
 * proposal. Their name, headshot and profile are not the proposal's — the
 * name and headshot belong to the person and the profile to the identity they
 * speak as, each edited through its own resource.
 */
export const proposalSpeakerPatchSchema = z.object({ role: speakerRoleSchema }).strict();

export const proposalSpeakerRemovalRequestSchema = z.object({
  replacementProposerUserId: databaseIdSchema.optional(),
});

export const proposalSpeakerRemovalResponseSchema = successResponseSchema.extend({
  removedUserId: databaseIdSchema,
  proposerUserId: databaseIdSchema,
  cancelledEmailCount: z.number().int().nonnegative(),
});

export const coSpeakerInviteSchema = z
  .object({
    email: normalizedEmailSchema,
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    role: speakerRoleSchema.exclude(["proposer"]).default("speaker"),
    expiresAt: utcInstantSchema.optional(),
  })
  .strict();

export const coSpeakerInviteResponseSchema = successResponseSchema.extend({
  email: normalizedEmailSchema,
  role: speakerRoleSchema,
  expiresAt: utcInstantSchema,
  queued: z.boolean(),
});
