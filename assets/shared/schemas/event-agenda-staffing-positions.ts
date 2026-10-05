import { z } from "zod";
/** Staffing retains intentional natural IDs for existing blocks and configurable roles. */
export const agendaStaffingResourceIdSchema = z.string().trim().min(1).max(200);
const id = agendaStaffingResourceIdSchema;
export const agendaStaffingRoleSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  showOnAgenda: z.boolean().default(false),
});
export const agendaStaffingPostSchema = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  roomId: id.nullable(),
});
export const agendaStaffingRequirementSchema = z.object({
  id,
  blockId: id,
  roleId: id,
  postId: id.nullable(),
  idealCount: z.number().int().min(1).max(50),
  seniority: z.enum(["any", "senior"]).default("any"),
  attendanceMode: z.enum(["any", "physical", "remote"]).default("any"),
});
export const agendaStaffingPositionSchema = z.object({ id, requirementId: id, index: z.number().int().min(1).max(50) });
export const agendaStaffingAssignmentFieldsSchema = z.object({
  userId: id,
  pinned: z.boolean(),
  origin: z.enum(["manual", "generated"]).optional(),
});
export const agendaStaffingPositionAssignmentSchema = agendaStaffingAssignmentFieldsSchema.extend({
  positionId: id,
  blockId: id,
  role: id,
  postId: id.nullable(),
});
export const agendaStaffingPositionPlanSchema = z
  .object({
    roles: z.array(agendaStaffingRoleSchema).max(100),
    posts: z.array(agendaStaffingPostSchema).max(200),
    requirements: z.array(agendaStaffingRequirementSchema).max(1000),
    positions: z.array(agendaStaffingPositionSchema).max(2000),
    assignments: z.array(agendaStaffingPositionAssignmentSchema).max(2000),
  })
  .superRefine((plan, context) => {
    for (const field of ["roles", "posts", "requirements", "positions"] as const)
      if (new Set(plan[field].map((row) => row.id)).size !== plan[field].length)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Choose a unique identity for each staffing resource",
        });
    for (const [index, requirement] of plan.requirements.entries()) {
      if (
        !plan.roles.some((role) => role.id === requirement.roleId) ||
        (requirement.postId && !plan.posts.some((post) => post.id === requirement.postId))
      )
        context.addIssue({
          code: "custom",
          path: ["requirements", index],
          message: "Choose an event role and event post",
        });
      const slots = plan.positions.filter((position) => position.requirementId === requirement.id);
      if (
        slots.length !== requirement.idealCount ||
        new Set(slots.map((slot) => slot.index)).size !== slots.length ||
        slots.some((slot) => slot.index > requirement.idealCount)
      )
        context.addIssue({
          code: "custom",
          path: ["positions"],
          message: "Provide one distinct position for each requested person",
        });
    }
    for (const [index, position] of plan.positions.entries())
      if (!plan.requirements.some((requirement) => requirement.id === position.requirementId))
        context.addIssue({
          code: "custom",
          path: ["positions", index, "requirementId"],
          message: "Choose an existing staffing requirement",
        });
    const assigned = new Set<string>();
    for (const [index, assignment] of plan.assignments.entries()) {
      if (
        assigned.has(assignment.positionId) ||
        !plan.positions.some((position) => position.id === assignment.positionId)
      )
        context.addIssue({
          code: "custom",
          path: ["assignments", index, "positionId"],
          message: "Assign each existing position once",
        });
      assigned.add(assignment.positionId);
      const position = plan.positions.find((row) => row.id === assignment.positionId);
      const requirement = plan.requirements.find((row) => row.id === position?.requirementId);
      if (
        requirement &&
        (assignment.blockId !== requirement.blockId ||
          assignment.role !== requirement.roleId ||
          assignment.postId !== requirement.postId)
      )
        context.addIssue({
          code: "custom",
          path: ["assignments", index],
          message: "Assignment must match its position's block, role and post",
        });
    }
  });
export type AgendaStaffingPositionPlan = z.infer<typeof agendaStaffingPositionPlanSchema>;
