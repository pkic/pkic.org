import type { Permission } from "../../assets/shared/schemas/permissions";

/**
 * Who the people in our tests are.
 *
 * Every suite previously invented its own identity inline — an admin here, a
 * user with two grants there — which made it impossible to answer "is this
 * capability actually reachable by anyone real?" and easy to test a
 * permission combination the product never issues. These personas are built
 * from the roles the product genuinely assigns (`roles` / `role_permissions`
 * in migration 0035), so a test that passes for a persona is a statement
 * about someone who can exist.
 *
 * The catalog is deliberately data-only and shared by the mounted Worker
 * suites and the browser suites. Each provisions it differently — one writes
 * D1 directly, the other goes through the API as a person would — but both
 * mean the same thing by "a group lead".
 */

/** Roles the product defines, as seeded into `roles`. */
export type RoleId =
  | "role-admin"
  | "role-membership_processor"
  | "role-group_lead"
  | "role-group_deputy_lead"
  | "role-event_organizer"
  | "role-program_committee"
  | "role-event_moderator"
  | "role-event_volunteer"
  | "role-member"
  | "role-interested_parties"
  | "role-primary_contact"
  | "role-secondary_contact";

/** Where a role applies. A group lead leads one group, not every group. */
export type RoleContext = "global" | "group" | "event" | "organization";

export interface PersonaRole {
  roleId: RoleId;
  context: RoleContext;
}

export interface PersonaDefinition {
  key: string;
  /** What this person is, in the product's own terms. */
  description: string;
  /**
   * Membership category, or null for someone with no membership at all —
   * staff-only identities, which must never gain member-only access.
   */
  membershipCategory: string | null;
  /** How many organizations this person represents concurrently. */
  organizationCount: number;
  roles: PersonaRole[];
  /**
   * Direct permission grants beyond any role. Kept separate because a direct
   * grant and a role-derived permission are different things to revoke.
   */
  grants: Permission[];
  /** Voting is category-derived; stated here so tests can assert it. */
  mayVote: boolean;
}

function persona(definition: PersonaDefinition): PersonaDefinition {
  return definition;
}

export const PERSONAS = {
  /** No session at all. The baseline every authorization test needs. */
  anonymous: persona({
    key: "anonymous",
    description: "A visitor with no session",
    membershipCategory: null,
    organizationCount: 0,
    roles: [],
    grants: [],
    mayVote: false,
  }),

  /**
   * An interested party. The bylaws place these categories outside the
   * electorate entirely, so this persona exists to prove that holds.
   */
  interestedParty: persona({
    key: "interestedParty",
    description: "A member in a non-voting interested-party category",
    membershipCategory: "H8",
    organizationCount: 1,
    roles: [],
    grants: [],
    mayVote: false,
  }),

  votingMember: persona({
    key: "votingMember",
    description: "An ordinary member of a voting category",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [],
    grants: [],
    mayVote: true,
  }),

  /** One person acting for two Members — one ballot each, not two voices. */
  multiCapacityMember: persona({
    key: "multiCapacityMember",
    description: "A person representing two member organizations at once",
    membershipCategory: "A",
    organizationCount: 2,
    roles: [],
    grants: [],
    mayVote: true,
  }),

  organizationContact: persona({
    key: "organizationContact",
    description: "An organization's primary contact, who manages its representatives",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [{ roleId: "role-primary_contact", context: "organization" }],
    grants: [],
    mayVote: true,
  }),

  groupParticipant: persona({
    key: "groupParticipant",
    description: "A member participating in a group without managing it",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [],
    grants: [],
    mayVote: true,
  }),

  /** The chair, whose ballot settles a tie when a vote asks it to. */
  groupLead: persona({
    key: "groupLead",
    description: "The chair of a group",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [{ roleId: "role-group_lead", context: "group" }],
    grants: [],
    mayVote: true,
  }),

  groupDeputyLead: persona({
    key: "groupDeputyLead",
    description: "The vice chair of a group, who acts for the chair in their absence",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [{ roleId: "role-group_deputy_lead", context: "group" }],
    grants: [],
    mayVote: true,
  }),

  membershipProcessor: persona({
    key: "membershipProcessor",
    description: "Staff who move membership applications through review",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-membership_processor", context: "global" }],
    grants: [],
    mayVote: false,
  }),

  /**
   * Read-only membership staff. Not a seeded role — a direct grant, which is
   * exactly how a narrowly scoped identity is issued in practice.
   */
  membershipReader: persona({
    key: "membershipReader",
    description: "Staff who may read membership applications but change nothing",
    membershipCategory: null,
    organizationCount: 0,
    roles: [],
    grants: ["membership:read"],
    mayVote: false,
  }),

  eventOrganizer: persona({
    key: "eventOrganizer",
    description: "Full management of one event",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-event_organizer", context: "event" }],
    grants: [],
    mayVote: false,
  }),

  programCommittee: persona({
    key: "programCommittee",
    description: "Proposal review and agenda setting for one event",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-program_committee", context: "event" }],
    grants: [],
    mayVote: false,
  }),

  groupsReader: persona({
    key: "groupsReader",
    description: "Staff who may read group configuration but change nothing",
    membershipCategory: null,
    organizationCount: 0,
    roles: [],
    grants: ["groups:read"],
    mayVote: false,
  }),

  eventModerator: persona({
    key: "eventModerator",
    description: "Event-scoped proposal review without the power to finalize",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-event_moderator", context: "event" }],
    grants: [],
    mayVote: false,
  }),

  eventVolunteer: persona({
    key: "eventVolunteer",
    description: "An event helper with no permissions, kept to prove that",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-event_volunteer", context: "event" }],
    grants: [],
    mayVote: false,
  }),

  organizationSecondaryContact: persona({
    key: "organizationSecondaryContact",
    description: "An organization's secondary contact",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [{ roleId: "role-secondary_contact", context: "organization" }],
    grants: [],
    mayVote: true,
  }),

  legacyMember: persona({
    key: "legacyMember",
    description: "The legacy authenticated-member classification",
    membershipCategory: "A",
    organizationCount: 1,
    roles: [{ roleId: "role-member", context: "global" }],
    grants: [],
    mayVote: true,
  }),

  legacyInterestedParty: persona({
    key: "legacyInterestedParty",
    description: "The legacy interested-party classification",
    membershipCategory: "H8",
    organizationCount: 1,
    roles: [{ roleId: "role-interested_parties", context: "global" }],
    grants: [],
    mayVote: false,
  }),

  administrator: persona({
    key: "administrator",
    description: "Full platform access",
    membershipCategory: null,
    organizationCount: 0,
    roles: [{ roleId: "role-admin", context: "global" }],
    grants: [],
    mayVote: false,
  }),
} as const satisfies Record<string, PersonaDefinition>;

export type PersonaKey = keyof typeof PERSONAS;
export const PERSONA_KEYS = Object.keys(PERSONAS) as PersonaKey[];

/**
 * Narrowly scoped staff identities, one per capability the system exposes.
 *
 * Testing an authorization boundary needs two people: someone who holds the
 * permission and someone who does not. An administrator holds everything, so
 * it can only ever demonstrate the first half. These profiles supply the
 * second — for every permission there is somebody whose authority stops
 * exactly there, which is what makes a system-wide permission sweep possible
 * rather than a per-suite improvisation.
 *
 * Permissions are grouped as the product grants them: a screen that reads and
 * writes one domain issues both, and a genuinely separate capability
 * (anonymisation, revocation) gets its own profile because it is separately
 * revocable.
 */
const CAPABILITY_PROFILES = {
  analyticsReader: { description: "Reads platform analytics", grants: ["analytics:read"] },
  auditReader: { description: "Reads the audit trail", grants: ["audit:read"] },
  retentionOperator: {
    description: "Runs data retention, which also requires the power to anonymise",
    grants: ["retention:read", "retention:run", "users:anonymize"],
  },
  schedulerOperator: {
    description: "Inspects and runs scheduled jobs",
    grants: ["scheduler:read", "scheduler:manage"],
  },
  emailOperator: { description: "Reads and manages the outbound email outbox", grants: ["email:read", "email:manage"] },
  emailTemplateEditor: {
    description: "Authors and activates email templates",
    grants: ["email-templates:read", "email-templates:write"],
  },
  donationsOperator: { description: "Reads and synchronises donations", grants: ["donations:read", "donations:sync"] },
  organizationManager: {
    description: "Maintains organizations and their representatives",
    grants: ["organizations:read", "organizations:write"],
  },
  organizationContentReviewer: {
    description: "Reviews organization-submitted content",
    grants: ["organizations:content-review"],
  },
  sponsorshipManager: {
    description: "Runs the sponsorship pipeline",
    grants: ["sponsorships:read", "sponsorships:write"],
  },
  formsEditor: { description: "Authors reusable forms", grants: ["forms:read", "forms:write"] },
  userAdministrator: { description: "Reads and edits user records", grants: ["users:read", "users:write"] },
  accessGranter: { description: "Grants access, but cannot take it away", grants: ["access:grant"] },
  accessRevoker: { description: "Revokes access, but cannot hand it out", grants: ["access:revoke"] },
  proposalReviewer: { description: "Reads and scores proposals", grants: ["proposals:read", "proposals:score"] },
  proposalManager: { description: "Decides proposals", grants: ["proposals:manage"] },
  acceptedProposalEditor: {
    description: "Corrects and cancels accepted proposals, a deliberately separate authority",
    grants: ["proposals:edit_accepted_abstract", "proposals:cancel_accepted"],
  },
  agendaEditor: { description: "Builds the event agenda", grants: ["agenda:read", "agenda:write"] },
  eventReader: { description: "Reads event configuration", grants: ["events:read"] },
  eventEditor: { description: "Edits event configuration", grants: ["events:write"] },
  eventManager: { description: "Full event management, including registrations", grants: ["events:manage"] },
  membershipWriter: {
    description: "Moves applications but cannot approve one",
    grants: ["membership:read", "membership:write"],
  },
  membershipApprover: {
    description: "Approves membership applications",
    grants: ["membership:read", "membership:write", "membership:approve"],
  },
  groupsEditor: { description: "Edits group configuration", grants: ["groups:read", "groups:write"] },
  voteOrganizer: {
    description: "Creates and manages votes without leading a group",
    grants: ["votes:create", "votes:manage"],
  },
  platformOperator: {
    description: "The residual admin pair used by routes with no named module yet",
    grants: ["admin:read", "admin:write"],
  },
} as const satisfies Record<string, { description: string; grants: readonly Permission[] }>;

export const CAPABILITY_PERSONAS: Record<string, PersonaDefinition> = Object.fromEntries(
  Object.entries(CAPABILITY_PROFILES).map(([key, profile]) => [
    key,
    {
      key,
      description: profile.description,
      membershipCategory: null,
      organizationCount: 0,
      roles: [],
      grants: [...profile.grants],
      mayVote: false,
    },
  ]),
);

/** Every persona: the people with roles, and the narrow capability profiles. */
export const ALL_PERSONAS: Record<string, PersonaDefinition> = { ...PERSONAS, ...CAPABILITY_PERSONAS };
export const ALL_PERSONA_KEYS = Object.keys(ALL_PERSONAS);
