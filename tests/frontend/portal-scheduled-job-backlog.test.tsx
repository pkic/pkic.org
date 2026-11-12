// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduledJobBacklog } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledJobBacklog";
import type { SchedulerJobBacklogItem } from "../../assets/shared/schemas/scheduler";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

let container: HTMLDivElement | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function item(overrides: Partial<SchedulerJobBacklogItem>): SchedulerJobBacklogItem {
  return {
    id: "file:render-1",
    retryable: false,
    typeLabel: "File",
    title: "Ada Example",
    subtitle: "Example Conference",
    context: "Attendee kit · Carousel",
    detail: null,
    dueAt: "2026-09-01T00:00:00.000Z",
    statusKey: "retrying",
    statusLabel: "Retrying",
    ...overrides,
  };
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

it("retries a waiting file from its row and reloads the backlog", async () => {
  history.replaceState({}, "", "/portal/#/settings/scheduled-jobs/promotion_rendering");
  const requests: string[] = [];
  let retried = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      requests.push(`${init.method ?? "GET"} ${url.pathname}`);
      if (init.method === "POST") {
        retried = true;
        return json({ success: true, finished: true, error: null });
      }
      const items = retried
        ? [item({ id: "email:batch-1::user-1", typeLabel: "Email", statusLabel: "Waiting for files" })]
        : [
            item({ retryable: true }),
            item({ id: "email:batch-1::user-1", typeLabel: "Email", statusLabel: "Waiting for files" }),
          ];
      return json({ items, page: { limit: 25, offset: 0, total: items.length, hasMore: false } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  await act(() => render(<ScheduledJobBacklog jobKey="promotion_rendering" />, container!));
  await settle();

  // Only the retryable file offers the action; the email waits for it.
  expect(rowActionControlNames(container)).toHaveLength(1);
  await runRowAction(container, "Ada Example, Attendee kit · Carousel", "Retry now");
  await settle();

  expect(requests).toContain(
    `POST /api/v1/scheduler/jobs/promotion_rendering/backlog/${encodeURIComponent("file:render-1")}/retries`,
  );
  expect(requests.filter((request) => request.startsWith("GET"))).toHaveLength(2);
  await vi.waitFor(() => expect(rowActionControlNames(container!)).toEqual([]));
  expect(container.textContent).not.toContain("Retrying");
});
