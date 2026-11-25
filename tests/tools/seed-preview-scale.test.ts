import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { buildPreviewScalePlan } from "../../scripts/lib/preview-scale/plan.mjs";
import { buildPersonas, dedupeRoster, PERSONA_ROLES } from "../../scripts/lib/preview-scale/personas.mjs";
import { insertStatements, MAX_STATEMENT_BYTES } from "../../scripts/lib/preview-scale/sql.mjs";
import { seedStatements } from "../../scripts/lib/preview-scale/statements.mjs";
import { buildSponsorships, seededBadgeCredential } from "../../scripts/lib/preview-scale/population.mjs";
import { eventOwnerStatements, newEvent, newEventStatements } from "../../scripts/lib/preview-scale/event.mjs";
import { badgeCredentialSchema } from "../../assets/shared/schemas/badge-credential";
import { sponsorConsentSql } from "../../functions/_lib/services/event-participation/sponsor-consent";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { chmodSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  assertOutsideRepository,
  ensurePasskeys,
  passkeyAssertion,
  passkeyStatements,
  publishAgenda,
  testOrigin,
} from "../../scripts/lib/preview-scale/passkeys.mjs";

const context = {
  eventId: "event-1",
  eventEndsAt: "2026-12-03T17:00:00.000Z",
  timeZone: "Europe/Amsterdam",
  roomOrder: ["existing-room"],
  actorUserId: "admin-1",
  days: [
    { id: "day-1", date: "2026-12-01" },
    { id: "day-2", date: "2026-12-02" },
  ],
  roles: new Set(PERSONA_ROLES.map((role) => role.roleId).filter((roleId) => roleId !== "role-event_studio_operator")),
};
const roster = [{ firstName: "Test", lastName: "Member", email: "test.member@example.org" }];

function plan() {
  return buildPreviewScalePlan({ attendees: 300, speakers: 40, context, roster });
}

describe("preview scale seed", () => {
  it("builds the same rows on every run", () => {
    expect(seedStatements(context, plan())).toEqual(seedStatements(context, plan()));
  });

  it("keeps every statement under the D1 statement limit", () => {
    for (const statement of seedStatements(context, plan()))
      expect(new TextEncoder().encode(statement).length).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
  });

  it("never books a speaker into two sessions at the same time", () => {
    const booked = new Set<string>();
    for (const session of plan().sessions)
      for (const userId of session.speakerUserIds) {
        const key = `${userId}:${session.startAt}`;
        expect(booked.has(key)).toBe(false);
        booked.add(key);
      }
  });

  it("schedules sessions in the event's own time zone", () => {
    const keynote = plan().sessions.find((session) => session.format === "keynote");
    expect(keynote?.startAt).toBe("2026-12-01T07:00:00.000Z");
  });

  it("issues badge codes the scanner accepts when typed", () => {
    expect(badgeCredentialSchema.safeParse(seededBadgeCredential("attendee:1")).success).toBe(true);
  });

  it("leaves out persona roles the database does not have", () => {
    const built = plan();
    expect(built.skippedRoles).toEqual(["role-event_studio_operator"]);
    expect(built.personas.map((persona: { email: string }) => persona.email)).not.toContain(
      "test.member+studio@example.org",
    );
  });

  it("grants persona roles on the seeded event only", () => {
    const grants = seedStatements(context, plan()).filter((statement) =>
      statement.startsWith("INSERT INTO user_roles"),
    );
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant).toContain("'event', 'event-1'");
  });
});

describe("persona roster", () => {
  it("keeps the team address when one person has two", () => {
    expect(
      dedupeRoster([
        { firstName: "Ada", lastName: "Lovelace", email: "ada@company.example" },
        { firstName: "Ada", lastName: "Lovelace", email: "Ada@pkic.org" },
        { firstName: "Jan", lastName: "van Dijk", email: "jan@company.example" },
        { firstName: "Jan", lastName: "Vandijk", email: "jan.vandijk@pkic.org" },
      ]),
    ).toEqual([
      { firstName: "Ada", lastName: "Lovelace", email: "ada@pkic.org" },
      { firstName: "Jan", lastName: "van Dijk", email: "jan.vandijk@pkic.org" },
    ]);
  });

  it("refuses an address that already carries a plus tag", () => {
    expect(() => dedupeRoster([{ firstName: "A", lastName: "B", email: "a+x@pkic.org" }])).toThrow();
  });

  it("creates one plus-addressed account per role", () => {
    const sponsorships = [{ id: "sponsorship-1", organizationId: "organization-1" }];
    expect(buildPersonas(roster, "event-1", sponsorships).map((persona: { email: string }) => persona.email)).toEqual(
      PERSONA_ROLES.map((role) => `test.member+${role.tag}@example.org`),
    );
    expect(buildPersonas(roster, "event-1", sponsorships)[0].lastName).toBe("Member Organizer");
  });

  it("gives every sponsor account a sponsorship of its own", () => {
    const people = Array.from({ length: 13 }, (_, index) => ({
      firstName: "Member",
      lastName: `${index}`,
      email: `member${index}@example.org`,
    }));
    const organizations = Array.from({ length: 20 }, (_, index) => ({ id: `organization-${index}` }));
    const sponsorships = buildSponsorships(organizations, "event-1", people.length);
    const sponsors = buildPersonas(people, "event-1", sponsorships).filter(
      (persona: { tag: string }) => persona.tag === "sponsor",
    );
    expect(new Set(sponsors.map((persona: { sponsorship: { id: string } }) => persona.sponsorship.id)).size).toBe(13);
    expect(buildSponsorships(organizations, "event-1").length).toBe(12);
  });

  it("leaves out the sponsor account when the event has no sponsorships", () => {
    expect(buildPersonas(roster, "event-1").map((persona: { tag: string }) => persona.tag)).not.toContain("sponsor");
  });
});

describe("test passkeys", () => {
  it("signs an assertion the Worker's verifier accepts", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "pkic-passkeys-")), "passkeys.json");
    const credential = (await ensurePasskeys(file, ["a+organizer@pkic.org"])).credentials["a+organizer@pkic.org"];
    const challenge = isoBase64URL.fromUTF8String("challenge-1");
    const origin = "https://stable.preview.pkic.org";
    const verification = await verifyAuthenticationResponse({
      response: await passkeyAssertion(credential, { challenge, origin, rpId: "preview.pkic.org" }),
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: "preview.pkic.org",
      credential: { id: credential.credentialId, publicKey: isoBase64URL.toBuffer(credential.publicKey), counter: 0 },
      requireUserVerification: true,
    });
    expect(verification.verified).toBe(true);
    expect((await ensurePasskeys(file, ["a+organizer@pkic.org"])).credentials["a+organizer@pkic.org"]).toEqual(
      credential,
    );
  });

  it("refuses production and a key file inside the repository", () => {
    expect(() => testOrigin("https://pkic.org")).toThrow();
    expect(testOrigin("https://stable.preview.pkic.org/portal/")).toBe("https://stable.preview.pkic.org");
    expect(() => assertOutsideRepository(resolve("scripts/passkeys.json"), resolve("."))).toThrow();
    expect(() => assertOutsideRepository(join(tmpdir(), "passkeys.json"), resolve("."))).not.toThrow();
    expect(() => assertOutsideRepository(resolve("..passkeys.json"), resolve("."))).toThrow();
  });

  it("narrows an existing key file to its owner", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "pkic-passkeys-")), "passkeys.json");
    writeFileSync(file, `${JSON.stringify({ version: 1, credentials: {} })}\n`, { mode: 0o644 });
    chmodSync(file, 0o644);
    await ensurePasskeys(file, []);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("retries the publication while the database is busy after the import", async () => {
    const replies = [
      new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }), { status: 503 }),
      new Response(JSON.stringify({ revision: 4 }), { status: 200 }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => replies.shift()!);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const published = await publishAgenda({
        origin: "http://localhost:8787",
        cookie: "session=1",
        eventSlug: "tokyo",
        revision: 4,
        waits: [0],
      });
      expect(published).toEqual({ revision: 4 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("insertStatements", () => {
  it("refuses a row too large for one statement", () => {
    expect(() => insertStatements("example", ["id"], [["x".repeat(100_001)]])).toThrow(/too large/);
  });

  it("splits rows across statements below the limit", () => {
    const rows = Array.from({ length: 2000 }, (_, index) => [`id-${index}`, "x".repeat(200)]);
    const statements = insertStatements("example", ["id", "value"], rows);
    expect(statements.length).toBeGreaterThan(1);
    for (const statement of statements) expect(statement.length).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
  });
});

describe("generated content", () => {
  const built = plan();
  const texts = [
    ...built.sessions.flatMap((session: { title: string; description: string }) => [
      session.title,
      session.description,
    ]),
    ...built.population.speakers.map((speaker: { biography: string }) => speaker.biography),
  ];

  it("reads like a real program, with no placeholder wording", () => {
    for (const text of texts) expect(text).not.toMatch(/synthetic|scale test|test data|lorem/i);
  });

  it("keeps titles within the agenda limit while varying their length", () => {
    const lengths = built.sessions.map((session: { title: string }) => session.title.length);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(300);
    expect(Math.max(...lengths)).toBeGreaterThan(120);
    expect(Math.min(...lengths)).toBeLessThan(15);
  });

  it("names people and organizations the way production data does", () => {
    const names = built.population.attendees.map(
      (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`,
    );
    expect(names.some((name: string) => /[^ -~]/.test(name))).toBe(true);
    expect(names.some((name: string) => name.includes("'"))).toBe(true);
    const organizations = built.population.organizations.map((organization: { name: string }) =>
      organization.name.toLowerCase(),
    );
    expect(new Set(organizations).size).toBe(organizations.length);
    for (const name of organizations) expect(name).not.toMatch(/ \d+$/);
  });
});

describe("saved sessions", () => {
  it("date a saved session by the event's own calendar day", () => {
    const tokyo = { ...context, timeZone: "Asia/Tokyo" };
    const built = buildPreviewScalePlan({ attendees: 300, speakers: 40, context: tokyo, roster });
    const morning = built.sessions.find(
      (session: { startAt: string }) => session.startAt === "2026-12-01T23:00:00.000Z",
    );
    expect(morning).toBeDefined();
    const rows = built.saved.filter((saved: { occurrenceId: string }) => saved.occurrenceId === morning.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.dayDate).toBe("2026-12-02");
  });
});

describe("organization names", () => {
  it("skips a name an unrelated organization already holds", () => {
    const taken = plan().population.organizations[0].name;
    const built = buildPreviewScalePlan({
      attendees: 300,
      speakers: 40,
      context: { ...context, existingOrganizations: [{ id: "real-organization", name: taken.toLowerCase() }] },
      roster,
    });
    expect(built.population.organizations.map((organization: { name: string }) => organization.name)).not.toContain(
      taken,
    );
  });
});

describe("applied to the migrated schema", () => {
  function migratedDatabase() {
    const db = new DatabaseSync(":memory:");
    const directory = resolve(import.meta.dirname, "../../migrations");
    for (const file of readdirSync(directory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort())
      db.exec(readFileSync(join(directory, file), "utf8"));
    db.exec(`PRAGMA foreign_keys = ON;
INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
  VALUES ('admin-1', 'admin@pkic.org', 'admin@pkic.org', 'Site', 'Admin', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
  VALUES ('event-1', 'scale', 'Scale', 'Europe/Amsterdam', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO event_days (id, event_id, day_date, created_at, updated_at) VALUES
  ('day-1', 'event-1', '2026-12-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('day-2', 'event-1', '2026-12-02', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO event_agenda_rooms (id, event_id, name, capacity) VALUES ('existing-room', 'event-1', 'Room 1', 50);
INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
  VALUES ('pkic', 'PKI Consortium, Inc.', 'pki consortium, inc.', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
    return db;
  }

  function apply(db: DatabaseSync, statements: string[]) {
    for (const statement of statements)
      try {
        db.exec(statement);
      } catch (error) {
        throw new Error(`${(error as Error).message}: ${statement.slice(0, 160)}`, { cause: error });
      }
  }

  const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { count: number }).count;

  it("converges when run again with another speaker count", async () => {
    const db = migratedDatabase();
    const schemaContext = { ...context, rooms: [{ id: "existing-room", name: "Room 1" }] };
    // A test account an earlier run left with only a personal identity.
    db.exec(`INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
  VALUES ('earlier', 'test.member+moderator@example.org', 'test.member+moderator@example.org', 'Test', 'Member', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO identities (id, user_id, source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
  VALUES ('earlier-individual', 'earlier', 'staff', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
    apply(
      db,
      seedStatements(
        schemaContext,
        buildPreviewScalePlan({ attendees: 300, speakers: 40, context: schemaContext, roster, skipHeadshots: true }),
      ),
    );
    const fewer = buildPreviewScalePlan({ attendees: 300, speakers: 8, context: schemaContext, roster });
    expect(
      fewer.sessions.some(
        (session: { kind: string; speakerUserIds: string[] }) =>
          session.kind === "session" && session.speakerUserIds.length === 0,
      ),
    ).toBe(true);
    apply(db, seedStatements(schemaContext, fewer));
    apply(db, seedStatements(schemaContext, fewer));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(count(db, "SELECT COUNT(*) AS count FROM users WHERE headshot_r2_key IS NOT NULL")).toBe(
      fewer.population.speakers.filter((speaker: { hasHeadshot: boolean }) => speaker.hasHeadshot).length,
    );
    expect(count(db, "SELECT COUNT(*) AS count FROM event_agenda_session_history")).toBe(
      fewer.sessions.filter((session: { speakerUserIds: string[] }) => session.speakerUserIds.length > 0).length,
    );
    expect(count(db, "SELECT COUNT(*) AS count FROM event_agenda_occurrence_speakers")).toBe(
      fewer.sessions.reduce(
        (total: number, session: { speakerUserIds: string[] }) => total + session.speakerUserIds.length,
        0,
      ),
    );
    expect(count(db, "SELECT COUNT(*) AS count FROM event_agenda_rooms WHERE name = 'Room 1'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS count FROM user_roles WHERE context_type = 'event'")).toBe(
      fewer.personas.filter((persona: { roleId: string | null }) => persona.roleId).length,
    ); // Every test account signs in without the organization step, and the sponsor one leads its sponsorship.
    expect(
      count(
        db,
        `SELECT COUNT(*) AS count FROM users person WHERE person.normalized_email LIKE '%+%' AND NOT EXISTS (
          SELECT 1 FROM identities held WHERE held.user_id = person.id AND held.organization_id IS NOT NULL
            AND held.is_default = 1 AND held.job_title IS NOT NULL AND held.ended_at IS NULL)`,
      ),
    ).toBe(0);
    expect(
      count(
        db,
        `SELECT COUNT(*) AS count FROM sponsorships sponsorship JOIN identities held
          ON held.organization_id = sponsorship.organization_id AND held.ended_at IS NULL
          JOIN users person ON person.id = held.user_id AND person.normalized_email = sponsorship.contact_email
          WHERE sponsorship.contact_email = 'test.member+sponsor@example.org'`,
      ),
    ).toBe(1);
    expect(
      count(
        db,
        `SELECT COUNT(*) AS count FROM identities held JOIN users person ON person.id = held.user_id
          WHERE person.normalized_email LIKE '%+%' AND held.organization_id IS NULL AND held.ended_at IS NULL`,
      ),
    ).toBe(0);
    expect(
      count(
        db,
        "SELECT COUNT(*) AS count FROM users WHERE normalized_email = 'test.member+moderator@example.org' AND last_name = 'Member Moderator'",
      ),
    ).toBe(1);
    expect(fewer.leads.captured.length).toBeGreaterThan(0);
    expect(fewer.leads.scannable).toEqual(expect.arrayContaining([expect.stringMatching(/^\S+$/)]));
    expect(
      count(
        db,
        `SELECT COUNT(*) AS count FROM event_sponsor_leads lead
          JOIN registrations reg ON reg.event_id = lead.event_id AND reg.user_id = lead.user_id AND reg.status = 'registered'
          JOIN users operator ON operator.id = lead.operator_user_id AND operator.normalized_email = 'test.member+sponsor@example.org'
          WHERE ${sponsorConsentSql("reg")}`,
      ),
    ).toBe(fewer.leads.captured.length);
    // A roster change moves the sponsor account to another sponsorship: it speaks for the new sponsor only.
    const moved = {
      ...fewer,
      personas: buildPersonas(roster, schemaContext.eventId, fewer.sponsorships.slice(1)).filter(
        (persona: { roleId: string | null }) => !persona.roleId || schemaContext.roles.has(persona.roleId),
      ),
    };
    apply(db, seedStatements(schemaContext, moved));
    expect(
      db
        .prepare(
          `SELECT held.organization_id AS organizationId FROM identities held JOIN users person ON person.id = held.user_id
            WHERE person.normalized_email = 'test.member+sponsor@example.org' AND held.ended_at IS NULL`,
        )
        .all(),
    ).toEqual([{ organizationId: fewer.sponsorships[1].organizationId }]);
    expect(
      count(db, "SELECT COUNT(*) AS count FROM sponsorships WHERE contact_email = 'test.member+sponsor@example.org'"),
    ).toBe(1);
    // Moving back restores the first sponsor's identity instead of leaving the account without one.
    apply(db, seedStatements(schemaContext, fewer));
    expect(
      db
        .prepare(
          `SELECT held.organization_id AS organizationId, held.source FROM identities held JOIN users person ON person.id = held.user_id
            WHERE person.normalized_email = 'test.member+sponsor@example.org' AND held.ended_at IS NULL`,
        )
        .all(),
    ).toEqual([{ organizationId: fewer.sponsorships[0].organizationId, source: "organization_contact" }]);
    // An attendee term replaced by the event comes back active, so the seeded consents still count.
    db.exec("UPDATE event_terms SET active = 0 WHERE term_key = 'sponsor-data-sharing'");
    apply(db, seedStatements(schemaContext, fewer));
    expect(
      count(db, "SELECT COUNT(*) AS count FROM event_terms WHERE term_key = 'sponsor-data-sharing' AND active = 1"),
    ).toBe(1);
    const store = await ensurePasskeys(
      join(mkdtempSync(join(tmpdir(), "pkic-passkeys-")), "passkeys.json"),
      fewer.personas.map((persona: { email: string }) => persona.email),
    );
    apply(db, passkeyStatements(store, fewer.personas));
    apply(db, passkeyStatements(store, fewer.personas));
    expect(count(db, "SELECT COUNT(*) AS count FROM passkey_credentials")).toBe(fewer.personas.length);
  });

  it("seeds a second, newly created event beside the first", () => {
    const db = migratedDatabase();
    const first = { ...context, rooms: [{ id: "existing-room", name: "Room 1" }] };
    apply(db, seedStatements(first, buildPreviewScalePlan({ attendees: 300, speakers: 40, context: first, roster })));
    const event = newEvent({
      slug: "second-event",
      name: "Second event",
      start: "2027-03-02",
      dayCount: 2,
      timeZone: "America/New_York",
    });
    const second = { ...event, roles: context.roles, actorUserId: "admin-1" };
    const secondPlan = buildPreviewScalePlan({ attendees: 300, speakers: 40, context: second, roster });
    for (let run = 0; run < 2; run += 1)
      apply(db, [
        ...newEventStatements(event),
        ...eventOwnerStatements(event.eventId, "pqc"),
        ...seedStatements(second, secondPlan),
      ]);
    // The team reaches the workspace through the owning group.
    expect(
      count(
        db,
        `SELECT COUNT(*) AS count FROM events event JOIN groups owner ON owner.id = event.owner_group_id
          WHERE event.id = '${event.eventId}' AND owner.slug = 'pqc' AND event.profile_key = 'conference'`,
      ),
    ).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(count(db, "SELECT COUNT(*) AS count FROM event_days WHERE event_id = '" + event.eventId + "'")).toBe(2);
    expect(count(db, "SELECT COUNT(DISTINCT event_id) AS count FROM registrations")).toBe(2);
    expect(count(db, "SELECT COUNT(*) AS count FROM registrations WHERE event_id = '" + event.eventId + "'")).toBe(
      secondPlan.population.registrations.length +
        secondPlan.personas.filter((persona: { registers: boolean }) => persona.registers).length,
    );
    expect(
      count(db, "SELECT COUNT(*) AS count FROM event_agenda_occurrences WHERE event_id = '" + event.eventId + "'"),
    ).toBe(secondPlan.sessions.length);
    expect(secondPlan.sessions.find((session: { format: string }) => session.format === "keynote")?.startAt).toBe(
      "2027-03-02T13:00:00.000Z",
    );
  });
});
