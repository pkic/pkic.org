// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemAuditLog } from "../../assets/ts/member-flows/portal/sections/SystemAuditLog";

let container: HTMLElement | null = null;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("portal system audit log", () => {
  it("loads a schema-validated server page from the canonical domain API", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json({
          entries: [
            {
              id: "audit-1",
              actor_type: "admin",
              actor_id: "user-1",
              actor_display: "Audit Manager",
              action: "system_setting_updated",
              entity_type: "system_setting",
              entity_id: "setting-1",
              details: { field: "label" },
              created_at: "2026-08-27T12:00:00.000Z",
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<SystemAuditLog />, container!));
    await settle();

    expect(container.textContent).toContain("Audit Manager");
    expect(container.textContent).toContain("system_setting_updated");
    expect(container.textContent).toContain("Field");
    expect(container.textContent).toContain("label");
    expect(container.querySelector("pre")).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/audit-log");
    expect(requests[0]?.searchParams.get("limit")).toBe("50");
    expect(requests[0]?.searchParams.get("offset")).toBe("0");
    expect(requests[0]?.searchParams.get("sort")).toBeNull();
    expect(requests[0]?.pathname.startsWith("/api/v1/admin/")).toBe(false);
    expect(requests[0]?.pathname.startsWith("/api/v1/system/audit-log")).toBe(false);

    // The filters share the toolbar row, so — like the FilterSelects beside
    // them on every other list — each carries its accessible name in
    // `aria-label`. Resolving the control through that name fails exactly
    // when the labelling is broken, which is the part worth asserting.
    const filterByName = (name: string): HTMLInputElement => {
      const match = container!.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
      if (!match) throw new Error(`no filter is named "${name}"`);
      return match;
    };
    const entityType = filterByName("Entity type");
    const actorType = filterByName("Actor type");
    const action = filterByName("Action");
    const form = entityType.form;
    expect(form).not.toBeNull();
    expect(form?.getAttribute("aria-label")).toBe("Audit log filters");

    // The table names itself, so a page carrying several is not announced as
    // several tables all called "table".
    expect(container.querySelector("table caption")?.textContent).toBe("System audit log");

    entityType.value = "custom_interest";
    actorType.value = "automation";
    action.value = "catalog_reconciled";
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[1]?.searchParams.get("entityType")).toBe("custom_interest");
    expect(requests[1]?.searchParams.get("actorType")).toBe("automation");
    expect(requests[1]?.searchParams.get("action")).toBe("catalog_reconciled");
  });

  it("announces a failed load as an alert rather than an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream exploded", { status: 500 }))),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<SystemAuditLog />, container!));
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    // The empty-state sentence would claim the filters matched nothing, which
    // is a different and wrong thing to tell a reader about a failed request.
    expect(container.textContent).not.toContain("No entries match the current filters.");
  });
});
