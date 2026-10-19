import type { z } from "zod";
import { publicMembersListResponseSchema, type PublicMemberSummary } from "../../shared/schemas/members-directory";
import type { ServerCatalog } from "./server-catalog";

/** Member organizations on the public directory, which any signed-in person may search. */
export const memberOrganizationCatalog: ServerCatalog<
  PublicMemberSummary,
  z.infer<typeof publicMembersListResponseSchema>
> = {
  endpoint: "/api/v1/members",
  params: { group: "organization" },
  responseSchema: publicMembersListResponseSchema,
  resolveItems: (response) => response.members,
  resolvePage: (response) => response.page,
  itemKey: (member) => member.id,
  itemLabel: (member) => member.name,
  sort: "name",
};
