import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const LEDGER_SECTION = "-- Section: Shared payment ledger and immutable payment-event history.";

function applyMigrationsBeforeLedger(db: DatabaseSync): string {
  for (const name of readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0035_membership_portal_governance.sql")
    .sort()) {
    db.exec(readFileSync("migrations/" + name, "utf8"));
  }
  const migration = readFileSync("migrations/0035_membership_portal_governance.sql", "utf8");
  const ledgerOffset = migration.indexOf(LEDGER_SECTION);
  if (ledgerOffset < 0) throw new Error("Migration 0035 does not contain the payment ledger section");
  db.exec(migration.slice(0, ledgerOffset));
  return migration.slice(ledgerOffset);
}

describe("payment ledger migration", () => {
  it("backfills existing donation, membership fee, and paid sponsorship records", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrationAfterLedgerSetup = applyMigrationsBeforeLedger(db);
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(
        "INSERT INTO donations " +
          "(id, checkout_session_id, payment_intent_id, name, email, currency, gross_amount, completed_at, status) " +
          "VALUES ('donation-1', 'cs_donation', 'pi_donation', 'Donor', 'donor@example.test', " +
          "'usd', 2500, '2026-09-20T08:00:00.000Z', 'completed');" +
          "INSERT INTO membership_fee_intents " +
          "(id, application_id, generation, step_position, category_code, version_id, fee_reference, amount, currency, " +
          "deadline_at, checkout_session_id, payment_intent_id, status, paid_at, created_at, updated_at) " +
          "VALUES ('fee-1', 'application-1', 1, 0, 'A', 'version-1', 'annual-membership', 10000, 'usd', " +
          "'2026-10-01T00:00:00.000Z', 'cs_membership', 'pi_membership', 'paid', " +
          "'2026-09-20T08:00:00.000Z', '2026-09-19T08:00:00.000Z', '2026-09-20T08:00:00.000Z');" +
          "INSERT INTO sponsorships " +
          "(id, sponsor_type, non_member_name, event_id, tier, pipeline_stage, checkout_session_id, stripe_event_id, " +
          "price_amount_cents, price_currency, created_at, updated_at) " +
          "VALUES ('sponsor-1', 'event', 'Sponsor', 'event-1', 'Leader', 'payment_pending', " +
          "'cs_sponsor', 'evt_sponsor', 50000, 'eur', '2026-09-20T08:00:00.000Z', '2026-09-20T08:00:00.000Z')",
      );

      db.exec(migrationAfterLedgerSetup);

      expect(
        db
          .prepare("SELECT purpose, resource_id, status, amount, currency FROM payment_ledger_entries ORDER BY purpose")
          .all(),
      ).toEqual([
        { purpose: "donation", resource_id: "donation-1", status: "paid", amount: 2500, currency: "usd" },
        { purpose: "membership", resource_id: "fee-1", status: "paid", amount: 10000, currency: "usd" },
        { purpose: "sponsorship", resource_id: "sponsor-1", status: "paid", amount: 50000, currency: "eur" },
      ]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM payment_ledger_events").get()).toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });
});
