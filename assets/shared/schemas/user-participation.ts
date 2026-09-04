/**
 * What a person has actually done in the consortium, as a record page states it.
 *
 * This is a read model, not a projection of one table: group standing comes
 * from `group_memberships`, attendance from the join confirmations against each
 * group's meeting occurrences, and the headline figures are the same numbers
 * aggregated. It is a separate resource from the user detail because it answers
 * a different question — the detail says who someone is, this says what they
 * have taken part in — and because it is the expensive half.
 *
 * Every instant is a UTC ISO-8601 string; the viewer's locale is applied at the
 * rendering boundary, never here.
 */
import { z } from "zod";

import { userIdParamsSchema, utcInstantSchema } from "./api-common";
import { groupLabelSchema } from "./groups";

/**
 * One group the person sits in, with how reliably they attend it.
 *
 * `held` counts the meetings that have already happened, so a group whose
 * first meeting is next week reads as 0 of 0 rather than as an absence. A
 * caller showing a proportion must handle `held === 0` — there is no rate to
 * report, and rendering 0% would accuse someone of missing meetings that were
 * never held.
 */
export const userGroupParticipationSchema = z.object({
  group: groupLabelSchema,
  /** The seat's own title where the roster records one — "Chair", "Treasurer". */
  title: z.string().nullable(),
  joinedAt: utcInstantSchema,
  /** Meetings of this group the person joined. */
  attended: z.number().int().nonnegative(),
  /** Meetings of this group that have taken place since they joined. */
  held: z.number().int().nonnegative(),
  /** When they were last in one, or null if never. */
  lastAttendedAt: utcInstantSchema.nullable(),
});

/** The headline figures a record shows at a glance. */
export const userParticipationSummarySchema = z.object({
  groupCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  meetingsAttended: z.number().int().nonnegative(),
  meetingsHeld: z.number().int().nonnegative(),
});

export const userParticipationSchema = z.object({
  groups: z.array(userGroupParticipationSchema),
  summary: userParticipationSummarySchema,
});

export const userParticipationResponseSchema = z.object({
  participation: userParticipationSchema,
});

export type UserGroupParticipation = z.infer<typeof userGroupParticipationSchema>;
export type UserParticipation = z.infer<typeof userParticipationSchema>;

export const userParticipationRouteSchema = {
  tags: ["Users"],
  summary: "Get a user's group participation and attendance",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "Group participation with attendance, and the headline figures.",
      content: { "application/json": { schema: userParticipationResponseSchema } },
    },
    "400": { description: "Invalid user identifier." },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
  },
};
