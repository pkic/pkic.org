import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgendaDeliveryStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaDeliveryStatus";
import { sitePublicationRequestListSchema } from "../../assets/shared/schemas/site-publication-requests";
const now = "2026-10-05T00:00:00.000Z";
function response(withdrawal: boolean, completed = false) {
  return sitePublicationRequestListSchema.parse({
    requests: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        sequence: 1,
        resourceType: "event_agenda",
        resourceId: "e".repeat(32),
        revision: 1,
        reasonCode: withdrawal ? "rights_withdrawn" : "agenda_approved",
        deduplicationKey: "synthetic:1",
        documentEffects: withdrawal
          ? [
              {
                eventId: "e".repeat(32),
                eventSlug: "synthetic",
                occurrenceId: "c".repeat(32),
                materialId: "pdf",
                versionId: "d".repeat(32),
                digest: "a".repeat(64),
                grantId: "b".repeat(64),
              },
            ]
          : [],
        documentEffectsCompletedAt: completed ? now : null,
        status: completed ? "delivered" : "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: withdrawal && !completed ? "PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE" : null,
        lastErrorAt: withdrawal && !completed ? now : null,
        sourceSequence: null,
        snapshotId: null,
        buildId: null,
        releaseId: null,
      },
    ],
    page: { limit: 1, offset: 0, total: 1, hasMore: false },
  });
}
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
it("shows pending withdrawal in plain language and refreshes to verified publication", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(response(true)))
    .mockResolvedValueOnce(Response.json(response(true, true)));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => {
    render(<AgendaDeliveryStatus slug="synthetic" revision={1} />, host);
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Public download withdrawal is pending; retry will continue"),
  );
  expect(host.textContent).not.toContain("PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE");
  expect(host.textContent).not.toContain("Website update published");
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe("Refresh delivery status");
  await act(async () => {
    button.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Website update published"));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("preserves ordinary queued update wording when there are no withdrawal effects", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response(false))));
  await act(async () => {
    render(<AgendaDeliveryStatus slug="synthetic" revision={1} />, host);
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Website update queued"));
  expect(host.textContent).not.toContain("withdrawal");
});
