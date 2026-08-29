import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";

export const EVENT_TEAM_ROLES = ["organizer", "program_committee", "moderator", "volunteer"] as const;
export const eventTeamRoleSchema = z.enum(EVENT_TEAM_ROLES);
export type EventTeamRole = z.infer<typeof eventTeamRoleSchema>;

/** Canonical API role names map one-to-one to the persisted RBAC catalogue. */
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
  role: eventTeamRoleSchema,
  grantedByUserId: databaseIdSchema.nullable(),
  expiresAt: utcInstantSchema.nullable(),
  createdAt: utcInstantSchema,
  granterEmail: z.email().nullable(),
});
export type EventTeamRoleAssignment = z.infer<typeof eventTeamRoleAssignmentSchema>;

export const eventTeamRolesResponseSchema = paginatedResponseSchema("roles", eventTeamRoleAssignmentSchema);

export const eventTeamRoleCreateSchema = z.object({
  userEmail: z.email().trim().toLowerCase(),
  role: eventTeamRoleSchema,
  expiresAt: utcInstantSchema.nullable().optional(),
});
export type EventTeamRoleCreate = z.infer<typeof eventTeamRoleCreateSchema>;

export const eventTeamRoleCreateResponseSchema = z.object({
  role: eventTeamRoleAssignmentSchema,
});
