import { PERMISSIONS } from "../../assets/shared/schemas/permissions";

/** Permission snapshot for an administrator fixture; D1 still rechecks mutations. */
export const administratorGrants = PERMISSIONS.map((permission) => ({
  permission,
  contextType: null,
  contextId: null,
}));
