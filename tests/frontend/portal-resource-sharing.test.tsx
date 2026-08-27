// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceSharingEditor } from "../../assets/ts/member-flows/portal/sections/management/ResourceSharingEditor";

const OWNER_GROUP_ID = "10000000-0000-4000-8000-000000000001";
const GRANTEE_GROUP_ID = "10000000-0000-4000-8000-000000000002";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(kind: "event" | "formPlacement" | "vote" | "mailingList"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(
      <ResourceSharingEditor
        kind={kind}
        groupId={OWNER_GROUP_ID}
        resourceId={kind === "event" ? "architecture-workshop" : "80000000-0000-4000-8000-000000000001"}
        ownerGroupId={OWNER_GROUP_ID}
      />,
      container,
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const granteeGroup = {
  id: GRANTEE_GROUP_ID,
  slug: "working-group",
  name: "Working Group",
  type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
};

const managedGroup = {
  ...granteeGroup,
  parentGroup: null,
  description: null,
  links: [],
  visibility: "authenticated",
  governanceInheritanceMode: "inherited",
  eligibilityMode: "managed",
  automaticEnrollmentMode: "none",
  allowAutomaticOptOut: false,
  publicLeadership: false,
  minEndorsersForBallot: 0,
  active: true,
  revision: 1,
  membershipCapacityCount: 1,
  participantCount: 1,
  childCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal resource sharing editor", () => {
  it.each([
    ["event", "events", "attend"],
    ["formPlacement", "forms", "view_responses"],
    ["vote", "votes", "participate"],
    ["mailingList", "mailing-lists", "post"],
  ] as const)("uses the canonical %s grant contract", async (kind, resourcePath, selectedCapability) => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let grantActive = false;
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
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
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [managedGroup], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
        }
        if (method === "POST") {
          grantActive = true;
          return json({
            success: true,
            created: true,
            grant: {
              granteeGroup,
              capability: selectedCapability,
              createdByUserId: null,
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          });
        }
        if (method === "DELETE") {
          grantActive = false;
          return json({ success: true });
        }
        return json({
          grants: grantActive
            ? [
                {
                  granteeGroup,
                  capability: selectedCapability,
                  createdByUserId: null,
                  createdAt: "2026-08-01T00:00:00.000Z",
                },
              ]
            : [],
          page: { limit: 50, offset: 0, total: grantActive ? 1 : 0, hasMore: false },
        });
      }),
    );

    const container = mount(kind);
    await settle();
    await settle();

    // The picker is intentionally server-backed and asks only for the
    // management projection; it never downloads the public group catalog.
    expect(requests.find(({ url }) => url.pathname === "/api/v1/groups")?.url.searchParams.get("manageable")).toBe(
      "true",
    );

    const capabilitySelect = container.querySelector<HTMLSelectElement>(`select[aria-label="Capability"]`)!;
    expect([...capabilitySelect.options].map((option) => option.value)).toContain(selectedCapability);
    const groupSelect = container.querySelector<HTMLSelectElement>(`select[aria-label="Group"]`)!;
    groupSelect.value = GRANTEE_GROUP_ID;
    await act(async () => {
      groupSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      capabilitySelect.value = selectedCapability;
      capabilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const share = [...container.querySelectorAll("button")].find((button) => button.textContent === "Share");
    expect(share).toBeDefined();
    await act(async () => share!.click());
    await settle();
    await settle();

    const grantPath = `/api/v1/groups/${OWNER_GROUP_ID}/${resourcePath}/${
      kind === "event" ? "architecture-workshop" : "80000000-0000-4000-8000-000000000001"
    }/grants`;
    expect(requests.find(({ method }) => method === "POST")).toMatchObject({
      url: expect.objectContaining({ pathname: grantPath }),
      body: { granteeGroupId: GRANTEE_GROUP_ID, capability: selectedCapability },
    });
    expect(container.textContent).toContain("Working Group");

    const revoke = [...container.querySelectorAll("button")].find((button) => button.textContent === "Revoke");
    expect(revoke).toBeDefined();
    await act(async () => revoke!.click());
    await settle();
    expect(requests.find(({ method }) => method === "DELETE")).toMatchObject({
      url: expect.objectContaining({ pathname: `${grantPath}/${GRANTEE_GROUP_ID}/${selectedCapability}` }),
    });
  });
});
