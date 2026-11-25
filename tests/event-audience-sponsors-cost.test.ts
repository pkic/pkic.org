import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { prepareEventAudienceSponsors } from "../functions/_lib/services/events/scanner-access";
import type { EventReadSelection } from "../functions/_lib/services/events/read-selection";
import { seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const UNRELATED_SPONSORSHIPS = 300;

/** Active sponsorships of other organizations, none of which this viewer has any link to. */
async function seedUnrelatedSponsorships(eventId: string) {
  const organizationId = await insertOrganization(env.DB);
  const statements = Array.from({ length: UNRELATED_SPONSORSHIPS }, (_, index) =>
    env.DB.prepare(
      `INSERT INTO sponsorships(id,sponsor_type,event_id,organization_id,tier,contact_email,pipeline_stage,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ).bind(
      crypto.randomUUID(),
      index % 2 ? "consortium" : "event",
      index % 2 ? null : eventId,
      organizationId,
      index % 2 ? "Titanium" : "Leader",
      `sponsor-${index}@synthetic.test`,
    ),
  );
  await env.DB.batch(statements);
  await env.DB.prepare("INSERT INTO event_consortium_lead_tiers(event_id,tier,created_at) VALUES(?,'Titanium',?)")
    .bind(eventId, new Date().toISOString())
    .run();
}

async function rowsReadFor(userId: string, selection: EventReadSelection) {
  // The local D1 binding reports how many rows the statement read.
  const result = (await prepareEventAudienceSponsors(
    env.DB,
    { userId, scannerGrants: [], admin: { identityType: "user", id: userId, email: "viewer@synthetic.test" } },
    selection,
  ).all()) as D1Result;
  expect(result.results).toEqual([]);
  return result.meta.rows_read ?? Number.POSITIVE_INFINITY;
}

beforeEach(async () => {
  await resetDb();
});

describe("event audience sponsor discovery cost", () => {
  it("reads none of the sponsorships a signed-in viewer has no link to", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await seedUnrelatedSponsorships(eventId);
    const viewerId = await insertUser(env.DB, "viewer@synthetic.test");

    const selections: EventReadSelection[] = [
      [eventId],
      { slug: "pqc-2026" },
      { pages: [{ sql: "SELECT id FROM events", orderBy: "id", limit: 20, offset: 0 }] },
    ];
    for (const selection of selections) {
      // Every event page runs this for its viewer; its cost stays flat as sponsorships grow.
      expect(await rowsReadFor(viewerId, selection)).toBeLessThan(UNRELATED_SPONSORSHIPS / 10);
    }
  });
});
