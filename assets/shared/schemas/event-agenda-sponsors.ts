import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { publicSponsorItemSchema } from "./public-sponsors";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { eventSlugParamsSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/** Sponsorship records are event-owned; a public display ID may instead identify its organization. */
export const agendaSponsorIdsSchema = z
  .array(databaseIdSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each sponsor once");
export const agendaBreakSponsorDisplaySchema = publicSponsorItemSchema.pick({
  id: true,
  name: true,
  website: true,
  logoUrl: true,
});
export type AgendaBreakSponsorDisplay = z.infer<typeof agendaBreakSponsorDisplaySchema>;
export const agendaSponsorChoicesQuerySchema = listQuerySchema(["name"] as const);
export const agendaSponsorChoicesResponseSchema = paginatedResponseSchema(
  "sponsors",
  z.object({
    sponsorId: databaseIdSchema,
    display: publicSponsorItemSchema,
  }),
);
export const agendaSponsorChoicesRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Event agenda"],
  summary: "Choose publicly displayed event sponsors",
  request: { params: eventSlugParamsSchema, query: agendaSponsorChoicesQuerySchema },
  responses: {
    ...ok("Event sponsor choices", agendaSponsorChoicesResponseSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};
