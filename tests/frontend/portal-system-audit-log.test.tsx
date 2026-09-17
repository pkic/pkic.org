// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemAuditLog } from "../../assets/ts/member-flows/portal/sections/SystemAuditLog";
import { chooseColumnFilter, columnFilterOptions, columnFilterSummary } from "./helpers/column-menu";

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
        if (url.pathname.endsWith("/filters")) {
          const value = url.searchParams.get("field") === "action" ? "catalog_reconciled" : "custom_interest";
          return json({
            options: [{ value, label: value.replace(/_/g, " ") }],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
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

    // The table names itself, so a page carrying several is not announced as
    // several tables all called "table".
    expect(container.querySelector("table caption")?.textContent).toBe("System audit log");

    // The filters are the columns' own (#123): no loose inputs and no
    // Apply/Clear pair in the toolbar — the toolbar holds the search alone.
    expect(container.querySelector('form[aria-label="Audit log filters"]')).toBeNull();
    expect([...container.querySelectorAll("button")].map((control) => control.textContent?.trim())).not.toContain(
      "Apply",
    );

    // Who acted is a closed vocabulary, offered as choices.
    expect(columnFilterOptions(container, "Actor")).toEqual(["All actors", "Admin", "Member", "User", "System"]);
    await chooseColumnFilter(container, "Actor", "System");
    await settle();
    expect(columnFilterSummary(container, "Actor")).toBe("System");
    expect(requests.at(-1)?.searchParams.get("actorType")).toBe("system");

    // Choices come from the server, including values absent from the loaded rows.
    await chooseColumnFilter(container, "Entity", "custom interest");
    await settle();
    expect(requests.at(-1)?.searchParams.get("entityType")).toBe("custom_interest");
    expect(requests.at(-1)?.searchParams.get("actorType")).toBe("system");
    await chooseColumnFilter(container, "Action", "catalog reconciled");
    await settle();
    expect(requests.at(-1)?.searchParams.get("action")).toBe("catalog_reconciled");
    expect(requests.at(-1)?.searchParams.get("entityType")).toBe("custom_interest");
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
