// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupFormDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupFormDetail";
import { GroupFormEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupFormEditor";
import { isCurrentTab, tabs } from "./helpers/tabs";
import { fillQuestion, nameForm } from "./helpers/form-editor";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

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

/** The per-field row names its controls with aria-label, not a visible label. */

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
  navigate.mockReset();
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
    await nameForm(container, "Member survey", "member-survey");
    await settle();
    await fillQuestion(container, "Priority", "priority");
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

    expect(container.querySelector('button[aria-label="Form availability actions"]')).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("Edit form");
    // No editor is mounted at all, so it asks nothing.
    expect(container.querySelector('input[placeholder="What are you asking?"]')).toBeNull();
  });

  it("does not fetch statistics for the default respond tab", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json(detail(GROUP_ID, ["view_definition", "submit", "view_responses"]));
      }),
    );

    mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={() => undefined} />);
    await settle();
    await settle();

    expect(requests.some((url) => url.pathname.endsWith("/submissions/stats"))).toBe(false);
  });

  it("requests placement-isolated statistics and paginated responses for their URL-addressed tabs", async () => {
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

    const statsContainer = mount(
      <GroupFormDetail
        groupId={GROUP_ID}
        placementId={PLACEMENT_ID}
        initialTab="statistics"
        onChanged={() => undefined}
      />,
    );
    await settle();
    await settle();
    expect(statsContainer.textContent).toContain("No responses yet.");
    expect(requests.some((url) => url.pathname.endsWith(`/${PLACEMENT_ID}/submissions/stats`))).toBe(true);

    mount(
      <GroupFormDetail
        groupId={GROUP_ID}
        placementId={PLACEMENT_ID}
        initialTab="responses"
        onChanged={() => undefined}
      />,
    );
    await settle();
    await settle();

    const listRequest = requests.find((url) => url.pathname.endsWith(`/${PLACEMENT_ID}/submissions`));
    expect(listRequest?.searchParams.get("limit")).toBe("50");
    expect(listRequest?.searchParams.get("sort")).toBe("-submitted_at");
  });

  it("names the form panel and its tab strip, and points the tabs at real URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(GROUP_ID, ["view_definition", "manage", "view_responses", "submit"]))),
    );
    const container = mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={vi.fn()} />);
    await settle();

    // The panel is labelled by the heading that names the form, so the row it
    // expands inside is not an unnamed region among the others.
    const panel = container.querySelector("header[aria-labelledby]")!;
    const headingId = panel.getAttribute("aria-labelledby")!;
    expect(container.querySelector(`[id="${headingId}"]`)?.textContent).toContain("Architecture survey");

    // The strip says which set of tabs it is; a page can hold several.
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Architecture survey sections");
    expect(tabs(container).length).toBeGreaterThan(1);
  });

  it("says a form could not be loaded instead of rendering an empty shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "This form is no longer placed." } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const container = mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={vi.fn()} />);
    await settle();

    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("This form is no longer placed.");
  });

  it("explains a form nothing can be done with rather than showing a bare strip", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ...detail(GROUP_ID, ["view_definition"]), acceptingResponses: false })),
    );
    const container = mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={vi.fn()} />);
    await settle();

    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("No actions are available for this form.");
  });

  it("tells a submitter when a form opens instead of hiding it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = detail(GROUP_ID, ["view_definition", "submit", "view_responses"]);
        return json({
          ...body,
          placement: { ...body.placement, opensAt: "2099-03-04T08:00:00.000Z" },
          acceptingResponses: false,
        });
      }),
    );
    const container = mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={vi.fn()} />);
    await settle();

    // The tab is still theirs — they hold the capability — and it explains
    // itself rather than disappearing without a reason.
    expect(tabs(container).map((tab) => tab.textContent)).toContain("Respond");
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("This form is not open yet");
    // The window is transported in UTC and shown on the reader's clock, so the
    // sentence must not simply echo the stored instant back at them.
    expect(status.textContent).not.toContain("2099-03-04T08:00:00.000Z");
    expect(status.textContent).toContain(
      new Date("2099-03-04T08:00:00.000Z").toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
    );
    // No questions are offered while the window is shut.
    expect(container.querySelector("form")).toBeNull();
  });

  it("tells a submitter when a form closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = detail(GROUP_ID, ["view_definition", "submit"]);
        return json({
          ...body,
          placement: { ...body.placement, opensAt: "2020-01-01T00:00:00.000Z", closesAt: "2020-02-01T17:00:00.000Z" },
          acceptingResponses: false,
        });
      }),
    );
    const container = mount(<GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={vi.fn()} />);
    await settle();

    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("This form is closed");
    expect(status.textContent).toContain(
      new Date("2020-02-01T17:00:00.000Z").toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
    );
  });

  it("opens the tab given by an initial resourceTab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(GROUP_ID, ["view_definition", "submit", "view_responses"]))),
    );

    const container = mount(
      <GroupFormDetail
        groupId={GROUP_ID}
        placementId={PLACEMENT_ID}
        initialTab="responses"
        onChanged={() => undefined}
      />,
    );
    await settle();

    const responsesTab = tabs(container).find((item) => item.textContent === "Responses");
    expect(isCurrentTab(responsesTab)).toBe(true);
  });

  it("navigates to the canonical placement tab URL when a tab is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail(GROUP_ID, ["view_definition", "submit", "view_responses"]))),
    );

    const container = mount(
      <GroupFormDetail groupId={GROUP_ID} placementId={PLACEMENT_ID} onChanged={() => undefined} />,
    );
    await settle();

    const statisticsTab = tabs(container).find((item) => item.textContent === "Statistics")!;
    expect(statisticsTab.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/forms/${PLACEMENT_ID}/statistics`);

    await act(async () => statisticsTab.click());
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms/${PLACEMENT_ID}/statistics`);
  });
});
