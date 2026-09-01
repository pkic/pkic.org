// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupCategoryRulesEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupCategoryRulesEditor";
import { GroupCreateForm } from "../../assets/ts/member-flows/portal/sections/management/GroupCreateForm";
import { Groups } from "../../assets/ts/member-flows/portal/sections/Groups";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { groupCreateSchema } from "../../assets/shared/schemas/groups";
import { buttonNamed, chooseOption, controlFor, labelNames, submitForm, typeInto } from "./helpers/labelled-control";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mounted: HTMLElement[] = [];

function mountGroupsAt(groupSegment?: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<Groups groupSegment={groupSegment} />, container));
  return container;
}

afterEach(() => {
  portalSession.value = null;
  navigate.mockReset();
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal group creation and category policy", () => {
  it("loads group types and posts the complete canonical group-create contract", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    const created = {
      id: GROUP_ID,
      slug: "security-working-group",
      name: "Security Working Group",
      type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
      parentGroup: null,
      description: "Coordinates security work.",
      links: ["https://example.test/security"],
      visibility: "participants",
      governanceInheritanceMode: "inherited",
      eligibilityMode: "category",
      automaticEnrollmentMode: "none",
      allowAutomaticOptOut: false,
      publicLeadership: true,
      minEndorsersForBallot: 2,
      active: true,
      revision: 0,
      membershipCapacityCount: 0,
      representedMemberCount: 0,
      participantCount: 0,
      childCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === "/api/v1/groups/types") {
          return json({
            groupTypes: [
              {
                key: "working_group",
                singularLabel: "Working Group",
                pluralLabel: "Working Groups",
                description: "A focused group",
                defaultGovernanceInheritanceMode: "inherited",
                defaultEligibilityMode: "managed",
                defaultAutomaticEnrollmentMode: "none",
                defaultAllowAutomaticOptOut: false,
                defaultVisibility: "participants",
                active: true,
                sortOrder: 1,
              },
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/groups/creation-capabilities") return json({ canCreate: true });
        if (url.pathname === "/api/v1/groups" && method === "GET") {
          return json({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === "/api/v1/groups" && method === "POST") return json({ group: created });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const onCreated = vi.fn();
    await act(() => render(<GroupCreateForm onCreated={onCreated} />, container));
    await settle();
    await settle();
    await chooseOption(controlFor<HTMLSelectElement>(container, "Group type"), "working_group");
    await settle();

    // Every editable field is reachable through its own label, and the two
    // policy switches carry the design system's full checkbox triad — a label
    // with only `pk-check` renders an operating-system default control.
    expect(labelNames(container)).toEqual(
      expect.arrayContaining(["Group type", "Parent group (optional)", "Name", "Slug (optional)", "Description"]),
    );
    const switches = [...container.querySelectorAll("label.pk-check")];
    expect(switches).toHaveLength(2);
    for (const control of switches) {
      expect(control.querySelector("input.pk-check__input")).not.toBeNull();
      expect(control.querySelector("span.pk-check__label")?.textContent).toBeTruthy();
    }

    await typeInto(controlFor(container, "Name"), "Security Working Group");
    await typeInto(controlFor<HTMLTextAreaElement>(container, "Description"), "Coordinates security work.");
    await act(async () => buttonNamed(container, "Create group").click());
    await settle();

    const request = requests.find(({ method }) => method === "POST");
    // Parsing through the canonical request schema proves the surface sends
    // the contract rather than a shape that happens to match this assertion.
    expect(groupCreateSchema.parse(request?.body)).toMatchObject({
      typeKey: "working_group",
      name: "Security Working Group",
      description: "Coordinates security work.",
      links: [],
      visibility: "participants",
      eligibilityMode: "managed",
      automaticEnrollmentMode: "none",
    });
    expect(request?.body).not.toHaveProperty("groupId");
    expect(onCreated).toHaveBeenCalledWith(created);
    await act(() => render(null, container));
    container.remove();
  });

  it("states a rejected create in a live region and leaves the form editable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        if (url.pathname === "/api/v1/groups/creation-capabilities") return json({ canCreate: true });
        if (url.pathname === "/api/v1/groups/types") {
          return json({
            groupTypes: [
              {
                key: "working_group",
                singularLabel: "Working Group",
                pluralLabel: "Working Groups",
                description: "A focused group",
                defaultGovernanceInheritanceMode: "inherited",
                defaultEligibilityMode: "managed",
                defaultAutomaticEnrollmentMode: "none",
                defaultAllowAutomaticOptOut: false,
                defaultVisibility: "participants",
                active: true,
                sortOrder: 1,
              },
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/groups" && method === "GET") {
          return json({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "That slug is already taken." } }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const onCreated = vi.fn();
    await act(() => render(<GroupCreateForm onCreated={onCreated} />, container));
    await settle();
    await settle();

    await chooseOption(controlFor<HTMLSelectElement>(container, "Group type"), "working_group");
    await settle();
    await typeInto(controlFor(container, "Name"), "Security Working Group");
    await submitForm(container);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That slug is already taken.");
    expect(onCreated).not.toHaveBeenCalled();
    // The in-flight fieldset is released again, so the reader can correct and
    // resubmit rather than being left with a form nothing can type into.
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
    expect(controlFor(container, "Name").hasAttribute("disabled")).toBe(false);
    await act(() => render(null, container));
    container.remove();
  });

  it("renders nothing at all when the caller may not create a group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ canCreate: false })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupCreateForm onCreated={vi.fn()} />, container));
    await settle();
    expect(container.innerHTML).toBe("");
    await act(() => render(null, container));
    container.remove();
  });

  it("loads the category catalog and round-trips rules with the live revision", async () => {
    const requests: Array<{ method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        if (url.pathname.endsWith("/category-rules") && method === "GET") {
          return json({
            groupId: GROUP_ID,
            revision: 7,
            rules: [{ membershipCategory: "A", permitsJoin: true, automaticEnrollment: false }],
          });
        }
        if (url.pathname === "/api/v1/members/applications/form") {
          return json({
            categories: [
              {
                code: "A",
                label: "Organization member",
                description: null,
                displayOrder: 1,
                isIndividual: false,
                isVoting: true,
                revision: 0,
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
              {
                code: "H5",
                label: "Student",
                description: null,
                displayOrder: 2,
                isIndividual: true,
                isVoting: false,
                revision: 0,
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            form: null,
          });
        }
        if (url.pathname.endsWith("/category-rules") && method === "PUT") {
          return json({
            group: {
              id: GROUP_ID,
              slug: "security-working-group",
              name: "Security Working Group",
              type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
              parentGroup: null,
              description: null,
              links: [],
              visibility: "participants",
              governanceInheritanceMode: "inherited",
              eligibilityMode: "category",
              automaticEnrollmentMode: "none",
              allowAutomaticOptOut: false,
              publicLeadership: false,
              minEndorsersForBallot: 0,
              active: true,
              revision: 8,
              membershipCapacityCount: 0,
              participantCount: 0,
              childCount: 0,
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const onUpdated = vi.fn(async () => undefined);
    await act(() => render(<GroupCategoryRulesEditor groupId={GROUP_ID} onUpdated={onUpdated} />, container));
    await settle();
    expect(container.textContent).toContain("Organization member");
    expect(container.textContent).toContain("Student");
    const studentJoin = container.querySelector<HTMLInputElement>('input[aria-label="Student may join"]')!;
    await act(() => studentJoin.click());
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save category rules",
    )!;
    await act(async () => save.click());
    await settle();
    const update = requests.find(({ method }) => method === "PUT");
    expect(update?.body).toEqual({
      expectedRevision: 7,
      rules: [
        { membershipCategory: "A", permitsJoin: true, automaticEnrollment: false },
        { membershipCategory: "H5", permitsJoin: true, automaticEnrollment: false },
      ],
    });
    expect(onUpdated).toHaveBeenCalled();

    // The matrix names itself and every control in it, so a reader moving
    // through the grid always knows which category a checkbox belongs to
    // without a visible row header to read back.
    expect(container.querySelector("table caption")?.textContent).toBe("Membership category eligibility");
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((input) =>
        input.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Organization member may join",
      "Organization member automatic enrollment",
      "Student may join",
      "Student automatic enrollment",
    ]);
    // The confirmation is announced as well as tinted, so the outcome reaches
    // a reader who never sees the tone.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Membership category rules updated.");

    await act(() => render(null, container));
    container.remove();
  });

  it("announces a failed category-rules load as an alert and shows no matrix to edit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("category rules unavailable", { status: 503 }))),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(<GroupCategoryRulesEditor groupId={GROUP_ID} onUpdated={async () => undefined} />, container),
    );
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    // With nothing loaded there is nothing to save, so the affirmative action
    // is out of play rather than offering to write an empty policy.
    expect(buttonNamed(container, "Save category rules").disabled).toBe(true);
    expect(container.textContent).toContain("No membership categories are configured.");

    await act(() => render(null, container));
    container.remove();
  });
});

describe("group creation is a page, not a layer over the catalog", () => {
  function stubEmptyCatalog(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  }

  it("sends New group to its own address instead of swapping the catalog for a form", async () => {
    stubEmptyCatalog();
    portalSession.value = portalSessionFixture({ member: true, staff: true });
    const container = mountGroupsAt();
    await settle();

    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "New group");
    expect(create).not.toBeUndefined();
    await act(async () => {
      create?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigate).toHaveBeenCalledWith("/groups/new");
    // The click navigates and nothing else: this mount still shows the catalog.
    expect(container.textContent).not.toContain("Create a group");
  });

  it("renders the reserved new segment as the create page, with a way back and a cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/groups/creation-capabilities") {
          return new Response(JSON.stringify({ canCreate: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ groupTypes: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    portalSession.value = portalSessionFixture({ member: true, staff: true });
    const container = mountGroupsAt("new");
    await settle();

    expect(container.textContent).toContain("Create a group");
    // The catalog is gone rather than sitting below the form.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("New group");

    const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    expect(cancel).not.toBeUndefined();
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith("/groups");
  });

  it("returns an identity without groups:write from the create page to the catalog", async () => {
    stubEmptyCatalog();
    portalSession.value = portalSessionFixture({ member: true });
    mountGroupsAt("new");
    await settle();

    expect(navigate).toHaveBeenCalledWith("/groups");
  });
});
