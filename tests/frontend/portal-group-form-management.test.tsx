// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupFormDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupFormDetail";
import { GroupFormEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupFormEditor";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_GROUP_ID = "10000000-0000-4000-8000-000000000002";
const FORM_ID = "80000000-0000-4000-8000-000000000001";
const PLACEMENT_ID = "80000000-0000-4000-8000-000000000002";
const FIELD_ID = "80000000-0000-4000-8000-000000000003";
const NOW = "2026-08-01T00:00:00.000Z";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(element: HTMLInputElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function detail(ownerGroupId: string, capabilities: string[]) {
  return {
    form: {
      id: FORM_ID,
      key: "architecture-survey",
      purpose: "survey",
      status: "active",
      title: "Architecture survey",
      description: "Collect priorities.",
      updatedAt: NOW,
    },
    placement: {
      id: PLACEMENT_ID,
      formId: FORM_ID,
      ownerGroupId,
      contextType: "group",
      contextRef: ownerGroupId,
      audience: "group_members",
      active: true,
      opensAt: null,
      closesAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    capabilities,
    acceptingResponses: true,
    fields: [
      {
        id: FIELD_ID,
        key: "priority",
        label: "Priority",
        fieldType: "text",
        required: true,
        options: null,
        optionSource: null,
        validation: null,
        sortOrder: 10,
        updatedAt: NOW,
        archivedAt: null,
      },
    ],
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group form management", () => {
  it("creates a path-owned group form with the shared authoring schema", async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path: url.pathname, method: init.method ?? "GET", body });
        return json({ success: true, ...detail(GROUP_ID, ["view_definition", "submit", "manage"]) }, 201);
      }),
    );

    const container = mount(
      <GroupFormEditor groupId={GROUP_ID} detail={null} onSaved={() => undefined} onCancel={() => undefined} />,
    );
    await settle();
    setValue(container.querySelector<HTMLInputElement>("input.mono:not(.adm-fkey-input)")!, "member-survey");
    await settle();
    setValue(container.querySelector<HTMLInputElement>(".col-md-4 input")!, "Member survey");
    await settle();
    setValue(container.querySelector<HTMLInputElement>(".adm-fkey-input")!, "priority");
    await settle();
    setValue(container.querySelector<HTMLInputElement>(".adm-flabel-input")!, "Priority");
    await settle();
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests, container.textContent ?? "").toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: `/api/v1/groups/${GROUP_ID}/forms`, method: "POST" });
    expect(requests[0].body).toMatchObject({ key: "member-survey", purpose: "survey", title: "Member survey" });
    expect(requests[0].body).not.toHaveProperty("ownerGroupId");
  });

  it("does not expose owner definition editing through a shared placement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(OTHER_GROUP_ID, ["view_definition", "manage"]))),
    );
    const container = mount(
      <GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={() => undefined} />,
    );
    await settle();

    expect(container.textContent).toContain("Save availability");
    expect(container.textContent).not.toContain("Edit form");
    expect(container.querySelector(".adm-fkey-input")).toBeNull();
  });

  it("uses placement-isolated backend statistics and paginated response endpoints", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/submissions/stats")) {
          return json({
            form: detail(GROUP_ID, []).form,
            placement: detail(GROUP_ID, []).placement,
            total: 0,
            stats: [],
          });
        }
        if (url.pathname.endsWith("/submissions")) {
          return json({
            form: detail(GROUP_ID, []).form,
            placement: detail(GROUP_ID, []).placement,
            submissions: [],
            page: { limit: 50, offset: 0, total: 0, hasMore: false },
          });
        }
        return json(detail(GROUP_ID, ["view_definition", "submit", "view_responses"]));
      }),
    );

    const container = mount(
      <GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={() => undefined} />,
    );
    await settle();
    await settle();
    expect(requests.some((url) => url.pathname.endsWith("/submissions/stats"))).toBe(false);

    const statisticsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Statistics",
    )!;
    await act(async () => statisticsTab.click());
    await settle();
    expect(container.textContent).toContain("No responses yet.");

    const responsesTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Responses",
    )!;
    await act(async () => responsesTab.click());
    await settle();

    expect(requests.some((url) => url.pathname.endsWith(`/${PLACEMENT_ID}/submissions/stats`))).toBe(true);
    const listRequest = requests.find((url) => url.pathname.endsWith(`/${PLACEMENT_ID}/submissions`));
    expect(listRequest?.searchParams.get("limit")).toBe("50");
    expect(listRequest?.searchParams.get("sort")).toBe("-submitted_at");
  });
});
