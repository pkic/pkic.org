// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Leadership } from "../../assets/ts/admin/sections/access-control/Leadership";

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("global leadership admin", () => {
  it("retains dated Board and Executive Council positions without duplicating group management", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(url.pathname);
        if (url.pathname.includes("/leadership-positions")) {
          return json({ positions: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<Leadership />, container));
    await settle();

    expect(container.textContent).toContain("Board of Directors");
    expect(container.textContent).toContain("Executive Council");
    expect(container.textContent).not.toContain("Group leadership");
    expect(paths.some((path) => path.startsWith("/api/v1/groups"))).toBe(false);
  });
});
