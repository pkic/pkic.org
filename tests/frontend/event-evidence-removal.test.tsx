// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceRemoval } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EvidenceRemoval";
import {
  EVIDENCE_PURGE_TABLES,
  evidencePurgeReviewCreateSchema,
  evidencePurgeRunCreateSchema,
  evidencePurgeChunkCreateSchema,
  evidencePurgeResumptionCreateSchema,
  evidencePurgePreviewSchema,
} from "../../assets/shared/schemas/event-evidence-purge";
const eventId = "10000000-0000-4000-8000-000000000001";
const runId = "10000000-0000-4000-8000-000000000002";
const at = "2026-10-04T12:00:00.000Z";
const preview = () =>
  evidencePurgePreviewSchema.parse({
    success: true,
    previewHash: "c".repeat(64),
    eventId,
    policyRevision: 1,
    sourceGeneration: 3,
    publicationRevision: null,
    timeZone: "UTC",
    activeRunId: null,
    counts: Object.fromEntries(EVIDENCE_PURGE_TABLES.map((table) => [table, 0])),
    blockers: [],
    reconciliation: {
      scope: "event",
      coverage: "from_event_creation",
      coverageStartedAt: at,
      sourceState: "live",
      knownEpochs: 0,
      openEpochs: 0,
      closingEpochs: 0,
      closedEpochs: 0,
      unknownHighWaterEpochs: 0,
      missingDeclaredReceipts: 0,
      unprovenClosedEpochs: 0,
      untrackedAttempts: 0,
      unclosedGrants: 0,
      deviceBacklog: "complete",
    },
  });
const run = () => ({
  success: true,
  runId,
  eventId,
  status: "running",
  phase: "aggregates",
  ordinal: 0,
  sourceGeneration: 3,
  startedAt: at,
  completedAt: null,
  reconciliation: preview().reconciliation,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let host: HTMLElement;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(canRemove = true) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<EvidenceRemoval eventId={eventId} canRemove={canRemove} />, host));
  await settle();
}
async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label)!;
  await act(() => button.click());
  await settle();
}
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
describe("reviewed evidence removal", () => {
  it("requires a renewed review after a policy change without restarting capture", async () => {
    const captured: unknown[] = [];
    let renewed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, options?: RequestInit) => {
        const url = String(input);
        if (options?.method === "POST" && url.endsWith("/reviews")) {
          captured.push(evidencePurgeReviewCreateSchema.parse(JSON.parse(String(options.body))));
          return json({
            ...preview(),
            activeRunId: runId,
            reviewId: runId,
            reviewHash: "b".repeat(64),
            reviewedAt: at,
            expiresAt: "2026-10-04T12:15:00.000Z",
          });
        }
        if (options?.method === "POST" && url.endsWith("/resumptions")) {
          captured.push(evidencePurgeResumptionCreateSchema.parse(JSON.parse(String(options.body))));
          renewed = true;
        }
        return json(
          url.endsWith("/evidence")
            ? { ...preview(), activeRunId: runId, blockers: ["active_run", "device_reconciliation_incomplete"] }
            : { ...run(), reviewRequired: !renewed },
        );
      }),
    );
    await mount();
    expect(host.textContent).not.toContain("Continue removal");
    expect(host.textContent).toContain("Event capture stays retired");
    await click("Review policy change");
    await click("Resume reviewed removal");
    expect(captured).toHaveLength(2);
    expect(host.textContent).toContain("Continue removal");
    expect(host.textContent).not.toContain("Retire capture and start removal");
  });
  it("explains blockers and offers no destructive start", async () => {
    const fetcher = vi.fn(async () => json({ ...preview(), blockers: ["device_reconciliation_incomplete"] }));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(host.textContent).toContain("Finish scanner sessions");
    expect(host.textContent).not.toContain("Review current evidence");
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it("requires a pinned review and explicit retirement confirmation", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, options?: RequestInit) => {
        const url = String(input);
        if (options?.method === "POST" && url.endsWith("/reviews")) {
          requests.push(evidencePurgeReviewCreateSchema.parse(JSON.parse(String(options.body))));
          return json({
            ...preview(),
            reviewId: runId,
            reviewHash: "a".repeat(64),
            reviewedAt: at,
            expiresAt: "2026-10-04T12:15:00.000Z",
          });
        }
        if (options?.method === "POST" && url.endsWith("/runs")) {
          requests.push(evidencePurgeRunCreateSchema.parse(JSON.parse(String(options.body))));
          return json(run());
        }
        return json(preview());
      }),
    );
    await mount();
    expect(host.textContent).toContain("All evidence included in this review");
    expect(host.textContent).toContain("Badge credentials");
    expect(host.textContent).toContain("Attendance import source links");
    await click("Review current evidence");
    await click("Retire capture and start removal");
    expect(requests).toHaveLength(1);
    const checkbox = host.querySelector<HTMLInputElement>('input[name="retireCapture"]')!;
    await act(() => checkbox.click());
    await settle();
    await click("Retire capture and start removal");
    expect(requests).toHaveLength(2);
    expect(host.textContent).toContain("Removal is in progress");
  });
  it("resumes an existing run and retries an uncertain step with the same operation ID", async () => {
    const bodies: ReturnType<typeof evidencePurgeChunkCreateSchema.parse>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, options?: RequestInit) => {
        if (options?.method === "POST") {
          bodies.push(evidencePurgeChunkCreateSchema.parse(JSON.parse(String(options.body))));
          return json({ error: { code: "UNAVAILABLE", message: "Temporary failure" } }, 503);
        }
        return json(
          String(input).endsWith("/evidence") ? { ...preview(), activeRunId: runId, blockers: ["active_run"] } : run(),
        );
      }),
    );
    await mount();
    await click("Continue removal");
    await click("Continue removal");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(host.textContent).toContain("Temporary failure");
  });
  it("keeps read-only users from reviewing or retiring capture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(preview())),
    );
    await mount(false);
    expect(host.textContent).not.toContain("Review current evidence");
    expect(host.textContent).not.toContain("Retire capture and start removal");
  });
  it("preserves an unacknowledged step request across a status refresh", async () => {
    const bodies: ReturnType<typeof evidencePurgeChunkCreateSchema.parse>[] = [];
    let committed = false;
    let acknowledged = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, options?: RequestInit) => {
        if (options?.method === "POST") {
          bodies.push(evidencePurgeChunkCreateSchema.parse(JSON.parse(String(options.body))));
          if (!committed) {
            committed = true;
            return json({ error: { code: "UNAVAILABLE", message: "Acknowledgement lost" } }, 503);
          }
          acknowledged = true;
          return json({
            success: true,
            runId,
            ordinal: 1,
            phase: "aggregates",
            sourceGenerationBefore: 3,
            sourceGenerationAfter: 3,
            rowCount: 1,
            committedAt: at,
          });
        }
        return json(
          String(input).endsWith("/evidence")
            ? { ...preview(), activeRunId: runId, blockers: ["active_run"] }
            : {
                ...run(),
                ordinal: committed ? 1 : 0,
                status: acknowledged ? "complete" : "running",
                phase: acknowledged ? "complete" : "aggregates",
                completedAt: acknowledged ? at : null,
              },
        );
      }),
    );
    await mount();
    await click("Continue removal");
    await click("Refresh removal status");
    await click("Continue removal");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1].expectedOrdinal).toBe(0);
    expect(host.textContent).toContain("Raw evidence removal is complete");
  });
  it("bounds continuation to 25 receipted steps and stops at completion", async () => {
    let ordinal = 0;
    const operations = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, options?: RequestInit) => {
        if (options?.method === "POST") {
          const body = evidencePurgeChunkCreateSchema.parse(JSON.parse(String(options.body)));
          expect(body.expectedOrdinal).toBe(ordinal);
          operations.add(body.operationId);
          ordinal++;
          return json({
            success: true,
            runId,
            ordinal,
            phase: "aggregates",
            sourceGenerationBefore: 3,
            sourceGenerationAfter: 3,
            rowCount: 0,
            committedAt: at,
          });
        }
        return json(
          String(input).endsWith("/evidence")
            ? { ...preview(), activeRunId: runId, blockers: ["active_run"] }
            : {
                ...run(),
                ordinal,
                status: ordinal === 26 ? "complete" : "running",
                phase: ordinal === 26 ? "complete" : "aggregates",
                completedAt: ordinal === 26 ? at : null,
              },
        );
      }),
    );
    await mount();
    await click("Continue removal");
    for (let retry = 0; retry < 30 && ordinal < 25; retry++) await settle();
    expect(ordinal).toBe(25);
    expect(operations.size).toBe(25);
    await click("Continue removal");
    expect(ordinal).toBe(26);
    expect(host.textContent).toContain("Raw evidence removal is complete");
    expect(host.textContent).not.toContain("Continue removal");
  });
});
