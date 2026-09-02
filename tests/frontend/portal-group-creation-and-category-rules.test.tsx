// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupCategoryRulesEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupCategoryRulesEditor";
import { GroupCreateForm } from "../../assets/ts/member-flows/portal/sections/management/GroupCreateForm";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

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

afterEach(() => vi.unstubAllGlobals());

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
      publicRoster: false,
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
                leadershipTitles: { lead: "Chair", deputyLead: "Vice Chair" },
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
    const typeSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Group type"]')!;
    typeSelect.value = "working_group";
    await act(async () => {
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const name = container.querySelector<HTMLInputElement>("#create-group-name")!;
    name.value = "Security Working Group";
    await act(async () => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const description = container.querySelector<HTMLTextAreaElement>("#create-group-description")!;
    description.value = "Coordinates security work.";
    await act(async () => {
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create group")!;
    await act(async () => submit.click());
    await settle();
    const request = requests.find(({ method }) => method === "POST");
    expect(request?.body).toMatchObject({
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
              publicRoster: false,
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
    await act(() => render(null, container));
    container.remove();
  });
});
