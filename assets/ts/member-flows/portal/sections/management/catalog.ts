import type { z } from "zod";
import { groupsListResponseSchema, type Group } from "../../../../../shared/schemas/groups";
import type { ServerCatalog } from "../../../../shared/server-catalog";

/** Every management surface resolves its group through this canonical projection. */
export const managedGroupCatalog: ServerCatalog<Group, z.infer<typeof groupsListResponseSchema>> = {
  endpoint: "/api/v1/groups",
  responseSchema: groupsListResponseSchema,
  resolveItems: (response) => response.groups,
  resolvePage: (response) => response.page,
  itemKey: (group) => group.id,
  itemLabel: (group) => `${group.name} (${group.type.singularLabel})${group.active ? "" : " — inactive"}`,
  params: { manageable: "true" },
  sort: "name",
};
