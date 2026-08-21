/**
 * P6M-CC-01: every allowlisted `?sort=` schema across the codebase now
 * delegates to the single canonical `sortColumnSchema()` in
 * assets/shared/schemas/pagination.ts instead of each hand-rolling its own
 * `.refine()`. This test asserts the canonical helper's own behavior and
 * that each consolidated export still validates its real allowlist.
 */
import { describe, expect, it } from "vitest";
import { listQuerySchema, searchQuerySchema, sortColumnSchema } from "../assets/shared/schemas/pagination";
import { donationsListQuerySchema } from "../assets/shared/schemas/admin-donations";
import { usersListQuerySchema } from "../assets/shared/schemas/admin-users";
import { auditLogListQuerySchema } from "../assets/shared/schemas/admin-audit-log";
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

describe("shared list/search contract", () => {
  const schema = listQuerySchema(["name", "created_at"] as const);

  it("normalizes pagination and trims search once for every list endpoint", () => {
    expect(schema.parse({ limit: "25", offset: "50", q: "  alice  ", sort: "-created_at" })).toEqual({
      limit: 25,
      offset: 50,
      q: "alice",
      sort: "-created_at",
    });
  });

  it("rejects collection limits above the shared D1-safe maximum", () => {
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("rejects empty search and values over the bounded search budget", () => {
    expect(searchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "a".repeat(255) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "é".repeat(128) }).success).toBe(false);
  });

  it("accepts the exact UTF-8 search boundary", () => {
    expect(searchQuerySchema.parse({ q: `a${"é".repeat(126)}b` }).q).toBe(`a${"é".repeat(126)}b`);
  });
});

describe("consolidated per-endpoint sort schemas still validate their own allowlist", () => {
  it("donationsListQuerySchema sort", () => {
    expect(donationsListQuerySchema.safeParse({ sort: "gross_amount" }).success).toBe(true);
    expect(donationsListQuerySchema.safeParse({ sort: "-gross_amount" }).success).toBe(true);
    expect(donationsListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
  });

  it("usersListQuerySchema sort", () => {
    expect(usersListQuerySchema.safeParse({ sort: "last_name" }).success).toBe(true);
    expect(usersListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
  });

  it("auditLogListQuerySchema sort", () => {
    expect(auditLogListQuerySchema.safeParse({ sort: "action" }).success).toBe(true);
    expect(auditLogListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
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
