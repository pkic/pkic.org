import { describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import {
  legacyEventFormPlacementSql,
  legacyEventOwnershipSql,
} from "../../scripts/migrate-members/event-ownership.mjs";

/**
 * The import adopts the imported PQC conferences into the PQC working group
 * and, with them, the registration and proposal questions the public site
 * attached to those events. Those forms are event-scoped rows with no
 * placement, which is how a migrated database had forms nobody could find
 * from the group's Forms tab or the event's registration settings.
 */
describe("legacy event ownership", () => {
  it("adopts only unowned conferences into the PQC group and renders one statement", () => {
    const sql = legacyEventOwnershipSql();
    expect(unstable_splitSqlQuery(sql)).toHaveLength(1);
    expect(sql).toContain("WHERE owner_group_id IS NULL");
    expect(sql).toContain("'pqc-conference-amsterdam-nl'");
  });

  it("places each adopted conference's event-scoped forms under the owning group, once, by audience", () => {
    const sql = legacyEventFormPlacementSql();
    expect(unstable_splitSqlQuery(sql)).toHaveLength(1);
    expect(sql).toContain("INSERT OR IGNORE INTO form_placements");
    expect(sql).toContain("f.scope_type = 'event'");
    expect(sql).toContain("e.owner_group_id IS NOT NULL");
    // The audience a portal-authored form of the same purpose would get.
    expect(sql).toContain("WHEN 'event_registration' THEN 'attendee'");
    expect(sql).toContain("WHEN 'proposal_submission' THEN 'speaker'");
    // Re-running the import must not place the same form twice.
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM form_placements fp/);
  });
});
