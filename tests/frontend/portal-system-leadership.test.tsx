// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { Leadership } from "../../assets/ts/member-flows/portal/sections/leadership/Leadership";

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal System leadership", () => {
  it("uses only canonical System endpoints and keeps grant/revoke controls capability-derived", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.includes("/leadership/positions")) {
          const positions =
            url.searchParams.get("body") === "board" && url.searchParams.get("status") === "current"
              ? [
                  {
                    id: "00000000-0000-4000-8000-000000000001",
                    body: "board",
                    userId: "00000000-0000-4000-8000-000000000002",
                    identityId: null,
                    organizationName: null,
                    name: "Ada Lovelace",
                    email: "ada@example.test",
                    title: "Board Chair",
                    startsAt: "2026-01-01",
                    endsAt: null,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ]
              : [];
          return json({ positions, page: { limit: 25, offset: 0, total: positions.length, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<Leadership canGrant={false} canRevoke />, container));
    await settle();

    expect(container.textContent).toContain("Board of Directors");
    expect(container.textContent).toContain("Executive Council");
    expect(container.textContent).toContain("Ada Lovelace");
    const rowActionsTrigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(rowActionsTrigger).toBeTruthy();
    void act(() => rowActionsTrigger!.click());
    expect(container.textContent).toContain("Remove position");
    expect(container.textContent).not.toContain("Edit position");
    expect(container.textContent).not.toContain("Add");
    expect(container.textContent).not.toContain("Group leadership");
    expect(paths.some((path) => path.startsWith("/api/v1/groups"))).toBe(false);
    expect(paths.every((path) => path.startsWith("/api/v1/leadership/positions"))).toBe(true);
    expect(paths.some((path) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("only deletes a position through the confirm dialog when the removal is confirmed", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    const positionId = "00000000-0000-4000-8000-000000000001";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, pathname: url.pathname });
        if (url.pathname.includes("/leadership/positions")) {
          if (method === "DELETE") return json({ success: true });
          const positions =
            url.searchParams.get("body") === "board" && url.searchParams.get("status") === "current"
              ? [
                  {
                    id: positionId,
                    body: "board",
                    userId: "00000000-0000-4000-8000-000000000002",
                    identityId: null,
                    organizationName: null,
                    name: "Ada Lovelace",
                    email: "ada@example.test",
                    title: "Board Chair",
                    startsAt: "2026-01-01",
                    endsAt: null,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ]
              : [];
          return json({ positions, page: { limit: 25, offset: 0, total: positions.length, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <Leadership canGrant={false} canRevoke />
        </>,
        container,
      ),
    );
    await settle();

    function openRowMenuAndSelectRemove() {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      void act(() => trigger.click());
      void act(() => dialogButton(container, "Remove position").click());
    }

    // Cancel: the row menu's "Remove position" opens the confirm dialog, but
    // dismissing it must not delete the position.
    openRowMenuAndSelectRemove();
    expect(container.textContent).toContain("Remove Ada Lovelace (Board Chair)?");
    void act(() => dialogButton(container, "Cancel").click());
    await settle();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);

    // Confirm: clicking the dialog's own "Remove position" button deletes it
    // through the canonical route.
    openRowMenuAndSelectRemove();
    void act(() => dialogButton(container, "Remove position").click());
    await settle();
    const deleteRequest = requests.find((r) => r.method === "DELETE");
    expect(deleteRequest?.pathname).toBe(`/api/v1/leadership/positions/${positionId}`);
  });
});
