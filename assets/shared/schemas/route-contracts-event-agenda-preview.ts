import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import { agendaSnapshotSchema } from "./event-agenda";
import { ok, authErrors, requiresPermissions } from "./route-contract";

export const agendaPreviewQuerySchema = z.object({ revision: z.enum(["draft", "approved"]).default("draft") });
export const agendaPreviewRouteSchema = {
  tags: ["Event agenda"],
  summary: "Preview the exact public agenda projection without publication",
  request: { params: eventSlugParamsSchema, query: agendaPreviewQuerySchema },
  responses: {
    ...ok("Public agenda preview", agendaSnapshotSchema),
    ...authErrors({ badRequest: "Invalid preview request", notFound: "Event or approved revision not found" }),
  },
  ...requiresPermissions("agenda:read"),
};
