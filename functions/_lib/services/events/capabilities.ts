import { hasPermission } from "../../auth/permissions";
import type { UserBackedAuthAdmin } from "../../types";

export function eventManagementCapabilities(
  actor: UserBackedAuthAdmin,
  context: { type: string; id: string },
): Array<"read" | "write" | "manage"> {
  return [
    ...(hasPermission(actor, "events:read", context) ? (["read"] as const) : []),
    ...(hasPermission(actor, "events:write", context) ? (["write"] as const) : []),
    ...(hasPermission(actor, "events:manage", context) ? (["manage"] as const) : []),
  ];
}
