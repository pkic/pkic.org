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

    const entityType = container.querySelector<HTMLInputElement>("#system-audit-entityType");
    const actorType = container.querySelector<HTMLInputElement>("#system-audit-actorType");
    const action = container.querySelector<HTMLInputElement>("#system-audit-action");
    const form = entityType?.form;
    expect(entityType).not.toBeNull();
    expect(actorType).not.toBeNull();
    expect(action).not.toBeNull();
    expect(form).not.toBeNull();

    entityType!.value = "custom_interest";
    actorType!.value = "automation";
    action!.value = "catalog_reconciled";
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[1]?.searchParams.get("entityType")).toBe("custom_interest");
    expect(requests[1]?.searchParams.get("actorType")).toBe("automation");
    expect(requests[1]?.searchParams.get("action")).toBe("catalog_reconciled");
  });
});
