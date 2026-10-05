// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attendanceEvidenceSchema,
  attendanceEvidenceQuerySchema,
  attendanceEvidenceResponseSchema,
  attendanceCorrectionRequestSchema,
  attendanceCorrectionSchema,
  attendanceCorrectionHistoryResponseSchema,
} from "../../assets/shared/schemas/event-attendance-corrections";
import { AttendanceEvidence } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceEvidence";

const occurrenceId = "11111111-1111-4111-8111-111111111111";
const nextOccurrenceId = "22222222-2222-4222-8222-222222222222";
const instant = "2026-12-01T10:00:00.000Z";
const observation = attendanceEvidenceSchema.parse({
  id: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
  displayName: "Original attendee",
  occurrenceId,
  observedAt: instant,
  receivedAt: "2026-12-01T10:01:00.000Z",
  operatorUserId: "55555555-5555-4555-8555-555555555555",
  deviceId: "66666666-6666-4666-8666-666666666666",
  source: "browser_scan",
  action: "attendance",
  deviceTimeVerified: false,
  captureContext: {
    state: "captured",
    dayDate: "2026-12-01",
    timeZone: "UTC",
    publicationRevision: 13,
    source: "published_manifest",
  },
  revision: 0,
  voided: false,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
});
async function mount(id: string, changed = vi.fn()) {
  host ??= document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(<AttendanceEvidence slug="pilot" occurrenceId={id} timeZone="UTC" canCorrect onChanged={changed} />, host!),
  );
}
function button(label: string) {
  const control = [...host!.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!control) throw new Error(`Missing ${label} control`);
  return control;
}

describe("real attendance evidence collection transport", () => {
  it("preserves the canonical occurrence filter with pagination/sort and when changing session", async () => {
    const queries: ReturnType<typeof attendanceEvidenceQuerySchema.parse>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "https://pkic.test");
        expect(url.pathname).toBe("/api/v1/events/pilot/attendance/observations");
        const query = attendanceEvidenceQuerySchema.parse(Object.fromEntries(url.searchParams));
        queries.push(query);
        return json(
          attendanceEvidenceResponseSchema.parse({
            observations: [
              {
                ...observation,
                occurrenceId: query.occurrenceId,
                displayName: query.occurrenceId === occurrenceId ? "Original attendee" : "Next attendee",
              },
            ],
            page: { limit: query.limit, offset: query.offset, total: 1, hasMore: false },
            retentionPolicy: "retained_with_original_observation",
          }),
        );
      }),
    );
    await mount(occurrenceId);
    await vi.waitFor(() => expect(host!.textContent).toContain("Original attendee"));
    expect(queries[0]).toMatchObject({ occurrenceId, offset: 0, sort: "-observedAt" });
    expect(queries[0]!.limit).toBeGreaterThan(0);
    expect(button("Review observation")).toBeDefined();
    await mount(nextOccurrenceId);
    await vi.waitFor(() => expect(host!.textContent).toContain("Next attendee"));
    expect(queries.at(-1)).toMatchObject({ occurrenceId: nextOccurrenceId, offset: 0, sort: "-observedAt" });
    expect(host!.textContent).not.toContain("Original attendee");
  });

  it("opens actual evidence review and keeps the occurrence scope after a canonical correction reload", async () => {
    const changed = vi.fn();
    let current = observation;
    const queries: ReturnType<typeof attendanceEvidenceQuerySchema.parse>[] = [];
    const corrections: ReturnType<typeof attendanceCorrectionSchema.parse>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "https://pkic.test");
        const path = `/api/v1/events/pilot/attendance/observations/${observation.id}/corrections`;
        if (url.pathname === path && init?.method === "POST") {
          const body = attendanceCorrectionRequestSchema.parse(JSON.parse(String(init.body)));
          expect(body).toMatchObject({ expectedRevision: 0, kind: "void", reasonCode: "operator_error" });
          const { expectedRevision, ...receiptFields } = body;
          const correction = attendanceCorrectionSchema.parse({
            ...receiptFields,
            id: "77777777-7777-4777-8777-777777777777",
            observationId: observation.id,
            actorUserId: observation.operatorUserId,
            revision: expectedRevision + 1,
            createdAt: "2026-12-01T10:02:00.000Z",
          });
          corrections.push(correction);
          current = { ...current, revision: 1, voided: true };
          return json(correction);
        }
        if (url.pathname === path)
          return json(
            attendanceCorrectionHistoryResponseSchema.parse({
              corrections,
              page: { limit: 25, offset: 0, total: corrections.length, hasMore: false },
            }),
          );
        expect(url.pathname).toBe("/api/v1/events/pilot/attendance/observations");
        const query = attendanceEvidenceQuerySchema.parse(Object.fromEntries(url.searchParams));
        expect(query.occurrenceId).toBe(occurrenceId);
        queries.push(query);
        return json(
          attendanceEvidenceResponseSchema.parse({
            observations: [current],
            page: { limit: query.limit, offset: query.offset, total: 1, hasMore: false },
            retentionPolicy: "retained_with_original_observation",
          }),
        );
      }),
    );
    await mount(occurrenceId, changed);
    await vi.waitFor(() => expect(host!.textContent).toContain("Original attendee"));
    await act(() => button("Review observation").click());
    await vi.waitFor(() => expect(button("Exclude observation from attendance")).toBeDefined());
    const correctionForm = button("Exclude observation from attendance").closest("form");
    expect(correctionForm?.noValidate).toBe(true);
    await act(async () => {
      correctionForm!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(host!.textContent).toContain("Excluded by correction"));
    expect(changed).toHaveBeenCalledOnce();
    expect(corrections).toHaveLength(1);
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.every((query) => query.occurrenceId === occurrenceId)).toBe(true);
  });
});
