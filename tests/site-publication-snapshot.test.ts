import { seedEventAndAdmin } from "./helpers/context";
import { eventFormsResponseSchema } from "../assets/shared/schemas/forms";
import { publishedFormResourcesForPath } from "../assets/shared/published-resource-url";
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";

it("exports approved public profiles and their media while excluding inactive memberships and private keys", async () => {
  const active = await insertOrganization(env.DB, "Synthetic published organization");
  const inactive = await insertOrganization(env.DB, "Synthetic withdrawn organization");
  await seedOrganizationAggregate(env.DB, active);
  const withdrawn = await seedOrganizationAggregate(env.DB, inactive);
  await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(withdrawn).run();
  await env.DB.prepare(
    "UPDATE organizations SET slug = 'synthetic-published', logo_r2_key = 'private/synthetic-original.png', content_markdown = 'Approved public profile', data_json = ? WHERE id = ?",
  )
    .bind(JSON.stringify({ description: "Synthetic approved description" }), active)
    .run();
  const snapshot = await readSitePublicationSnapshot(env.DB, []);
  expect(snapshot.snapshotId).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.members.map((member) => member.name)).toContain("Synthetic published organization");
  expect(snapshot.members.map((member) => member.name)).not.toContain("Synthetic withdrawn organization");
  expect(snapshot.members.find((member) => member.id === active)?.content).toBe("Approved public profile");
  expect(JSON.stringify(snapshot)).not.toContain("private/synthetic-original.png");
  const references = publishedMediaReferences(snapshot);
  expect(references).toContain(`/api/v1/members/${active}/logo`);
  expect(await resolvePublishedMediaKeys(env.DB, references)).toMatchObject({
    [`/api/v1/members/${active}/logo`]: "private/synthetic-original.png",
  });
});

it("fingerprints public changes without source-write triggers or invalidation for private metadata", async () => {
  const organization = await insertOrganization(env.DB, "Synthetic fingerprint organization");
  await seedOrganizationAggregate(env.DB, organization);
  const before = await readSitePublicationSnapshot(env.DB, []);
  const author = await insertUser(env.DB, "synthetic-review-author@example.test");
  await env.DB.prepare(
    `INSERT INTO organization_content_reviews
      (id, organization_id, submitted_by_user_id, proposed_changes_json, logo_staging_r2_key, status, submitted_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      organization,
      author,
      JSON.stringify({ contentMarkdown: "Private pending draft" }),
      "private/pending-logo.png",
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    )
    .run();
  const pending = await readSitePublicationSnapshot(env.DB, []);
  expect(pending.snapshotId).toBe(before.snapshotId);
  expect(JSON.stringify(pending)).not.toContain("Private pending draft");
  expect(JSON.stringify(pending)).not.toContain("private/pending-logo.png");
  await env.DB.prepare("UPDATE organizations SET updated_at = '2026-10-01T01:00:00.000Z' WHERE id = ?")
    .bind(organization)
    .run();
  expect((await readSitePublicationSnapshot(env.DB, [])).snapshotId).toBe(before.snapshotId);
  await env.DB.prepare("UPDATE organizations SET content_markdown = 'Approved changed content' WHERE id = ?")
    .bind(organization)
    .run();
  const changed = await readSitePublicationSnapshot(env.DB, []);
  expect(changed.snapshotId).not.toBe(before.snapshotId);
  expect((await readSitePublicationSnapshot(env.DB, [])).snapshotId).toBe(changed.snapshotId);
  const tracking = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE name LIKE 'site_publication_%' AND type IN ('table', 'trigger')",
  ).all();
  expect(tracking.results).toEqual([]);
});

it("publishes authored legacy event forms while excluding private portal events and unrelated pages", async () => {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare("UPDATE events SET source_mode = 'hugo', visibility = 'invitation_only' WHERE id = ?")
    .bind(eventId)
    .run();
  const key = "/api/v1/events/pqc-2026/forms/placements/event_registration";
  expect((await readSitePublicationSnapshot(env.DB, [])).publicResources).not.toHaveProperty(key);
  const snapshot = await readSitePublicationSnapshot(env.DB, [], ["pqc-2026"]);
  expect(eventFormsResponseSchema.parse(snapshot.publicResources[key]).event.slug).toBe("pqc-2026");
  expect(publishedFormResourcesForPath(snapshot.publicResources, "/events/2026/pqc-2026/register/")).toHaveProperty(
    key,
  );
  expect(publishedFormResourcesForPath(snapshot.publicResources, "/about/")).not.toHaveProperty(key);
  const groupId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at) VALUES (?, 'working_group', 'Synthetic private event owner', 'synthetic-private-event-owner', 1, ?, ?)",
  )
    .bind(groupId, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")
    .run();
  await env.DB.prepare("UPDATE events SET source_mode = 'portal', owner_group_id = ? WHERE id = ?")
    .bind(groupId, eventId)
    .run();
  expect((await readSitePublicationSnapshot(env.DB, [], ["pqc-2026"])).publicResources).not.toHaveProperty(key);
  expect((await readSitePublicationSnapshot(env.DB, [], ["pqc-2026"])).eventFlows).toEqual([]);
  await env.DB.prepare("UPDATE events SET visibility = 'public' WHERE id = ?").bind(eventId).run();
  const published = await readSitePublicationSnapshot(env.DB, []);
  expect(published.eventFlows).toHaveLength(8);
  expect(published.eventFlows).toContainEqual({
    eventName: "PQC Conference 2026",
    flow: "registration",
    route: "/events/2026/pqc-2026/register/",
  });
  expect(published.publicResources).toHaveProperty(key);
  await env.DB.prepare("UPDATE events SET visibility = 'invitation_only' WHERE id = ?").bind(eventId).run();
  expect((await readSitePublicationSnapshot(env.DB, [])).eventFlows).toEqual([]);
});

it("exports the existing public site when the additive agenda schema is not installed", async () => {
  const baseline = await readSitePublicationSnapshot(env.DB, []);
  await env.DB.prepare("ALTER TABLE event_agenda_publications RENAME TO test_saved_agenda_publications").run();
  await env.DB.prepare("ALTER TABLE event_agenda_state RENAME TO test_saved_agenda_state").run();
  try {
    const snapshot = await readSitePublicationSnapshot(env.DB, []);
    expect(snapshot.eventAgendas).toEqual({});
    expect(snapshot.members).toEqual(baseline.members);
    expect(snapshot.publicResources).toEqual(baseline.publicResources);
    expect(snapshot.eventFlows).toEqual(baseline.eventFlows);
  } finally {
    await env.DB.prepare("ALTER TABLE test_saved_agenda_state RENAME TO event_agenda_state").run();
    await env.DB.prepare("ALTER TABLE test_saved_agenda_publications RENAME TO event_agenda_publications").run();
  }
});

it("refuses a partially installed agenda publication schema", async () => {
  await env.DB.prepare("ALTER TABLE event_agenda_publications RENAME TO test_saved_agenda_publications").run();
  try {
    await expect(readSitePublicationSnapshot(env.DB, [])).rejects.toThrow("publication schema is incomplete");
  } finally {
    await env.DB.prepare("ALTER TABLE test_saved_agenda_publications RENAME TO event_agenda_publications").run();
  }
});

it("propagates agenda extraction failures when the feature tables exist", async () => {
  const original = env.DB;
  const broken = {
    prepare(sql: string) {
      if (sql.includes("FROM event_agenda_publications p")) throw new Error("Synthetic agenda database failure");
      return original.prepare(sql);
    },
    batch: original.batch.bind(original),
  };
  await expect(readSitePublicationSnapshot(broken, [])).rejects.toThrow("Synthetic agenda database failure");
});
