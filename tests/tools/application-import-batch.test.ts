import { describe, expect, it, vi } from "vitest";
import { createReport, executeBatch, resumeReport } from "../../scripts/membership-application-import/batch.mjs";
import { parseManifest, unresolvedReason } from "../../scripts/membership-application-import/manifest.mjs";
import { importEntry, databaseArguments } from "../../scripts/membership-application-import/database.mjs";
import { applicationBackfillSql, sourceId } from "../../scripts/membership-application-import/sql.mjs";
import { readGithubSource } from "../../scripts/membership-application-import/github.mjs";
import { contracts, databaseId, reviewedManifest, parsedReviewedManifest } from "./helpers/application-import-fixtures";

const manifest = () => parsedReviewedManifest();
function execution() {
  const input = manifest();
  const report = createReport(input, contracts, true);
  const saved: (typeof report)[] = [];
  const perform = vi.fn<() => ReturnType<typeof importEntry>>(async () => ({
    status: "imported",
    resultId: sourceId(input.entries[0].source),
    stop: false,
  }));
  return {
    manifest: input,
    report,
    contracts,
    directory: "/tmp",
    signal: new AbortController().signal,
    performImport: () => perform(),
    perform,
    save: async (state: typeof report) => {
      saved.push(structuredClone(state));
    },
    saved,
  };
}

describe("backfill-only manifests", () => {
  it("rejects old manifests, duplicate issues, missing reviews, and wrong database targets", () => {
    const input = reviewedManifest();
    expect(() => parseManifest({ ...input, version: 1 }, contracts, databaseId)).toThrow();
    expect(() => parseManifest(input, contracts, "another-database")).toThrow("Destination");
    input.entries[0].reviewedBy = "";
    expect(() => parseManifest(input, contracts, databaseId)).toThrow("reviewedBy");
    input.entries[0].reviewedBy = "Reviewer";
    input.entries[1].sourceIssueNumber = 1;
    expect(() => parseManifest(input, contracts, databaseId)).toThrow();
  });
  it("requires synthetic isolated local targets and never allows preview", () => {
    expect(() => parseManifest({ ...reviewedManifest(), environment: "preview" }, contracts, databaseId)).toThrow();
    expect(() =>
      parseManifest({ ...reviewedManifest("/tmp/example"), sourceData: "private" }, contracts, databaseId),
    ).toThrow("synthetic");
    expect(databaseArguments(manifest())).toContain("--remote");
    expect(databaseArguments(parseManifest(reviewedManifest("/tmp/example"), contracts, databaseId))).not.toContain(
      "--remote",
    );
  });
  it.each(["outcome", "applicantName", "applicantEmail", "membershipCategory", "decisionAt"])(
    "keeps missing %s unresolved",
    (field) => {
      const input = reviewedManifest();
      const mapped = parseManifest(
        { ...input, entries: [{ ...input.entries[0], mapping: { ...input.entries[0].mapping, [field]: null } }] },
        contracts,
        databaseId,
      );
      expect(createReport(mapped, contracts, false).summary.unresolved).toBe(1);
      expect(() => applicationBackfillSql(mapped, mapped.entries[0])).toThrow("Unresolved");
    },
  );
  it.each(["not_planned", "duplicate", "other"])("refuses closed disposition %s", (reason) => {
    const input = manifest();
    input.entries[0].source.issue.state_reason = reason;
    expect(unresolvedReason(input.entries[0])).toMatch(/^source_/);
  });
  it("leaves open workflows and indefinite holds unresolved without database calls", async () => {
    const run = execution();
    for (const entry of run.manifest.entries) {
      entry.source.issue.state = "open";
      entry.source.issue.closed_at = null;
    }
    run.report = createReport(run.manifest, contracts, true);
    expect(await executeBatch(run)).toBe(2);
    expect(run.report.summary.unresolved).toBe(2);
    expect(run.perform).not.toHaveBeenCalled();
  });
  it("rejects PRs, missing labels, unresolved duplicates, and ambiguous final closure", () => {
    const entry = manifest().entries[0];
    for (const source of [
      { ...entry.source, issue: { ...entry.source.issue, pull_request: {} } },
      { ...entry.source, issue: { ...entry.source.issue, labels: [] } },
      { ...entry.source, timeline: [] },
      {
        ...entry.source,
        timeline: [
          ...entry.source.timeline,
          { id: 302, event: "marked_as_duplicate", created_at: "2020-01-03T01:00:00.000Z" },
        ],
      },
    ])
      expect(unresolvedReason({ ...entry, source })).toMatch(/^source_/);
  });
  it("uses final chronological duplicate and closure dispositions", () => {
    const entry = manifest().entries[0];
    entry.source.timeline = [
      ...entry.source.timeline,
      { id: 1, event: "marked_as_duplicate", created_at: "2020-01-01T01:00:00.000Z" },
      { id: 2, event: "unmarked_as_duplicate", created_at: "2020-01-02T01:00:00.000Z" },
    ];
    expect(unresolvedReason(entry)).toBeNull();
  });
});

describe("checkpointed execution", () => {
  it("persists intent, skips successful rows, and never includes personal details in reports", async () => {
    const run = execution();
    run.perform.mockImplementation(async () => {
      expect(run.saved.at(-1)?.entries.some((entry: { status: string }) => entry.status === "in_flight")).toBe(true);
      return { status: "imported", resultId: sourceId(run.manifest.entries[0].source), stop: false };
    });
    expect(await executeBatch(run)).toBe(0);
    expect(await executeBatch({ ...run, report: resumeReport(run.report, run.manifest, contracts) })).toBe(0);
    expect(run.perform).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(run.report)).not.toMatch(/Example User|example.org|source review comment/);
  });
  it("recovers a saved in-flight checkpoint after losing the result write", async () => {
    const run = execution();
    await expect(
      executeBatch({
        ...run,
        save: async (state: typeof run.report) => {
          if (state.entries[0].status === "imported") throw new Error("disk full");
          await run.save(state);
        },
      }),
    ).rejects.toThrow("disk full");
    const prior = run.saved.at(-1)!;
    expect(prior.entries[0].status).toBe("in_flight");
    run.perform.mockImplementationOnce(async () => ({
      status: "already_present",
      resultId: sourceId(run.manifest.entries[0].source),
      stop: false,
    }));
    expect(await executeBatch({ ...run, report: resumeReport(prior, run.manifest, contracts) })).toBe(0);
  });
  it("stops on uncertainty and resumes only incomplete work", async () => {
    const run = execution();
    run.perform.mockImplementationOnce(async () => ({
      status: "uncertain",
      error: "operational_command",
      stop: true,
    }));
    expect(await executeBatch(run)).toBe(2);
    expect(run.report.entries[1].status).toBe("pending");
    expect(await executeBatch({ ...run, report: resumeReport(run.report, run.manifest, contracts) })).toBe(0);
  });
  it("rejects changed manifests and dry-run reports on resume", () => {
    const run = execution();
    expect(() => resumeReport(createReport(run.manifest, contracts, false), run.manifest, contracts)).toThrow();
    run.manifest.actorUserId = "33333333-3333-4333-8333-333333333333";
    expect(() => resumeReport(run.report, run.manifest, contracts)).toThrow();
  });
  it("does not start work after interruption", async () => {
    const run = execution();
    const controller = new AbortController();
    controller.abort();
    expect(await executeBatch({ ...run, signal: controller.signal })).toBe(130);
    expect(run.perform).not.toHaveBeenCalled();
  });
});

describe("live source revalidation", () => {
  it("refuses changed evidence before any D1 command", async () => {
    const input = manifest();
    const entry = input.entries[0];
    const fresh = structuredClone(entry.source);
    fresh.issue.body = "Changed";
    const command = vi.fn();
    const result = await importEntry({
      manifest: input,
      entry,
      directory: "/tmp",
      signal: new AbortController().signal,
      command,
      readSource: async () => fresh,
    });
    expect(result).toMatchObject({ status: "failed", error: "source_changed" });
    expect(command).not.toHaveBeenCalled();
  });
  it("reads all comment pages and rereads the issue, without forwarding source access to the portal", async () => {
    const source = manifest().entries[0].source;
    const command = vi.fn(async (_command: string, args: string[]) => {
      const path = args[1];
      if (path.includes("labels/")) return JSON.stringify({ id: 7, name: "Membership application" });
      if (path.includes("comments"))
        return JSON.stringify(
          path.endsWith("page=1") ? Array.from({ length: 100 }, (_, i) => ({ ...source.comments[0], id: i + 1 })) : [],
        );
      if (path.includes("timeline")) return JSON.stringify(source.timeline);
      return JSON.stringify(source.issue);
    });
    const actual = await readGithubSource(1, new AbortController().signal, command);
    expect(actual.comments).toHaveLength(100);
    expect(command.mock.calls.every(([name]) => name === "gh")).toBe(true);
    expect(command).toHaveBeenCalledTimes(6);
  });
});
