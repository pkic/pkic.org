import { createExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import {
  seedMemberApplication,
  createApplicationFormSubmission,
  requiredMembershipApplicationAnswers,
} from "./helpers/member-applications";
import { importMembershipApplication } from "../functions/_lib/services/membership/applications/import";
import { activateImportedApplication } from "../functions/_lib/services/membership/applications/import-activation";
import { runOnHoldReminders } from "../functions/_lib/services/membership/on-hold-reminders";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import {
  applicationImportEligibility,
  historicalApplicationFields,
} from "../assets/shared/membership-application-import";
import {
  githubApplicationEvidenceSchema,
  type ApplicationImportMapping,
} from "../assets/shared/schemas/membership-application-import";
import {
  membershipApplicationsListResponseSchema,
  membershipApplicationDetailSchema,
} from "../assets/shared/schemas/membership-application-management";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import {
  getApplicationSource,
  getHistoricalApplicationDetail,
} from "../functions/_lib/services/membership/applications/source-detail";
import type { DatabaseLike, UserBackedAuthAdmin } from "../functions/_lib/types";

const created = "2020-01-01T00:00:00.000Z";
const closed = "2020-02-01T00:00:00.000Z";
function evidence(number = 101, state: "open" | "closed" = "closed") {
  return githubApplicationEvidenceSchema.parse({
    repository: "pkic/members",
    labelId: 10,
    issue: {
      id: number + 1000,
      number,
      html_url: `https://github.com/pkic/members/issues/${number}`,
      title: "Example Organization membership application",
      body: "**First Name**: Example\n**Last Name**: User\n**Email**: user@example.test",
      state,
      state_reason: state === "closed" ? "completed" : null,
      labels: [{ id: 10, name: "Membership application" }],
      created_at: created,
      updated_at: closed,
      closed_at: state === "closed" ? closed : null,
    },
    comments: [
      {
        id: 11,
        body: "Staff review completed against the application form.",
        user: { login: "reviewer" },
        created_at: created,
      },
    ],
    timeline: state === "closed" ? [{ id: 12, event: "closed", actor: { login: "reviewer" }, created_at: closed }] : [],
  });
}
function mapping(): ApplicationImportMapping {
  return {
    manualHold: false,
    answers: { ...requiredMembershipApplicationAnswers, reason: "Our organization contributes to the consortium." },
    applicantName: "Example User",
    applicantEmail: "user@example.test",
    organizationName: "Example Organization",
    categoryCode: "F",
    applicantUserId: null,
    organizationId: null,
    outcome: "closed_unknown",
    mappingReason: "Source evidence does not establish the membership outcome.",
    workflow: null,
  };
}

describe("membership application source eligibility", () => {
  it.each(["not_planned", "duplicate", null])("excludes closure reason %s", (reason) => {
    const source = evidence();
    source.issue.state_reason = reason;
    expect(applicationImportEligibility(source).eligible).toBe(false);
  });
  it("checks label identity, pull requests, final closure, and effective duplicate evidence", () => {
    const source = evidence();
    expect(applicationImportEligibility(source).eligible).toBe(true);
    source.timeline[0].created_at = "2020-02-01T00:00:01.000Z";
    expect(applicationImportEligibility(source).eligible).toBe(true);
    source.issue.labels[0].id = 99;
    expect(applicationImportEligibility(source).reason).toBe("missing_label");
    source.issue.labels[0].id = 10;
    source.issue.pull_request = {};
    expect(applicationImportEligibility(source).reason).toBe("pull_request");
    delete source.issue.pull_request;
    source.timeline.push({ id: 13, event: "marked_as_duplicate", created_at: closed });
    expect(applicationImportEligibility(source).reason).toBe("duplicate");
    source.timeline.push({ id: 14, event: "unmarked_as_duplicate", created_at: closed });
    expect(applicationImportEligibility(source).eligible).toBe(true);
    source.timeline.push({ id: 15, event: "reopened", created_at: closed });
    expect(applicationImportEligibility(source).reason).toBe("ambiguous_closure");
    source.timeline.push({ id: 16, event: "closed", created_at: closed });
    expect(applicationImportEligibility(source).eligible).toBe(true);
  });
  it("preserves multiline fields and missing consent", () => {
    expect(historicalApplicationFields("**Reason**: First line\nSecond line\n**Category[]**: F")).toEqual({
      Reason: "First line\nSecond line",
      "Category[]": "F",
    });
    expect(historicalApplicationFields("No recorded answers")).toEqual({});
  });
});

describe("membership application imports and scoped history", () => {
  afterEach(() => vi.unstubAllGlobals());
  let actor: UserBackedAuthAdmin;
  let token: string;
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    actor = { identityType: "user", id: user.id, email: "admin@pkic.org", role: "admin" };
    token = await createAdminSession(env.DB, actor.id, "import-test-session");
  });
  const request = (token: string, path: string) =>
    app.fetch(
      new Request(`https://app.test/api/v1/members/applications${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      createExecutionContext(),
    );
  async function importSource(
    number = 101,
    overrides: Partial<ApplicationImportMapping> = {},
    state: "open" | "closed" = "closed",
    db: DatabaseLike = env.DB,
  ) {
    const source = evidence(number, state);
    return importMembershipApplication(db, actor, {
      runId: "synthetic-run",
      sourceIssueNumber: number,
      expectedUpdatedAt: source.issue.updated_at,
      mapping: { ...mapping(), ...overrides },
      readSource: async () => source,
    });
  }
  it.each(["applicantName", "applicantEmail", "categoryCode", "workflow"] as const)(
    "rejects a missing active %s before identity, form, and workflow reads",
    async (field) => {
      const budgeted = createD1QueryBudgetedDatabase(env.DB, 1);
      await expect(importSource(102, { outcome: null, [field]: null }, "open", budgeted.db)).rejects.toMatchObject({
        code: field === "workflow" ? "IMPORT_WORKFLOW_REQUIRED" : "IMPORT_FIELDS_REQUIRED",
      });
      expect(budgeted.budget.usedQueries()).toBe(1);
      expect(await queryAll(env.DB, "SELECT id FROM membership_application_sources")).toHaveLength(0);
    },
  );
  it("requires the reviewed mapping to acknowledge the requester-mandated hold", async () => {
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 1);
    await expect(
      importSource(
        795,
        {
          outcome: null,
          workflow: { versionId: crypto.randomUUID(), currentPosition: 0, steps: [], objections: [] },
        },
        "open",
        budgeted.db,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_MANUAL_HOLD_REQUIRED" });
    expect(budgeted.budget.usedQueries()).toBe(1);
  });
  it("does not record a hold release when activating an application already processing", async () => {
    await createApplicationFormSubmission({ reason: "Synthetic application form" });
    const [category] = await queryAll<{ workflow_version_id: string }>(
      env.DB,
      "SELECT workflow_version_id FROM membership_categories WHERE code = 'F'",
    );
    const record = await importSource(
      102,
      {
        outcome: null,
        workflow: { versionId: category.workflow_version_id, currentPosition: 0, steps: [], objections: [] },
      },
      "open",
    );
    const before = await queryAll(
      env.DB,
      "SELECT stage, stage_entered_at, transition_revision FROM member_applications WHERE id = ?",
      record.id,
    );
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${record.id}/activation`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Reconciled source evidence and portal processing ownership.",
          releaseManualHold: true,
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT stage, stage_entered_at, transition_revision FROM member_applications WHERE id = ?",
        record.id,
      ),
    ).toEqual(before);
    expect(
      await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", record.id),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT activated_at FROM membership_application_sources WHERE application_id = ?",
        record.id,
      ),
    ).toEqual([{ activated_at: expect.any(String) }]);
  });
  it("keeps historical source IDs distinct from live application IDs when they collide", async () => {
    const history = await importSource(101);
    await createApplicationFormSubmission({ reason: "Synthetic application form" });
    const [category] = await queryAll<{ workflow_version_id: string }>(
      env.DB,
      "SELECT workflow_version_id FROM membership_categories WHERE code = 'F'",
    );
    const active = await importSource(
      102,
      {
        outcome: null,
        applicantEmail: "other@other.test",
        workflow: { versionId: category.workflow_version_id, currentPosition: 0, steps: [], objections: [] },
      },
      "open",
    );
    await env.DB.prepare("UPDATE membership_application_sources SET id = ? WHERE id = ?")
      .bind(active.id, history.id)
      .run();
    const response = await request(token, `/${active.id}`);
    expect(response.status).toBe(200);
    expect(membershipApplicationDetailSchema.parse(await response.json()).source?.issueNumber).toBe(102);
    expect((await getHistoricalApplicationDetail(env.DB, active.id))?.source?.issueNumber).toBe(101);
    const [liveSource] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM membership_application_sources WHERE application_id = ?",
      active.id,
    );
    expect(await getApplicationSource(env.DB, liveSource.id, "source")).toBeNull();
  });
  it("requires staff authorization and re-reads every source page through the mounted import endpoint", async () => {
    const source = evidence();
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        paths.push(url.pathname + url.search);
        const payload = url.pathname.includes("/labels/")
          ? { id: 10, name: "Membership application" }
          : url.pathname.endsWith("/comments")
            ? url.searchParams.get("page") === "1"
              ? Array.from({ length: 100 }, (_, i) => ({ ...source.comments[0], id: i + 100 }))
              : []
            : url.pathname.endsWith("/timeline")
              ? source.timeline
              : source.issue;
        return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
      }),
    );
    const body = JSON.stringify({
      runId: crypto.randomUUID(),
      sourceIssueNumber: 101,
      expectedUpdatedAt: closed,
      mapping: mapping(),
    });
    const send = (bearer: string) =>
      app.fetch(
        new Request("https://app.test/api/v1/members/applications/imports", {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body,
        }),
        { ...env, GITHUB_MEMBERS_IMPORT_TOKEN: "synthetic-source-token" },
        createExecutionContext(),
      );
    expect((await send("invalid")).status).toBe(401);
    expect(paths).toHaveLength(0);
    const result = await send(token);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(paths.filter((path) => path.endsWith("/issues/101"))).toHaveLength(2);
    expect(paths).toContain("/repos/pkic/members/issues/101/comments?per_page=100&page=2");
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });
  it("imports incomplete history without live accounts, memberships, forms, or outbox effects; reruns retain the first mapping", async () => {
    const usersBefore = await queryAll(env.DB, "SELECT id FROM users");
    const record = await importSource(101, { applicantName: null, applicantEmail: null, categoryCode: null });
    expect(await importSource(101, { outcome: "approved" })).toEqual({ id: record.id, imported: false });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users")).toEqual(usersBefore);
    const response = await request(token, `/${record.id}`);
    expect(response.status).toBe(200);
    const detail = membershipApplicationDetailSchema.parse(await response.json());
    expect(detail).toMatchObject({
      stage: "closed_unknown",
      membershipCategoryLabel: "Unknown category",
      closedAt: closed,
      answers: {},
      source: {
        issueNumber: 101,
        historical: true,
        snapshot: { events: expect.arrayContaining([expect.objectContaining({ author: "reviewer" })]) },
      },
    });
    expect((await request("invalid", `/${record.id}`)).status).toBe(401);
  });
  it("keeps stage filters inside their scope and returns accurate searched, sorted pages including portal history", async () => {
    await seedMemberApplication({ applicantEmail: "active@example.test", organizationDomain: null });
    await seedMemberApplication({
      stage: "withdrawn",
      applicantName: "Portal User",
      applicantEmail: "portal@portal.test",
      organizationName: "Portal Organization",
      organizationDomain: null,
    });
    await importSource(101, { outcome: "declined" });
    await importSource(102, { outcome: "approved" });
    const load = async (query: string) =>
      membershipApplicationsListResponseSchema.parse(await (await request(token, query)).json());
    expect((await load("")).applications).toHaveLength(1);
    expect((await load("?stage=approved")).applications).toHaveLength(0);
    expect((await load("?scope=history&stage=processing")).applications).toHaveLength(0);
    const page = await load("?scope=history&q=Example&sort=stage&limit=1");
    expect(page.page.total).toBe(2);
    expect(page.applications[0].stage).toBe("approved");
    const last = await load("?scope=history&q=Example&sort=stage&limit=1&offset=1");
    expect(last.applications[0].stage).toBe("declined");
    expect((await load("?scope=history&offset=100")).page.total).toBe(3);
  });
  it("revalidates source changes and rolls back an interrupted import", async () => {
    const source = evidence();
    source.issue.state_reason = "not_planned";
    await expect(
      importMembershipApplication(env.DB, actor, {
        runId: "failed",
        sourceIssueNumber: 101,
        expectedUpdatedAt: closed,
        mapping: mapping(),
        readSource: async () => source,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_SOURCE_CHANGED" });
    await expect(importSource(102, { applicantUserId: crypto.randomUUID() })).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM membership_application_sources")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM membership_application_import_runs")).toHaveLength(0);
  });
  it("restores consensus evidence and timing without replaying notices, and refuses expired activation", async () => {
    await createApplicationFormSubmission({ reason: "Synthetic application form" });
    const [category] = await queryAll<{ workflow_version_id: string }>(
      env.DB,
      "SELECT workflow_version_id FROM membership_categories WHERE code = 'F'",
    );
    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 3 * 86400_000).toISOString();
    const source = evidence(900, "open");
    source.issue.updated_at = now;
    source.issue.labels.push({ id: 20, name: "Member Consultation" });
    const workflow = {
      versionId: category.workflow_version_id,
      currentPosition: 1,
      steps: [
        { position: 0, completedAt: created, openedAt: null, deadlineAt: null, evidenceEventIds: ["11"] },
        { position: 1, completedAt: null, openedAt: now, deadlineAt: deadline, evidenceEventIds: ["11"] },
      ],
      objections: [],
    };
    const record = await importMembershipApplication(env.DB, actor, {
      runId: "consensus-run",
      sourceIssueNumber: 900,
      expectedUpdatedAt: now,
      mapping: { ...mapping(), outcome: null, workflow },
      readSource: async () => source,
    });
    await evaluateMembershipApplication(env.DB, record.id, "https://app.test");
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    await activateImportedApplication(
      env.DB,
      actor,
      record.id,
      "Reviewed audience eligibility, prior evidence, objections, and portal ownership.",
    );
    await evaluateMembershipApplication(env.DB, record.id, "https://app.test");
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT opened_at, deadline_at, state FROM membership_application_steps WHERE application_id = ? AND position = 1",
        record.id,
      ),
    ).toEqual([{ opened_at: now, deadline_at: deadline, state: "active" }]);
    const expired = evidence(901, "open");
    expired.issue.updated_at = now;
    const expiredMapping = {
      ...mapping(),
      applicantEmail: "other@other.test",
      outcome: null,
      workflow: {
        ...workflow,
        steps: [workflow.steps[0], { ...workflow.steps[1], openedAt: created, deadlineAt: closed }],
      },
    };
    const expiredRecord = await importMembershipApplication(env.DB, actor, {
      runId: "expired-run",
      sourceIssueNumber: 901,
      expectedUpdatedAt: now,
      mapping: expiredMapping,
      readSource: async () => expired,
    });
    await expect(
      activateImportedApplication(env.DB, actor, expiredRecord.id, "The source deadline elapsed before cutover."),
    ).rejects.toMatchObject({ code: "IMPORT_REVIEW_TIMING_REQUIRED" });
  });

  it.each([795, 902])(
    "keeps source #%i on its reviewed manual hold across scheduler runs and reruns",
    async (number) => {
      const [category] = await queryAll<{ workflow_version_id: string }>(
        env.DB,
        "SELECT workflow_version_id FROM membership_categories WHERE code = 'F'",
      );
      await createApplicationFormSubmission({ reason: "Synthetic application form" });
      const workflow = { versionId: category.workflow_version_id, currentPosition: 0, steps: [], objections: [] };
      const result = await importSource(number, { outcome: null, workflow, manualHold: true }, "open");
      const [audit] = await queryAll<{ details_json: string }>(
        env.DB,
        "SELECT details_json FROM audit_log WHERE entity_id = ? AND action = 'membership_application_imported'",
        result.id,
      );
      expect(JSON.parse(audit.details_json)).toMatchObject({
        manualHold: { from: null, to: true },
        reason: { from: null, to: mapping().mappingReason },
      });
      await env.DB.prepare("UPDATE member_applications SET stage_entered_at = ? WHERE id = ?")
        .bind(created, result.id)
        .run();
      expect(await runOnHoldReminders(env.DB, env)).toEqual({ remindersSent: 0, autoClosed: 0 });
      expect(await evaluateMembershipApplication(env.DB, result.id, "https://app.test")).toMatchObject({
        approved: false,
      });
      await importSource(number, { outcome: null, workflow, manualHold: true }, "open");
      expect(
        await queryAll(
          env.DB,
          "SELECT stage, on_hold_subtype, review_notes FROM member_applications WHERE id = ?",
          result.id,
        ),
      ).toEqual([
        { stage: "on_hold", on_hold_subtype: "manual", review_notes: "On hold until explicitly instructed otherwise" },
      ]);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
      await expect(
        activateImportedApplication(env.DB, actor, result.id, "Review evidence is reconciled."),
      ).rejects.toMatchObject({ code: "IMPORT_MANUAL_HOLD" });
      await activateImportedApplication(
        env.DB,
        actor,
        result.id,
        "Requester explicitly released the hold; staff review must now proceed.",
        true,
      );
      await importSource(number, { outcome: null, workflow, manualHold: true }, "open");
      expect(await queryAll(env.DB, "SELECT stage FROM member_applications WHERE id = ?", result.id)).toEqual([
        { stage: "processing" },
      ]);
      expect(
        await queryAll(
          env.DB,
          "SELECT from_stage, to_stage FROM member_application_events WHERE application_id = ?",
          result.id,
        ),
      ).toEqual([{ from_stage: "on_hold", to_stage: "processing" }]);
    },
  );
});
