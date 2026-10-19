// @vitest-environment jsdom
/**
 * Merging a duplicate organization is a whole-record command: it is offered
 * from the record's "…" menu to staff who may move its representatives, and
 * a merged record says where it went.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationDetailResponseSchema,
  organizationSummarySchema,
} from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";
import { organizationMergeConsequences } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationMergeForm";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", navigate] }));

const organizationId = "00000000-0000-4000-8000-000000000030";
const targetId = "00000000-0000-4000-8000-000000000031";
const mounted: HTMLElement[] = [];

function detail(overrides: Record<string, unknown> = {}) {
  return organizationDetailResponseSchema.parse({
    organization: {
      id: organizationId,
      name: "IBM Netherlands",
      publicProfileHref: "/members/profile/?id=ibm-nl",
      membershipCategory: null,
      memberSince: "2026-01-01",
      activeIdentityCount: 2,
      primaryContactName: null,
      primaryContactEmail: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      website: null,
      description: null,
      slogan: null,
      logoUrl: null,
      contentMarkdown: null,
      blogUrl: null,
      blogFeedUrl: null,
      pressUrl: null,
      pressFeedUrl: null,
      careersUrl: null,
      links: [],
      primaryContactUserId: null,
      secondaryContactUserId: null,
      emailDomains: [],
      claimedDomains: ["ibm.nl"],
      mergedInto: null,
      identities: [],
      ...overrides,
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function stub(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      return Promise.resolve(
        json(
          path.endsWith("/identities")
            ? identitiesListResponseSchema.parse({
                identities: [],
                page: { limit: 25, offset: 0, total: 0, hasMore: false },
              })
            : body,
        ),
      );
    }),
  );
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  navigate.mockReset();
  vi.unstubAllGlobals();
});

describe("organization merge", () => {
  it("is offered from the record's menu and opens the merge page under the record", async () => {
    stub(detail());
    const host = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite
        canManageIdentities
        canReadSponsorships={false}
        canMerge
      />,
    );
    await settle();
    await act(async () => button(host, "Record actions")!.click());
    await act(async () => button(host, "Merge into another organization…")!.click());
    expect(navigate.mock.calls[0]?.[0]).toBe(`/organizations/${organizationId}/merge`);
  });

  it("is not offered without both permissions, nor on a merged record, which says where it went", async () => {
    stub(detail());
    const plain = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite
        canManageIdentities
        canReadSponsorships={false}
      />,
    );
    await settle();
    await act(async () => button(plain, "Record actions")!.click());
    expect(button(plain, "Email domains…")).toBeDefined();
    expect(button(plain, "Merge into another organization…")).toBeUndefined();

    stub(detail({ mergedInto: { id: targetId, name: "IBM", mergedAt: "2026-10-01T00:00:00.000Z" } }));
    const merged = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite
        canManageIdentities
        canReadSponsorships={false}
        canMerge
      />,
    );
    await settle();
    expect(merged.textContent).toContain("Merged into IBM");
    await act(async () => button(merged, "Record actions")!.click());
    expect(button(merged, "Merge into another organization…")).toBeUndefined();
  });

  it("states who and which domains move before staff confirm", () => {
    const source = detail().organization;
    const target = organizationSummarySchema.parse({
      ...source,
      id: targetId,
      name: "IBM",
    });
    expect(organizationMergeConsequences(source, target)).toEqual([
      "2 people who represent IBM Netherlands will represent IBM",
      "IBM Netherlands leaves the directory; its page and credits lead to IBM",
      "@ibm.nl addresses will join IBM",
    ]);
  });
});
