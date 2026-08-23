import { describe, expect, it } from "vitest";
import { EVENT_TEAM_PERMISSION_ROLE_IDS, eventTeamPermissionSchema } from "../assets/shared/schemas/admin-events";
import { eventTeamPermissionForRoleId } from "../functions/_lib/services/events/team";

describe("event-team permission role vocabulary", () => {
  it("keeps the shared permission-to-role mapping bijective", () => {
    const permissions = [...eventTeamPermissionSchema.options];
    const roleIds = Object.values(EVENT_TEAM_PERMISSION_ROLE_IDS);

    expect(Object.keys(EVENT_TEAM_PERMISSION_ROLE_IDS).sort()).toEqual([...permissions].sort());
    expect(new Set(roleIds).size).toBe(roleIds.length);

    for (const permission of permissions) {
      const roleId = EVENT_TEAM_PERMISSION_ROLE_IDS[permission];
      expect(eventTeamPermissionForRoleId(roleId)).toBe(permission);
    }
  });

  it("rejects an unknown persisted event-team role ID", () => {
    expect(() => eventTeamPermissionForRoleId("role-event-unknown")).toThrow(
      "Event-team data contains an unsupported role",
    );
  });
});
