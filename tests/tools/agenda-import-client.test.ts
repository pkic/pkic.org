import { describe, expect, it, vi } from "vitest";
import { importPreparedAgenda } from "../../scripts/lib/agenda-import-client.mjs";
import {
  agendaTransferSchema,
  transferApplySchema,
  transferPrepareSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
const document = agendaTransferSchema.parse({
  format: "pkic-agenda",
  version: 1,
  source: {
    kind: "portable",
    eventRef: "source-event",
    exportedAt: "2026-10-04T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
  },
  people: [],
  rooms: [],
  occurrences: [],
});
const snapshot = (revision: number) => ({
  eventSlug: "destination",
  timeZone: "UTC",
  revision,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
const review = { digest: "b".repeat(64), expectedRevision: 7, findings: [], ready: true, imported: 0, skipped: 0 };
function transport(responses: unknown[]) {
  return vi.fn<typeof fetch>(async () => Response.json(responses.shift()));
}
const options = {
  baseUrl: "https://example.test",
  eventSlug: "destination",
  token: "private-token",
  documents: [document],
};
describe("Authenticated agenda importer", () => {
  it("defaults to review only and validates its canonical request without conflating source and destination", async () => {
    const fetcher = transport([snapshot(7), review]);
    const result = await importPreparedAgenda({ ...options, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result[0].applied).toBe(false);
    const [url, request] = fetcher.mock.calls[1];
    expect(url).toBe("https://example.test/api/v1/events/destination/agenda/transfers/reviews");
    expect(transferPrepareSchema.parse(JSON.parse(String(request?.body)))).toMatchObject({
      expectedRevision: 7,
      mode: "archive",
      document,
    });
    expect(request?.redirect).toBe("error");
  });
  it("refreshes revision for every applied part and forwards explicit decisions", async () => {
    const fetcher = transport([
      snapshot(7),
      review,
      { agenda: snapshot(8), imported: 0, skipped: 0 },
      snapshot(9),
      { ...review, expectedRevision: 9 },
      { agenda: snapshot(10), imported: 0, skipped: 0 },
    ]);
    await importPreparedAgenda({
      ...options,
      documents: [document, document],
      apply: true,
      mode: "copy_as_new",
      fetcher,
    });
    const first = transferApplySchema.parse(JSON.parse(String(fetcher.mock.calls[2][1]?.body)));
    const second = transferApplySchema.parse(JSON.parse(String(fetcher.mock.calls[5][1]?.body)));
    expect(first).toMatchObject({ expectedRevision: 7, reviewDigest: review.digest, mode: "copy_as_new" });
    expect(second.expectedRevision).toBe(9);
  });
  it("reports grouped findings without personal data and refuses unresolved import", async () => {
    const onSummary = vi.fn();
    const fetcher = transport([
      snapshot(7),
      {
        ...review,
        ready: false,
        findings: [
          {
            rowRef: "private-person",
            field: "private-label",
            code: "person_unresolved",
            severity: "blocking",
            message: "private-person@example.test",
          },
        ],
      },
    ]);
    await expect(importPreparedAgenda({ ...options, apply: true, fetcher, onSummary })).rejects.toThrow(
      "unresolved blocking",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onSummary.mock.calls)).not.toContain("private-person");
    expect(onSummary.mock.calls[0][0].findings).toEqual([
      { code: "person_unresolved", severity: "blocking", count: 1 },
    ]);
  });
  it("requires explicit timing acknowledgement and stops on stale apply without retries or error-body disclosure", async () => {
    const inferred = {
      ...review,
      findings: [{ rowRef: "row", field: "timing", code: "timing_inferred", severity: "review", message: "sensitive" }],
    };
    const fetcher = transport([snapshot(7), inferred]);
    await expect(importPreparedAgenda({ ...options, apply: true, fetcher })).rejects.toThrow(
      "--acknowledge-inferred-timing",
    );
    const stale = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot(7)))
      .mockResolvedValueOnce(Response.json(review))
      .mockResolvedValueOnce(
        Response.json(
          { code: "AGENDA_REVISION_CONFLICT", message: "private-token", people: ["private"] },
          { status: 409 },
        ),
      );
    await expect(importPreparedAgenda({ ...options, apply: true, fetcher: stale })).rejects.toThrow(
      "HTTP 409 AGENDA_REVISION_CONFLICT",
    );
    expect(stale).toHaveBeenCalledTimes(3);
  });
  it("requires explicit local-edit decisions and forwards them without inferring an overwrite", async () => {
    const local = {
      ...review,
      findings: [
        { rowRef: "authored-row", field: "title", code: "local_edits", severity: "review", message: "private title" },
      ],
    };
    const refused = transport([snapshot(7), local]);
    await expect(importPreparedAgenda({ ...options, apply: true, fetcher: refused })).rejects.toThrow(
      "explicit row decisions",
    );
    const fetcher = transport([snapshot(7), local, { agenda: snapshot(8), imported: 0, skipped: 1 }]);
    await importPreparedAgenda({
      ...options,
      apply: true,
      fetcher,
      resolutions: { people: {}, rooms: {}, media: {}, rows: { "authored-row": "retain_local" } },
    });
    const applied = transferApplySchema.parse(JSON.parse(String(fetcher.mock.calls[2][1]?.body)));
    expect(applied.resolutions.rows).toEqual({ "authored-row": "retain_local" });
  });
  it("rejects redirect-capable or credential-bearing target configuration before any request", async () => {
    const fetcher = transport([]);
    await expect(
      importPreparedAgenda({ ...options, baseUrl: "https://user:secret@example.test", fetcher }),
    ).rejects.toThrow("origin");
    await expect(importPreparedAgenda({ ...options, baseUrl: "http://remote.example.test", fetcher })).rejects.toThrow(
      "HTTPS",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
