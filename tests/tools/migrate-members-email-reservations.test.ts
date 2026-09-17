/**
 * The importer creates an account only for an address nothing has claimed
 * yet, so an address another account reserves ends the import without a
 * member account behind it. These tests cover the check that turns that
 * silence into a named, per-address follow-up in the migration report.
 */
import { describe, expect, it } from "vitest";
import {
  EMAIL_RESERVATION_QUERY,
  RESERVATION_REASONS,
  findEmailReservationConflicts,
} from "../../scripts/migrate-members/email-reservations.mjs";

interface ReservationRow {
  email: string;
  reservedBy: string | null;
  reason: string;
}

describe("findEmailReservationConflicts", () => {
  it("reports only the reservations that collide with an address this import covered", () => {
    const conflicts = findEmailReservationConflicts(["alice@acme.example", "bob@acme.example"], [
      { email: "alice@acme.example", reservedBy: "old@example.org", reason: "pending_email_change" },
      { email: "someone-else@other.example", reservedBy: "x@example.org", reason: "pending_email_change" },
    ] satisfies ReservationRow[]);
    expect(conflicts).toEqual([
      { email: "alice@acme.example", reservedBy: "old@example.org", reason: "pending_email_change" },
    ]);
  });

  it("returns nothing when the database holds no reservation for an imported address", () => {
    expect(findEmailReservationConflicts(["alice@acme.example"], [])).toEqual([]);
  });

  it("matches the normalized addresses the importer generates, whatever case the database returns", () => {
    const conflicts = findEmailReservationConflicts(
      ["alice@acme.example"],
      [{ email: "Alice@Acme.Example", reservedBy: null, reason: "closed_account" }],
    );
    expect(conflicts).toEqual([{ email: "alice@acme.example", reservedBy: null, reason: "closed_account" }]);
  });

  it("reports one address once, and sorts so reruns produce a comparable report", () => {
    const conflicts = findEmailReservationConflicts(
      ["zoe@acme.example", "alice@acme.example"],
      [
        { email: "zoe@acme.example", reservedBy: "one@example.org", reason: "pending_email_change" },
        { email: "zoe@acme.example", reservedBy: "two@example.org", reason: "closed_account" },
        { email: "alice@acme.example", reservedBy: "three@example.org", reason: "closed_account" },
      ],
    );
    expect(conflicts.map((conflict) => conflict.email)).toEqual(["alice@acme.example", "zoe@acme.example"]);
  });

  it("explains every reason the query can return", () => {
    for (const reason of ["pending_email_change", "closed_account"]) {
      expect(EMAIL_RESERVATION_QUERY).toContain(`'${reason}' AS reason`);
      expect(RESERVATION_REASONS[reason as keyof typeof RESERVATION_REASONS]).toBeTruthy();
    }
  });

  it("reports a reservation only when no live account ended up behind the address", () => {
    // A dump written before migration 0035's reservation triggers existed
    // can hold a pending change for an address another account already
    // owns. That member imports fine, so every reservation the query
    // returns is guarded by the same owner resolution the import used.
    const guards = EMAIL_RESERVATION_QUERY.match(/IS NULL\s*$/gm) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
    for (const source of ["pending.pending_email", "closed.normalized_email", "alternate.normalized_email"]) {
      expect(EMAIL_RESERVATION_QUERY).toContain(
        `SELECT live.id FROM users live\n            WHERE live.normalized_email = ${source}`,
      );
    }
  });

  it("reads only the reservation columns, and writes nothing", () => {
    expect(EMAIL_RESERVATION_QUERY).toContain("pending.pending_email");
    expect(EMAIL_RESERVATION_QUERY).toContain("pii_redacted_at IS NOT NULL OR closed.merged_into_user_id IS NOT NULL");
    expect(EMAIL_RESERVATION_QUERY).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  });
});
