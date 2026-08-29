import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { EVENT_TEAM_ROLE_IDS, eventTeamRoleSchema } from "../assets/shared/schemas/event-team";
import { eventTeamRoleForRoleId } from "../functions/_lib/services/events/team";

describe("event-team role vocabulary", () => {
  it("keeps the shared API-to-persistence role mapping bijective", () => {
    const roles = [...eventTeamRoleSchema.options];
    const roleIds = Object.values(EVENT_TEAM_ROLE_IDS);

    expect(Object.keys(EVENT_TEAM_ROLE_IDS).sort()).toEqual([...roles].sort());
    expect(new Set(roleIds).size).toBe(roleIds.length);

    for (const role of roles) {
      const roleId = EVENT_TEAM_ROLE_IDS[role];
      expect(eventTeamRoleForRoleId(roleId)).toBe(role);
    }
  });

  it("rejects an unknown persisted event-team role ID", () => {
    expect(() => eventTeamRoleForRoleId("role-event-unknown")).toThrow("Event-team data contains an unsupported role");
  });

  it("keeps every canonical event-team role present in the migrated role catalogue", async () => {
    const expected = Object.values(EVENT_TEAM_ROLE_IDS).sort();
    const rows = await env.DB.prepare(
      "SELECT id FROM roles WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id ASC",
    )
      .bind(JSON.stringify(expected))
      .all<{ id: string }>();

    expect(rows.results.map(({ id }) => id)).toEqual(expected);
  });
});
