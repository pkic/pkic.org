/**
 * Public directory projections for any configured group type.
 *
 * One endpoint serves every public governance surface: a working group's
 * chairs in its sidebar, the consortium chair and vice chair on the About
 * page, and the dated Board of Directors and Executive Council rosters. What
 * a group publishes is decided by its own `publicLeadership` and
 * `publicRoster` switches, never by a route or a hard-coded body list.
 */
import { z } from "zod";
import { groupLabelSchema, groupLeadershipRoleIdSchema, groupLeadershipTitleSchema } from "./groups";
import { publicOrganizationPersonSchema } from "./public-person";
import { publicOperation } from "./route-contract";

/** A dated public seat or term: who, called what, and since or during when. */
const publicGroupTenureShape = {
  person: publicOrganizationPersonSchema,
  title: groupLeadershipTitleSchema,
  startsAt: z.string(),
  endsAt: z.string().nullable(),
};

export const publicGroupLeadershipAssignmentSchema = z.object({
  ...publicGroupTenureShape,
  roleId: groupLeadershipRoleIdSchema,
  sourceGroup: groupLabelSchema.nullable(),
  inherited: z.boolean(),
});
export type PublicGroupLeadershipAssignment = z.infer<typeof publicGroupLeadershipAssignmentSchema>;

export const publicGroupRosterEntrySchema = z.object(publicGroupTenureShape);
export type PublicGroupRosterEntry = z.infer<typeof publicGroupRosterEntrySchema>;

/**
 * The published member roster. Current seats list leaders first with their
 * leadership title, then members with their seat title or "Member". Past
 * entries are closed seats and closed leadership terms, most recently ended
 * first, which is what the public "past positions" timeline renders.
 */
export const publicGroupRosterSchema = z.object({
  current: z.array(publicGroupRosterEntrySchema),
  past: z.array(publicGroupRosterEntrySchema),
});
export type PublicGroupRoster = z.infer<typeof publicGroupRosterSchema>;

export const groupDirectoryResponseSchema = z.object({
  group: groupLabelSchema,
  mailingListEmail: z.email().nullable(),
  /** Effective leadership now; empty unless the group publishes leadership. */
  leadership: z.array(publicGroupLeadershipAssignmentSchema),
  /** Closed local leadership terms; empty unless the group publishes leadership. */
  pastLeadership: z.array(publicGroupLeadershipAssignmentSchema),
  /** Present only when the group publishes its roster. */
  roster: publicGroupRosterSchema.nullable(),
});
export type GroupDirectoryResponse = z.infer<typeof groupDirectoryResponseSchema>;

export const groupDirectoryParamsSchema = z.object({ groupId: z.string().trim().min(1).max(200) });

export const groupDirectoryRouteSchema = {
  ...publicOperation(),
  tags: ["Groups"],
  summary: "Get a public group directory",
  description:
    "Returns public metadata, the configured public leadership with titles and tenures, and, for groups that " +
    "publish it, the dated member roster with its history.",
  request: { params: groupDirectoryParamsSchema },
  responses: {
    "200": {
      description: "Public group directory.",
      content: { "application/json": { schema: groupDirectoryResponseSchema } },
    },
    "404": { description: "Group not found or not publicly visible." },
  },
};
