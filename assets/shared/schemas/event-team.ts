import { z } from "zod";
import { agendaRoleMemberSchema } from "./event-agenda";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";

export const EVENT_TEAM_ROLES = ["organizer", "program_committee", "moderator", "volunteer"] as const;
export const eventTeamRoleSchema = z.enum(EVENT_TEAM_ROLES);
export type EventTeamRole = z.infer<typeof eventTeamRoleSchema>;

/** Canonical API role names map one-to-one to the persisted RBAC catalog. */
export const EVENT_TEAM_ROLE_IDS = {
  organizer: "role-event_organizer",
  program_committee: "role-program_committee",
  moderator: "role-event_moderator",
  volunteer: "role-event_volunteer",
} as const satisfies Record<EventTeamRole, string>;
export type EventTeamRoleId = (typeof EVENT_TEAM_ROLE_IDS)[EventTeamRole];

export const EVENT_TEAM_SORT_COLUMNS = ["userEmail", "role", "createdAt", "expiresAt"] as const;
export const eventTeamSortValueSchema = sortColumnSchema(EVENT_TEAM_SORT_COLUMNS);
export const eventTeamListQuerySchema = searchableListQuerySchema(eventTeamSortValueSchema, {
  limit: 100,
});
export type EventTeamListQuery = z.infer<typeof eventTeamListQuerySchema>;

export const eventTeamRoleAssignmentSchema = z.object({
  id: databaseIdSchema,
  userEmail: z.email(),
  userId: databaseIdSchema,
  /** The person behind the assignment, so a roster row reads as a person and opens their record. */
  userFirstName: z.string().nullable(),
  userLastName: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  role: eventTeamRoleSchema,
  grantedByUserId: databaseIdSchema.nullable(),
  expiresAt: utcInstantSchema.nullable(),
  createdAt: utcInstantSchema,
  granterEmail: z.email().nullable(),
});
export type EventTeamRoleAssignment = z.infer<typeof eventTeamRoleAssignmentSchema>;

export const eventTeamRolesResponseSchema = paginatedResponseSchema("roles", eventTeamRoleAssignmentSchema);

/**
 * A team role is granted to a person the portal already knows: the form
 * finds them with the user picker and sends their id. Nothing is created by
 * address — an unknown address used to become an empty account on the spot,
 * which is not what "add a team member" means (#88).
 */
export const eventTeamRoleCreateSchema = z.object({
  userId: databaseIdSchema,
  role: eventTeamRoleSchema,
  expiresAt: utcInstantSchema.nullable().optional(),
});
export type EventTeamRoleCreate = z.infer<typeof eventTeamRoleCreateSchema>;

export const eventTeamRoleCreateResponseSchema = z.object({
  role: eventTeamRoleAssignmentSchema,
});

/** One person per event roster; access grants remain separate from scheduling duties. */
export const eventTeamPersonSchema = z.object({
  userId: databaseIdSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  accessRoles: z.array(eventTeamRoleAssignmentSchema.pick({ id: true, role: true, expiresAt: true, createdAt: true })),
  staffing: agendaRoleMemberSchema.nullable(),
  duties: z.array(z.string()),
});
export type EventTeamPerson = z.infer<typeof eventTeamPersonSchema>;
export const eventTeamRosterQuerySchema = searchableListQuerySchema(sortColumnSchema(["person"] as const)).extend({
  userId: databaseIdSchema.optional(),
});
export type EventTeamRosterQuery = z.infer<typeof eventTeamRosterQuerySchema>;
export const eventTeamRosterResponseSchema = paginatedResponseSchema("people", eventTeamPersonSchema);
