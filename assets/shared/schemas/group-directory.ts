/** Public directory projections for any configured group type. */
import { z } from "zod";
import { groupLabelSchema, groupLeadershipRoleIdSchema } from "./groups";
import { publicOrganizationPersonSchema } from "./public-person";

export const publicGroupLeadershipAssignmentSchema = z.object({
  roleId: groupLeadershipRoleIdSchema,
  person: publicOrganizationPersonSchema,
  sourceGroup: groupLabelSchema.nullable(),
  inherited: z.boolean(),
});
export type PublicGroupLeadershipAssignment = z.infer<typeof publicGroupLeadershipAssignmentSchema>;

export const groupDirectoryResponseSchema = z.object({
  group: groupLabelSchema,
  mailingListEmail: z.email().nullable(),
  leadership: z.array(publicGroupLeadershipAssignmentSchema),
});
export type GroupDirectoryResponse = z.infer<typeof groupDirectoryResponseSchema>;

export const groupDirectoryParamsSchema = z.object({ groupId: z.string().trim().min(1).max(200) });

export const groupDirectoryRouteSchema = {
  tags: ["Groups"],
  summary: "Get a public group directory",
  description: "Returns public metadata and configured public leadership for any active, publicly visible group type.",
  request: { params: groupDirectoryParamsSchema },
  responses: {
    "200": {
      description: "Public group directory.",
      content: { "application/json": { schema: groupDirectoryResponseSchema } },
    },
    "404": { description: "Group not found or not publicly visible." },
  },
};
