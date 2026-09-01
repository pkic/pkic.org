// @vitest-environment jsdom
/**
 * The retention queue's presentation: what the table is called, what its
 * cells are allowed to say, and what the surface does when the query fails.
 * Its paging behaviour is covered by the offset-pagination suite.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import { retentionDueListResponseSchema } from "../../assets/shared/schemas/retention";
import type { PendingWorkRow } from "../../assets/shared/schemas/pending-work";
import { RetentionDueTable } from "../../assets/ts/member-flows/portal/sections/system-operations/RetentionDueTable";

let container: HTMLDivElement | null = null;

const ROW: PendingWorkRow = {
  typeLabel: "Event",
  title: "Spring Summit",
  context: "spring-summit-2026",
  subtitle: "412 registrations",
  detail: "Redact 90 days after the event ends",
  dueAt: "2026-05-01T00:00:00.000Z",
  statusKey: "due",
  statusLabel: "Due",
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<RetentionDueTable />, container!);
    await Promise.resolve();
  });
  await settle();
  return container;
}

function respondWith(response: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response())),
  );
}

/** Built through the shared response contract, so the fixture cannot drift
 *  from what the endpoint is actually allowed to return. */
function ok(items: PendingWorkRow[]): Response {
  const body = retentionDueListResponseSchema.parse({
    items,
    page: buildPageInfo(25, 0, items.length, items.length),
  });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("RetentionDueTable", () => {
  it("names the table, so it is not one of several announced only as 'table'", async () => {
    respondWith(() => ok([ROW]));
    const root = await mount();

    const caption = root.querySelector("caption");
    expect(caption?.textContent).toBe("Events due for retention redaction");
  });

  it("dresses its cells with design-system utilities only", async () => {
    respondWith(() => ok([ROW]));
    const root = await mount();

    const slug = [...root.querySelectorAll<HTMLElement>("span")].find(
      (element) => element.textContent === "spring-summit-2026",
    );
    expect(slug?.className).toBe("pk-mono pk-small");

    for (const cell of root.querySelectorAll<HTMLTableCellElement>("tbody td")) {
      for (const name of cell.classList) {
        expect(name.startsWith("pk-")).toBe(true);
      }
    }
  });

  it("explains an empty queue rather than showing a bare table", async () => {
    respondWith(() => ok([]));
    const root = await mount();

    expect(root.textContent).toContain("Nothing is due for retention redaction.");
  });

  it("states the failure when the retention query does not come back", async () => {
    respondWith(
      () =>
        new Response(JSON.stringify({ error: { code: "server_error", message: "HTTP 500" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const root = await mount();

    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // The raw transport phrasing never reaches the reader.
    expect(alert?.textContent).toContain("Something went wrong on our side.");
  });
});
