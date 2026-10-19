import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { USER_BACKED_AUDIT_ACTOR_TYPES } from "../../assets/shared/schemas/audit-log";
import { databaseIdSchema } from "../../assets/shared/schemas/identifiers";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaPlatformMigration = "0038_event_agenda_platform.sql";

function databaseBeforeAgendaPlatform(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (file === agendaPlatformMigration) break;
    db.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

function applyAgendaPlatform(db: DatabaseSync): void {
  db.exec(readFileSync(resolve(migrationsDirectory, agendaPlatformMigration), "utf8"));
}

const T0 = "2025-01-01T00:00:00.000Z";

/**
 * Three organizations (one claims a domain) and people in every shape the
 * upgrade meets: affiliations already held as identities, profile text that
 * names an organization only by spelling or by a claimed work address, text
 * matching nothing, a title without an organization, and a speaker override.
 * Audit rows mix the application's ISO instants with the space-separated form
 * older rows carry, across every person-backed actor type.
 */
function seedUpgradeShapes(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES
      ('org-a', 'Alpha', 'alpha', '${T0}', '${T0}'),
      ('org-b', 'Beta', 'beta', '${T0}', '${T0}'),
      ('org-c', 'Claimed Corp', 'claimed corp', '${T0}', '${T0}');
    INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at) VALUES
      ('claim-c', 'claimed.example', 'org-c', '${T0}', '${T0}');
    INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at) VALUES
      ('member-a', 'organization', 'org-a', 'active', '${T0}', '${T0}'),
      ('member-b', 'organization', 'org-b', 'active', '${T0}', '${T0}');
    INSERT INTO users (id, email, normalized_email, organization_name, job_title, email_verified_at, created_at, updated_at) VALUES
      ('solo', 'solo@example.test', 'solo@example.test', 'Alpha', 'Architect', NULL, '${T0}', '${T0}'),
      ('dual', 'dual@example.test', 'dual@example.test', 'Gamma Labs', NULL, NULL, '${T0}', '${T0}'),
      ('former', 'former@example.test', 'former@example.test', NULL, NULL, NULL, '${T0}', '${T0}'),
      ('by-name', 'by-name@example.test', 'by-name@example.test', '  ALPHA ', 'Engineer', NULL, '${T0}', '${T0}'),
      ('by-domain', 'pat@claimed.example', 'pat@claimed.example', 'Claimed Corporation Ltd', 'Researcher',
       '${T0}', '${T0}', '${T0}'),
      ('by-work-address', 'sam@personal.example', 'sam@personal.example', 'Claimed', NULL, NULL, '${T0}', '${T0}'),
      ('unmatched', 'unmatched@example.test', 'unmatched@example.test', 'Nowhere Ltd', 'CTO', NULL, '${T0}', '${T0}'),
      ('independent', 'independent@example.test', 'independent@example.test', ' ', 'Independent consultant', NULL,
       '${T0}', '${T0}'),
      ('plain', 'plain@example.test', 'plain@example.test', NULL, NULL, NULL, '${T0}', '${T0}');
    INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES
      ('work-address', 'by-work-address', 'sam@claimed.example', 'sam@claimed.example', '${T0}', '${T0}');
    INSERT INTO identities
      (id, user_id, organization_id, source, invited_at, started_at, ended_at, created_at, updated_at) VALUES
      ('solo-a', 'solo', 'org-a', 'staff', '${T0}', '${T0}', NULL, '${T0}', '${T0}'),
      ('dual-a', 'dual', 'org-a', 'staff', '${T0}', '${T0}', NULL, '${T0}', '${T0}'),
      ('dual-b', 'dual', 'org-b', 'staff', '2025-03-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z', NULL,
       '2025-03-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z'),
      ('former-a', 'former', 'org-a', 'staff', '${T0}', '${T0}', '2025-05-01T00:00:00.000Z',
       '${T0}', '2025-05-01T00:00:00.000Z');
    INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at) VALUES
      ('event-1', 'upgrade', 'Upgrade', 'UTC', '2025-06-01T09:00:00.000Z', '2025-06-01T17:00:00.000Z', '${T0}', '${T0}');
    INSERT INTO session_proposals
      (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret, submitted_at, updated_at)
      VALUES ('proposal-1', 'event-1', 'by-name', 'accepted', 'talk', 'Talk', 'Abstract', 'secret-1', '${T0}', '${T0}');
    INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, profile_overrides_json, created_at) VALUES
      ('speaker-override', 'proposal-1', 'by-name', 'speaker', 'confirmed',
       '{"organizationName":"Delta","jobTitle":"Lead","biography":"Kept"}', '${T0}'),
      ('speaker-represented', 'proposal-1', 'solo', 'speaker', 'confirmed',
       '{"organizationName":"alpha"}', '${T0}');
    INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at) VALUES
      ('solo-active', 'user', 'solo', 'profile_updated', 'user', 'solo', NULL, '2025-06-01 10:00:00'),
      ('solo-before-start', 'user', 'solo', 'profile_updated', 'user', 'solo', NULL, '2024-12-01T00:00:00.000Z'),
      ('solo-as-admin', 'admin', 'solo', 'profile_updated', 'user', 'solo', NULL, '2025-06-01T00:00:00.000Z'),
      ('solo-as-member', 'member', 'solo', 'profile_updated', 'user', 'solo', NULL, '2025-06-01T00:00:00.000Z'),
      ('dual-one-active', 'user', 'dual', 'profile_updated', 'user', 'dual', NULL, '2025-02-01T00:00:00.000Z'),
      ('dual-two-active', 'user', 'dual', 'profile_updated', 'user', 'dual', NULL, '2025-04-01T00:00:00.000Z'),
      ('former-active', 'user', 'former', 'profile_updated', 'user', 'former', NULL, '2025-04-30T23:59:59.999Z'),
      ('former-at-end', 'user', 'former', 'profile_updated', 'user', 'former', NULL, '2025-05-01T00:00:00.000Z'),
      ('by-name-user', 'user', 'by-name', 'profile_updated', 'user', 'by-name', NULL, '2024-06-01 08:00:00'),
      ('by-name-admin', 'admin', 'by-name', 'profile_updated', 'user', 'by-name', NULL, '2025-02-01T00:00:00.000Z'),
      ('by-domain-member', 'member', 'by-domain', 'profile_updated', 'user', 'by-domain', NULL, '2025-02-01T00:00:00.000Z'),
      ('unmatched-user', 'user', 'unmatched', 'profile_updated', 'user', 'unmatched', NULL, '2025-02-01T00:00:00.000Z'),
      ('system-row', 'system', NULL, 'job_ran', 'job', NULL, NULL, '2025-06-01T00:00:00.000Z');
  `);
}

function upgradedDatabase(): DatabaseSync {
  const db = databaseBeforeAgendaPlatform();
  seedUpgradeShapes(db);
  applyAgendaPlatform(db);
  return db;
}

describe("identity ownership of organization and title", () => {
  it("gives every person an identity: the organization their verified work domain joins, else an individual one", () => {
    const db = upgradedDatabase();
    try {
      expect(
        db
          .prepare(
            `SELECT user_id, organization_id, email_id, verified_email_domain, job_title, source,
                    show_on_organization_profile, started_at IS NOT NULL AS started
               FROM identities
              WHERE organization_id IS NOT NULL
                AND id IN (SELECT entity_id FROM audit_log WHERE action = 'identity_created_from_profile')
              ORDER BY user_id`,
          )
          .all(),
      ).toEqual([
        expect.objectContaining({
          user_id: "by-domain",
          organization_id: "org-c",
          email_id: null,
          verified_email_domain: null,
          job_title: "Researcher",
          source: "verified_domain",
          show_on_organization_profile: 0,
          started: 1,
        }),
        // A name alone never decides: by-name wrote "ALPHA" but verified no address there.
        expect.objectContaining({
          user_id: "by-work-address",
          organization_id: "org-c",
          email_id: "work-address",
          job_title: null,
        }),
      ]);
      expect(db.prepare("SELECT user_id FROM identities WHERE organization_id IS NULL ORDER BY user_id").all()).toEqual(
        [
          { user_id: "by-name" },
          { user_id: "former" },
          { user_id: "independent" },
          { user_id: "plain" },
          { user_id: "unmatched" },
        ],
      );
      expect(db.prepare("SELECT job_title FROM identities WHERE id = 'solo-a'").get()).toEqual({
        job_title: "Architect",
      });
      expect(
        db
          .prepare(
            `SELECT address.identity_id = identity.id AS owned FROM user_emails address
               JOIN identities identity ON identity.user_id = address.user_id WHERE address.id = 'work-address'`,
          )
          .get(),
      ).toEqual({ owned: 1 });
      const createdIds = db.prepare("SELECT id FROM identities WHERE source = 'migration'").all() as Array<{
        id: string;
      }>;
      expect(createdIds.every((row) => databaseIdSchema.safeParse(row.id).success)).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS count FROM affiliation_reviews WHERE length(id) <> 32").get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
  });

  it("keeps unmatched organization names for review and individual titles in their mapping table", () => {
    const db = upgradedDatabase();
    try {
      expect(
        db
          .prepare(
            `SELECT user_id, organization_name, normalized_name, job_title, source_type, source_id, resolved_at
               FROM affiliation_reviews ORDER BY source_type, user_id`,
          )
          .all(),
      ).toEqual([
        {
          user_id: "by-name",
          organization_name: "Delta",
          normalized_name: "delta",
          job_title: "Lead",
          source_type: "proposal_speaker",
          source_id: "speaker-override",
          resolved_at: null,
        },
        {
          user_id: "by-name",
          organization_name: "ALPHA",
          normalized_name: "alpha",
          job_title: "Engineer",
          source_type: "user_profile",
          source_id: "by-name",
          resolved_at: null,
        },
        {
          user_id: "dual",
          organization_name: "Gamma Labs",
          normalized_name: "gamma labs",
          job_title: null,
          source_type: "user_profile",
          source_id: "dual",
          resolved_at: null,
        },
        {
          user_id: "unmatched",
          organization_name: "Nowhere Ltd",
          normalized_name: "nowhere ltd",
          job_title: "CTO",
          source_type: "user_profile",
          source_id: "unmatched",
          resolved_at: null,
        },
      ]);
      expect(db.prepare("SELECT user_id, job_title FROM individual_job_titles").all()).toEqual([
        { user_id: "independent", job_title: "Independent consultant" },
      ]);
      // The proposal copy is gone; its biography completed the blank identity the speaker speaks as.
      expect(
        db.prepare("SELECT name FROM pragma_table_info('proposal_speakers') WHERE name LIKE '%override%'").all(),
      ).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT biography FROM identities WHERE user_id = 'by-name' AND ended_at IS NULL AND biography IS NOT NULL",
          )
          .all(),
      ).toEqual([{ biography: "Kept" }]);
      expect(
        db
          .prepare(
            `SELECT action, COUNT(*) AS count FROM audit_log WHERE actor_type = 'system' AND action <> 'job_ran'
              GROUP BY action ORDER BY action`,
          )
          .all(),
      ).toEqual([
        { action: "affiliation_review_opened", count: 4 },
        { action: "identity_created_from_profile", count: 7 },
        { action: "identity_job_title_backfilled", count: 1 },
        { action: "identity_profile_completed", count: 1 },
        { action: "individual_job_title_retained", count: 1 },
        { action: "proposal_speaker_affiliation_override_removed", count: 2 },
        { action: "proposal_speaker_profile_override_removed", count: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  it("attributes person-backed audit rows only after the missing identities exist", () => {
    const db = upgradedDatabase();
    try {
      const rows = db
        .prepare(
          `SELECT entry.id, held.user_id AS actor_identity_owner, held.source AS actor_identity_source
             FROM audit_log entry LEFT JOIN identities held ON held.id = entry.actor_identity_id
            WHERE entry.actor_type <> 'system' OR entry.id = 'system-row' ORDER BY entry.id`,
        )
        .all() as Array<{ id: string; actor_identity_owner: string | null; actor_identity_source: string | null }>;
      const attributed = (owner: string, source: string) => ({ owner, source });
      expect(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            row.actor_identity_owner ? attributed(row.actor_identity_owner, row.actor_identity_source!) : null,
          ]),
        ),
      ).toEqual({
        "by-domain-member": null,
        "by-name-admin": attributed("by-name", "migration"),
        "by-name-user": attributed("by-name", "migration"),
        "dual-one-active": attributed("dual", "staff"),
        "dual-two-active": null,
        "former-active": attributed("former", "staff"),
        "former-at-end": null,
        "solo-active": attributed("solo", "staff"),
        "solo-as-admin": attributed("solo", "staff"),
        "solo-as-member": attributed("solo", "staff"),
        "solo-before-start": null,
        "system-row": null,
        "unmatched-user": attributed("unmatched", "migration"),
      });
      expect(db.prepare("SELECT actor_identity_id FROM audit_log WHERE id = 'dual-one-active'").get()).toEqual({
        actor_identity_id: "dual-a",
      });
      expect([...USER_BACKED_AUDIT_ACTOR_TYPES].sort()).toEqual(["admin", "member", "user"]);
    } finally {
      db.close();
    }
  });

  it("applies to an empty database", () => {
    const db = databaseBeforeAgendaPlatform();
    try {
      applyAgendaPlatform(db);
      expect(db.prepare("PRAGMA table_info(audit_log)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "actor_identity_id", notnull: 0 })]),
      );
      expect(db.prepare("PRAGMA table_info(user_emails)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "identity_id", notnull: 0 })]),
      );
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
