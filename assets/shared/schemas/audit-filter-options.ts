import { z } from "zod";
import { listFilterOptionsQuerySchema, listFilterOptionsResponseSchema } from "./list-filter-options";
import { requiresPermissions } from "./route-contract";

export const auditFilterOptionsQuerySchema = listFilterOptionsQuerySchema.extend({
  field: z.enum(["action", "entityType", "actorType"]),
});
export type AuditFilterOptionsQuery = z.infer<typeof auditFilterOptionsQuerySchema>;
export const auditFilterOptionsRouteSchema = {
  ...requiresPermissions("audit:read"),
  tags: ["Audit log"],
  summary: "List distinct audit column filter choices",
  request: { query: auditFilterOptionsQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of available values.",
      content: { "application/json": { schema: listFilterOptionsResponseSchema } },
    },
    "401": { description: "Authentication is required." },
    "403": { description: "The identity lacks audit:read." },
  },
};
