import { z } from "zod";
import { accountPolicyKeySchema } from "../account-policies";
import { requiresSession } from "./route-contract";

/** The account policies the signed-in account accepted in their current version. */
export const accountPoliciesResponseSchema = z.object({
  accepted: z.array(accountPolicyKeySchema),
});
export type AccountPoliciesResponse = z.infer<typeof accountPoliciesResponseSchema>;

export const accountPoliciesGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "List the account policies the current user accepted",
  description:
    "Event registration and proposal forms leave out the terms these policies cover, so the person is not asked again.",
  responses: {
    "200": {
      description: "Accepted account policies.",
      content: { "application/json": { schema: accountPoliciesResponseSchema } },
    },
  },
};
