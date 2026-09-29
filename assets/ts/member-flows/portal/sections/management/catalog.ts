import type { z } from "zod";
import {
  groupTypesListResponseSchema,
  groupsListResponseSchema,
  type Group,
  type GroupType,
} from "../../../../../shared/schemas/groups";
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

/** Group types are reference data; search and paging remain server-backed. */
export const activeGroupTypeCatalog: ServerCatalog<GroupType, z.infer<typeof groupTypesListResponseSchema>> = {
  endpoint: "/api/v1/groups/types",
  responseSchema: groupTypesListResponseSchema,
  resolveItems: (response) => response.groupTypes,
  resolvePage: (response) => response.page,
  itemKey: (type) => type.key,
  itemLabel: (type) => `${type.pluralLabel} — ${type.description ?? type.singularLabel}`,
  params: { active: "true" },
  sort: "sort_order",
};
