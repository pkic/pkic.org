import type { EventGroupCapability } from "../../../../assets/shared/schemas/resource-grants";
import {
  getResourceGrantDefinition,
  isManagerResourceCapability,
  isParticipantResourceCapability,
  visibleResourceGrantCapabilitiesForContext,
  type GroupResourceContextAccess,
} from "../resource-grants";

export interface AccessibleGroupEventIdsCte {
  sql: string;
  bindings: readonly unknown[];
}

/**
 * Builds the canonical D1 access boundary for events viewed through one group.
 * The returned SQL is a trusted CTE fragment; all contextual values remain bound.
 */
export function buildAccessibleGroupEventIdsCte(
  groupId: string,
  access: GroupResourceContextAccess,
  capability: EventGroupCapability = "view",
): AccessibleGroupEventIdsCte {
  const definition = getResourceGrantDefinition("event");
  const ownerAllowed = isParticipantResourceCapability(definition, capability)
    ? access.member
    : isManagerResourceCapability(definition, capability)
      ? access.manager
      : access.member || access.manager;
  const visibleGrants = visibleResourceGrantCapabilitiesForContext(definition, capability, access);
  return {
    sql: `accessible_event AS (
      SELECT owned.id AS event_id
        FROM events owned INDEXED BY idx_events_owner_profile
       WHERE owned.owner_group_id = ? AND ? = 1
      ${
        visibleGrants.length > 0
          ? `UNION
      SELECT shared.event_id
        FROM event_group_grants shared INDEXED BY idx_event_group_grants_group
       WHERE shared.group_id = ?
         AND shared.capability IN (${visibleGrants.map(() => "?").join(", ")})`
          : ""
      }
    )`,
    bindings: [groupId, ownerAllowed ? 1 : 0, ...(visibleGrants.length > 0 ? [groupId, ...visibleGrants] : [])],
  };
}
