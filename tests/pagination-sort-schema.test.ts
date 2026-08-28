/**
 * P6M-CC-01: every allowlisted `?sort=` schema across the codebase now
 * delegates to the single canonical `sortColumnSchema()` in
 * assets/shared/schemas/pagination.ts instead of each hand-rolling its own
 * `.refine()`. This test asserts the canonical helper's own behavior and
 * that each consolidated export still validates its real allowlist.
 */
import { describe, expect, it } from "vitest";
import {
  listQuerySchema,
  MAX_PAGE_OFFSET,
  pageInfoSchema,
  paginationQuerySchemaWithDefaults,
  searchQuerySchema,
  sortColumnSchema,
  sortColumnSchemaWithDefault,
} from "../assets/shared/schemas/pagination";
import { donationsListQuerySchema } from "../assets/shared/schemas/admin-donations";
import { usersListQuerySchema } from "../assets/shared/schemas/admin-users";
import { systemAuditLogListQuerySchema } from "../assets/shared/schemas/system-audit-log";
import {
  emailTemplateVersionsListQuerySchema,
  emailTemplatesListQuerySchema,
  emailTemplatesSortValueSchema,
} from "../assets/shared/schemas/email-templates";
import { eventsListSortValueSchema, eventTeamSortValueSchema } from "../assets/shared/schemas/admin-events";
import { eventInvitesSortValueSchema } from "../assets/shared/schemas/event-invites";
import { formSubmissionsSortValueSchema } from "../assets/shared/schemas/admin-forms";
import { adminFormSubmissionsQuerySchema, adminFormsListQuerySchema } from "../assets/shared/schemas/admin-forms";
import { adminDueWorkListQuerySchema } from "../assets/shared/schemas/admin-due-work";
import { myApplicationsListQuerySchema } from "../assets/shared/schemas/me";
import { presentationVersionsListQuerySchema } from "../assets/shared/schemas/presentation-versions";
import { proposalCommentsListQuerySchema } from "../assets/shared/schemas/proposal-comments";
import { proposalReviewsListQuerySchema } from "../assets/shared/schemas/proposal-reviews";
import { sponsorsListQuerySchema } from "../assets/shared/schemas/public-sponsors";
import { sponsorPortalAttendeesListQuerySchema } from "../assets/shared/schemas/sponsor-portal";
import { publicVotesListQuerySchema } from "../assets/shared/schemas/votes";
import { adminEventProposalsQuerySchema } from "../assets/shared/schemas/admin-events";
import { adminEmailOutboxQuerySchema } from "../assets/shared/schemas/admin-email-outbox";
import { eventPromotersListQuerySchema } from "../assets/shared/schemas/admin-event-promoters";
import { membersListQuerySchema } from "../assets/shared/schemas/members-directory";
import { applicationDocumentsListQuerySchema } from "../assets/shared/schemas/application-documents";

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

  it("validates a schema-owned default against the same allowlist", () => {
    expect(sortColumnSchemaWithDefault(["name", "created_at"] as const, "-created_at").parse(undefined)).toBe(
      "-created_at",
    );
    expect(() => sortColumnSchemaWithDefault(["name", "created_at"] as const, "bogus" as "name")).toThrow(RangeError);
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

  it("resolves the canonical pagination defaults in the parsed contract", () => {
    expect(schema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("keeps endpoint-specific page sizes in schemas rather than routes or services", () => {
    expect(publicVotesListQuerySchema.parse({})).toMatchObject({ limit: 20, offset: 0 });
    expect(usersListQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(emailTemplatesListQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(emailTemplateVersionsListQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(myApplicationsListQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(proposalCommentsListQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(proposalReviewsListQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(presentationVersionsListQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(adminDueWorkListQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(donationsListQuerySchema.parse({})).toMatchObject({ limit: 100, offset: 0 });
    expect(sponsorPortalAttendeesListQuerySchema.parse({})).toMatchObject({ limit: 100, offset: 0 });
    expect(adminFormsListQuerySchema.parse({})).toMatchObject({ limit: 200, offset: 0 });
    expect(adminFormSubmissionsQuerySchema.parse({})).toMatchObject({ limit: 200, offset: 0 });
    expect(sponsorsListQuerySchema.parse({})).toMatchObject({ limit: 200, offset: 0 });
    expect(applicationDocumentsListQuerySchema.parse({})).toMatchObject({
      limit: 25,
      offset: 0,
      sort: "-uploadedAt",
    });
  });

  it("resolves domain filter and sort defaults in the same endpoint contracts", () => {
    expect(adminEventProposalsQuerySchema.parse({})).toMatchObject({ sort: "-submittedAt", limit: 50, offset: 0 });
    expect(adminEmailOutboxQuerySchema.parse({})).toMatchObject({ dueNow: false, limit: 50, offset: 0 });
    expect(eventPromotersListQuerySchema.parse({})).toMatchObject({ view: "promoters", limit: 50, offset: 0 });
    expect(membersListQuerySchema.parse({})).toMatchObject({ group: "all", limit: 50, offset: 0 });
    expect(adminDueWorkListQuerySchema.parse({})).toMatchObject({
      bucket: "all",
      includeRetention: false,
      reminderLimit: 120,
      outboxLimit: 120,
      cleanupLimit: 120,
      limit: 25,
      offset: 0,
    });
  });

  it("parses explicit false query flags as false instead of JavaScript truthiness", () => {
    expect(adminEmailOutboxQuerySchema.parse({ dueNow: "false" }).dueNow).toBe(false);
    expect(adminEmailOutboxQuerySchema.parse({ dueNow: "true" }).dueNow).toBe(true);
    expect(adminDueWorkListQuerySchema.parse({ includeRetention: "false" }).includeRetention).toBe(false);
    expect(adminDueWorkListQuerySchema.parse({ includeRetention: "true" }).includeRetention).toBe(true);
  });

  it("rejects invalid defaults when a route contract is declared", () => {
    expect(() => paginationQuerySchemaWithDefaults({ limit: 201 })).toThrow(RangeError);
    expect(() => paginationQuerySchemaWithDefaults({ offset: -1 })).toThrow(RangeError);
    expect(() => paginationQuerySchemaWithDefaults({ offset: MAX_PAGE_OFFSET + 1 })).toThrow(RangeError);
  });

  it("rejects collection limits above the shared D1-safe maximum", () => {
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("supports a stricter endpoint maximum without redeclaring pagination validation", () => {
    const bounded = listQuerySchema(["name"] as const, { limit: 8, maxLimit: 8 });
    expect(bounded.parse({})).toMatchObject({ limit: 8, offset: 0 });
    expect(bounded.safeParse({ limit: 9 }).success).toBe(false);
    expect(() => paginationQuerySchemaWithDefaults({ limit: 9, maxLimit: 8 })).toThrow(RangeError);
  });

  it("rejects offsets that would force an excessive D1 skip scan", () => {
    expect(schema.parse({ offset: MAX_PAGE_OFFSET }).offset).toBe(MAX_PAGE_OFFSET);
    expect(schema.safeParse({ offset: MAX_PAGE_OFFSET + 1 }).success).toBe(false);
  });

  it("rejects empty search and values over the bounded search budget", () => {
    expect(searchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "a".repeat(255) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "é".repeat(128) }).success).toBe(false);
  });

  it("accepts the exact UTF-8 search boundary", () => {
    expect(searchQuerySchema.parse({ q: `a${"é".repeat(126)}b` }).q).toBe(`a${"é".repeat(126)}b`);
  });

  it("rejects impossible page metadata at the shared response boundary", () => {
    expect(pageInfoSchema.safeParse({ limit: 25, offset: 0, total: 10, hasMore: false }).success).toBe(true);
    expect(pageInfoSchema.safeParse({ limit: 0, offset: 0, total: 10, hasMore: false }).success).toBe(false);
    expect(pageInfoSchema.safeParse({ limit: 25, offset: -1, total: 10, hasMore: false }).success).toBe(false);
    expect(pageInfoSchema.safeParse({ limit: 25, offset: 0, total: -1, hasMore: false }).success).toBe(false);
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

  it("systemAuditLogListQuerySchema sort", () => {
    expect(systemAuditLogListQuerySchema.safeParse({ sort: "action" }).success).toBe(true);
    expect(systemAuditLogListQuerySchema.safeParse({ sort: "bogus" }).success).toBe(false);
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
