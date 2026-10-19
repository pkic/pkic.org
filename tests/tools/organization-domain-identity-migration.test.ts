import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_DOMAIN_EXPECTED,
  ORGANIZATION_DOMAIN_FIXTURE,
  productionShapedFixture,
  type OrganizationDomainFixture,
} from "../fixtures/organization-domain-people";
import { affiliationFreeEmailDomainsSql, D1_STATEMENT_MAX_BYTES } from "./helpers/affiliation-free-domains-sql";
import { decidePopulation, migratedOutcomes, seedPopulation } from "./helpers/organization-domain-population";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaPlatformMigration = "0038_event_agenda_platform.sql";
const migrationText = readFileSync(resolve(migrationsDirectory, agendaPlatformMigration), "utf8");

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

function migrated(fixture: OrganizationDomainFixture): DatabaseSync {
  const db = databaseBeforeAgendaPlatform();
  seedPopulation(db, fixture);
  db.exec(migrationText);
  return db;
}

function organizationCount(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM organizations").get() as { count: number }).count;
}

describe("the migration embeds the shared domain rule", () => {
  // The Worker's vendored free and disposable lists after overrides. An applied migration is immutable, so
  // once 0038 reaches preview or production a list refresh changes the runtime only and retires this pin.
  it("loads the Worker's free and disposable domains verbatim", () => {
    expect(migrationText).toContain(affiliationFreeEmailDomainsSql());
  });

  it("keeps every free-domain statement within D1's statement size", () => {
    for (const statement of affiliationFreeEmailDomainsSql().split("\n"))
      expect(new TextEncoder().encode(statement).byteLength).toBeLessThan(D1_STATEMENT_MAX_BYTES);
  });
});

describe("legacy people join the organization their verified work domain belongs to", () => {
  it("decides every case as the shared rule does", () => {
    const db = migrated(ORGANIZATION_DOMAIN_FIXTURE);
    try {
      expect(migratedOutcomes(db)).toEqual(ORGANIZATION_DOMAIN_EXPECTED);
      expect(decidePopulation(ORGANIZATION_DOMAIN_FIXTURE)).toEqual(ORGANIZATION_DOMAIN_EXPECTED);
    } finally {
      db.close();
    }
  });

  it("creates no organization and links nobody by name", () => {
    const db = migrated(ORGANIZATION_DOMAIN_FIXTURE);
    try {
      expect(organizationCount(db)).toBe(ORGANIZATION_DOMAIN_FIXTURE.organizations.length);
      expect(
        db
          .prepare(
            `SELECT identity.user_id FROM identities identity
              WHERE identity.organization_id IN ('org-acme', 'org-member') AND identity.ended_at IS NULL
              ORDER BY identity.user_id`,
          )
          .all(),
      ).toEqual([{ user_id: "held-acme" }]);
    } finally {
      db.close();
    }
  });

  it("gives a joined person the identity runtime's join would, with their title and address", () => {
    const db = migrated(ORGANIZATION_DOMAIN_FIXTURE);
    try {
      expect(
        db
          .prepare(
            `SELECT identity.user_id, identity.source, identity.verified_email_domain, identity.email_id,
                    identity.job_title, identity.show_on_organization_profile
               FROM identities identity
              WHERE identity.organization_id = 'org-open' AND identity.ended_at IS NULL
              ORDER BY identity.user_id`,
          )
          .all(),
      ).toEqual([
        {
          user_id: "open-1",
          source: "verified_domain",
          verified_email_domain: null,
          email_id: null,
          job_title: "CTO",
          show_on_organization_profile: 0,
        },
        {
          user_id: "open-2",
          source: "verified_domain",
          verified_email_domain: null,
          email_id: null,
          job_title: null,
          show_on_organization_profile: 0,
        },
        {
          user_id: "open-sub",
          source: "verified_domain",
          verified_email_domain: null,
          email_id: null,
          job_title: null,
          show_on_organization_profile: 0,
        },
        {
          user_id: "secondary",
          source: "verified_domain",
          verified_email_domain: null,
          email_id: "secondary-work",
          job_title: null,
          show_on_organization_profile: 0,
        },
      ]);
      expect(
        db
          .prepare("SELECT job_title FROM identities WHERE user_id = 'held-acme' AND organization_id = 'org-acme'")
          .get(),
      ).toEqual({ job_title: "Lead" });
    } finally {
      db.close();
    }
  });

  it("keeps the remaining text for review with each person's work domain, grouped by the name as written", () => {
    const db = migrated(ORGANIZATION_DOMAIN_FIXTURE);
    try {
      expect(
        db
          .prepare(
            `SELECT user_id, group_key, email_domain FROM affiliation_reviews
              WHERE source_type = 'user_profile' ORDER BY user_id`,
          )
          .all(),
      ).toEqual([
        { user_id: "acme-text", group_key: "acme pki ltd", email_domain: "acme-pki.example" },
        { user_id: "free-acme", group_key: "acme pki ltd", email_domain: null },
        { user_id: "isp", group_key: "acme pki ltd", email_domain: null },
        { user_id: "isp-sub", group_key: "open claimed", email_domain: null },
        { user_id: "member-1", group_key: "member claimed", email_domain: "member.example" },
        { user_id: "newco", group_key: "newco", email_domain: "newco.example" },
        { user_id: "pending-1", group_key: "pending applicant", email_domain: null },
        { user_id: "unverified", group_key: "open claimed", email_domain: null },
      ]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'affiliation_%' ORDER BY name").all()).toEqual([
        { name: "affiliation_offer_dismissals" },
        { name: "affiliation_offer_dismissals_by_organization" },
        { name: "affiliation_offer_dismissals_independent" },
        { name: "affiliation_offer_dismissals_organization" },
        { name: "affiliation_reviews" },
        { name: "affiliation_reviews_group" },
        { name: "affiliation_reviews_queue" },
        { name: "affiliation_reviews_user" },
      ]);
    } finally {
      db.close();
    }
  });

  it("migrates a production-shaped population as the shared rule decides, creating no organization", () => {
    const fixture = productionShapedFixture();
    const db = migrated(fixture);
    try {
      expect(migratedOutcomes(db)).toEqual(decidePopulation(fixture));
      expect(organizationCount(db)).toBe(fixture.organizations.length);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
