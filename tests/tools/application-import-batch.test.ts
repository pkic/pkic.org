import { describe, expect, it, vi } from "vitest";
import { createReport, executeBatch, resumeReport } from "../../scripts/membership-application-import/batch.mjs";
import { parseManifest } from "../../scripts/membership-application-import/manifest.mjs";
import { contracts, resultId, reviewedManifest } from "./helpers/application-import-fixtures";

const manifest = () => parseManifest(reviewedManifest(), contracts, "https://pkic.org");
const success = (imported = true) => Response.json({ id: resultId, imported });
function execution(fetchImpl = vi.fn<typeof fetch>(async () => success())) {
  const input = manifest();
  const report = createReport(input, contracts, true);
  const saved: (typeof report)[] = [];
  return {
    manifest: input,
    report,
    contracts,
    token: "synthetic-session",
    signal: new AbortController().signal,
    fetchImpl,
    save: async (state: typeof report) => {
      saved.push(structuredClone(state));
    },
    saved,
  };
}

describe("reviewed application import manifests", () => {
  it("uses the canonical contract and requires explicit review metadata", () => {
    const input = reviewedManifest();
    input.entries[0].reviewedBy = "";
    expect(() => parseManifest(input, contracts, "https://pkic.org")).toThrow("reviewedBy");
    input.entries[0].reviewedBy = "Reviewer";
    input.entries[0].mapping.applicantEmail = "not-an-email";
    expect(() => parseManifest(input, contracts, "https://pkic.org")).toThrow("manifest");
  });
  it("rejects duplicate issues and timestamps without UTC milliseconds", () => {
    const input = reviewedManifest();
    input.entries[1].sourceIssueNumber = 1;
    expect(() => parseManifest(input, contracts, "https://pkic.org")).toThrow("sourceIssueNumber");
    input.entries[1].sourceIssueNumber = 2;
    input.entries[0].expectedUpdatedAt = "2026-01-01T00:00:00Z";
    expect(() => parseManifest(input, contracts, "https://pkic.org")).toThrow("expectedUpdatedAt");
  });
  it.each(["https://preview.pkic.org", "https://pkic.org/path", "https://user:password@pkic.org", "http://pkic.org"])(
    "rejects unsafe destination %s",
    (origin) => {
      expect(() => parseManifest(reviewedManifest(origin), contracts, "https://pkic.org")).toThrow();
    },
  );
  it("permits only synthetic data on local loopback", () => {
    const input = reviewedManifest("http://127.0.0.1:8788");
    expect(parseManifest(input, contracts, "https://pkic.org").environment).toBe("local");
    input.sourceData = "private";
    expect(() => parseManifest(input, contracts, "https://pkic.org")).toThrow("synthetic");
  });
  it("accounts for exclusions and unresolved mappings without sending them", async () => {
    const input = parseManifest(
      {
        ...reviewedManifest(),
        entries: [
          reviewedManifest().entries[0],
          { decision: "exclude", sourceIssueNumber: 2, owner: "Reviewer", reason: "Not an application form" },
          { decision: "unresolved", sourceIssueNumber: 3, owner: "Reviewer", reason: "Organization identity unclear" },
        ],
      },
      contracts,
      "https://pkic.org",
    );
    const dry = createReport(input, contracts, false);
    expect(dry.summary).toMatchObject({ ready: 1, excluded: 1, unresolved: 1 });
    const run = { ...execution(), manifest: input, report: createReport(input, contracts, true) };
    expect(await executeBatch(run)).toBe(2);
    expect(run.fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(run.report)).not.toMatch(
      /Example User|user@example.org|Organization identity|synthetic-session/,
    );
  });
});

describe("checkpointed application imports", () => {
  it("persists intent before canonical authenticated requests and records idempotent results", async () => {
    const run = execution();
    run.fetchImpl
      .mockImplementationOnce(async (url, options) => {
        expect(run.saved.at(-1)?.entries[0]).toMatchObject({ status: "in_flight", attempts: 1 });
        expect(url).toBe("https://pkic.org/api/v1/members/applications/imports");
        expect(options).toMatchObject({
          method: "POST",
          redirect: "error",
          headers: { authorization: "Bearer synthetic-session" },
        });
        const request = contracts.membershipApplicationImportRequestSchema.parse(JSON.parse(String(options?.body)));
        expect(request.sourceIssueNumber).toBe(1);
        expect(JSON.parse(String(options?.body))).not.toHaveProperty("reviewedBy");
        return success();
      })
      .mockImplementationOnce(async () => success(false));
    expect(await executeBatch(run)).toBe(0);
    expect(run.report.summary).toMatchObject({ imported: 1, already_present: 1 });
    const resumed = resumeReport(run.report, run.manifest, contracts);
    expect(await executeBatch({ ...run, report: resumed })).toBe(0);
    expect(run.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 500, 503])("stops after HTTP %s without leaking response text", async (status) => {
    const run = execution(vi.fn(async () => new Response("private user and token", { status })));
    expect(await executeBatch(run)).toBe(2);
    expect(run.fetchImpl).toHaveBeenCalledTimes(1);
    expect(run.report.entries[0]).toMatchObject({ status: status >= 500 ? "uncertain" : "failed", httpStatus: status });
    expect(run.report.entries[1].status).toBe("pending");
    expect(JSON.stringify(run.report)).not.toContain("private user");
  });
  it("continues after an individual refusal and retries only the failed entry on resume", async () => {
    const run = execution();
    run.fetchImpl.mockImplementationOnce(async () => new Response(null, { status: 422 }));
    expect(await executeBatch(run)).toBe(2);
    const resumed = resumeReport(run.report, run.manifest, contracts);
    expect(await executeBatch({ ...run, report: resumed })).toBe(0);
    expect(run.fetchImpl).toHaveBeenCalledTimes(3);
    expect(resumed.entries.map((entry) => entry.attempts)).toEqual([2, 1]);
  });
  it.each(["not json", JSON.stringify({ id: "invalid", imported: true }), "x".repeat(65537)])(
    "leaves malformed/oversized responses uncertain",
    async (body) => {
      const run = execution(vi.fn(async () => new Response(body)));
      expect(await executeBatch(run)).toBe(2);
      expect(run.report.entries[0].status).toBe("uncertain");
      expect(run.fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("replays a lost response safely without repeating completed rows", async () => {
    const run = execution();
    run.fetchImpl.mockImplementationOnce(async () => {
      throw new Error("secret response lost after server commit");
    });
    expect(await executeBatch(run)).toBe(2);
    run.fetchImpl.mockImplementationOnce(async () => success(false));
    const resumed = resumeReport(run.report, run.manifest, contracts);
    expect(await executeBatch({ ...run, report: resumed })).toBe(0);
    expect(resumed.summary).toMatchObject({ imported: 1, already_present: 1 });
    expect(JSON.stringify(resumed)).not.toContain("secret");
  });
  it("recovers an in-flight checkpoint after the result cannot be saved", async () => {
    const run = execution();
    const save = run.save;
    await expect(
      executeBatch({
        ...run,
        save: async (state: typeof run.report) => {
          if (state.entries[0].status === "imported") throw new Error("disk full");
          await save(state);
        },
      }),
    ).rejects.toThrow("disk full");
    const checkpoint = run.saved.at(-1)!;
    expect(checkpoint.entries[0].status).toBe("in_flight");
    run.fetchImpl.mockImplementationOnce(async () => success(false));
    const resumed = resumeReport(checkpoint, run.manifest, contracts);
    expect(await executeBatch({ ...run, report: resumed })).toBe(0);
    expect(resumed.entries[0].status).toBe("already_present");
  });
  it("checkpoints an interruption and does not start subsequent requests", async () => {
    const controller = new AbortController();
    const run = execution(
      vi.fn(async () => {
        controller.abort();
        throw new Error("aborted");
      }),
    );
    expect(await executeBatch({ ...run, signal: controller.signal })).toBe(130);
    expect(run.report.phase).toBe("interrupted");
    expect(run.report.entries[0]).toMatchObject({ status: "uncertain", error: "interrupted" });
    expect(run.report.entries[1].status).toBe("pending");
  });
  it("refuses changed manifests, dry runs, and corrupt row identities", () => {
    const run = execution();
    const changed = structuredClone(run.manifest);
    changed.entries[0].mapping.organizationName = "Different Organization";
    expect(() => resumeReport(run.report, changed, contracts)).toThrow("exact reviewed manifest");
    expect(() => resumeReport(createReport(run.manifest, contracts, false), run.manifest, contracts)).toThrow();
    run.report.entries[0].sourceIssueNumber = 999;
    expect(() => resumeReport(run.report, run.manifest, contracts)).toThrow("entries");
  });
});
