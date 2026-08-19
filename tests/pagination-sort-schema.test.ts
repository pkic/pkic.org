/**
 * P6M-CC-01: every allowlisted `?sort=` schema across the codebase now
 * delegates to the single canonical `sortColumnSchema()` in
 * assets/shared/schemas/pagination.ts instead of each hand-rolling its own
 * `.refine()`. This test asserts the canonical helper's own behavior and
 * that each consolidated export still validates its real allowlist.
 */
import { describe, expect, it } from "vitest";
import { sortColumnSchema } from "../assets/shared/schemas/pagination";
import { donationsSortValueSchema } from "../assets/shared/schemas/admin-donations";
import { usersSortValueSchema } from "../assets/shared/schemas/admin-users";
import { auditLogSortValueSchema } from "../assets/shared/schemas/admin-audit-log";
import { emailTemplatesSortValueSchema } from "../assets/shared/schemas/admin-email-templates";
import {
  eventsListSortValueSchema,
  eventTeamSortValueSchema,
  eventInvitesSortValueSchema,
  formSubmissionsSortValueSchema,
} from "../assets/shared/schemas/api";

describe("sortColumnSchema (canonical)", () => {
  const schema = sortColumnSchema(["name", "created_at"]);

  it("accepts an allowlisted ascending column", () => {
    expect(schema.safeParse("name").success).toBe(true);
  });

  it("accepts an allowlisted descending column (- prefix)", () => {
    expect(schema.safeParse("-created_at").success).toBe(true);
  });

  it("rejects a column not in the allowlist", () => {
    expect(schema.safeParse("not_a_column").success).toBe(false);
  });

  it("rejects a descending value whose base column isn't allowlisted", () => {
    expect(schema.safeParse("-not_a_column").success).toBe(false);
  });

  it("is optional", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});

describe("consolidated per-endpoint sort schemas still validate their own allowlist", () => {
  it("donationsSortValueSchema", () => {
    expect(donationsSortValueSchema.safeParse("gross_amount").success).toBe(true);
    expect(donationsSortValueSchema.safeParse("-gross_amount").success).toBe(true);
    expect(donationsSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("usersSortValueSchema", () => {
    expect(usersSortValueSchema.safeParse("last_name").success).toBe(true);
    expect(usersSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("auditLogSortValueSchema", () => {
    expect(auditLogSortValueSchema.safeParse("al.action").success).toBe(true);
    expect(auditLogSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("emailTemplatesSortValueSchema", () => {
    expect(emailTemplatesSortValueSchema.safeParse("template_key").success).toBe(true);
    expect(emailTemplatesSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("eventsListSortValueSchema", () => {
    expect(eventsListSortValueSchema.safeParse("starts_at").success).toBe(true);
    expect(eventsListSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("eventTeamSortValueSchema", () => {
    expect(eventTeamSortValueSchema.safeParse("role_id").success).toBe(true);
    expect(eventTeamSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("eventInvitesSortValueSchema", () => {
    expect(eventInvitesSortValueSchema.safeParse("invitee_email").success).toBe(true);
    expect(eventInvitesSortValueSchema.safeParse("bogus").success).toBe(false);
  });

  it("formSubmissionsSortValueSchema", () => {
    expect(formSubmissionsSortValueSchema.safeParse("submitted_at").success).toBe(true);
    expect(formSubmissionsSortValueSchema.safeParse("bogus").success).toBe(false);
  });
});
