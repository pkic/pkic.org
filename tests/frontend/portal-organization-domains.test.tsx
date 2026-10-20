// @vitest-environment jsdom
/**
 * An organization's email domains: a view under the record that names where
 * linked people came from, a confirmed removal of a claim, and a claim form
 * that offers the merge when another organization already claims the domain.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationDetailResponseSchema } from "../../assets/shared/schemas/organization-management";
import {
  organizationDomainClaimCreateSchema,
  organizationDomainsListResponseSchema,
} from "../../assets/shared/schemas/organization-domains";
import { OrganizationDomains } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDomains";
import { OrganizationDomainClaimForm } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDomainClaimForm";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", navigate] }));
const confirmAction = vi.fn(async (_request: { consequences?: readonly string[] }) => true);
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({
  confirmAction: (request: { consequences?: readonly string[] }) => confirmAction(request),
}));

const organizationId = "00000000-0000-4000-8000-000000000040";
const duplicateId = "00000000-0000-4000-8000-000000000041";
const mounted: HTMLElement[] = [];
const requests: Array<{ method: string; path: string; body: unknown }> = [];

const organization = organizationDetailResponseSchema.parse({
  organization: {
    id: organizationId,
    name: "Acme",
    publicProfileHref: "/members/profile/?id=acme",
    membershipCategory: null,
    memberSince: "2026-01-01",
    activeIdentityCount: 3,
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
    claimedDomains: ["acme.example"],
    mergedInto: null,
    identities: [],
  },
});

const domains = organizationDomainsListResponseSchema.parse({
  domains: [
    { domain: "acme-labs.example", status: "derived", people: 1, claimedAt: null },
    { domain: "acme.example", status: "claimed", people: 2, claimedAt: "2026-02-01T00:00:00.000Z" },
  ],
  page: { limit: 50, offset: 0, total: 2, hasMore: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const preview = { preview: { domain: "acme.example", peopleToLink: 3 } };

function stub(previewResponse: Response = json(preview), claimResponse: Response = json({}, 500)): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      const method = init?.method ?? "GET";
      requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "DELETE") return Promise.resolve(json({ success: true }));
      if (method === "POST") return Promise.resolve(claimResponse);
      if (path.includes("/domains/")) return Promise.resolve(previewResponse);
      return Promise.resolve(json(path.endsWith("/domains") ? domains : organization));
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
  for (let attempt = 0; attempt < 5; attempt += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
}

function type(host: HTMLElement, name: string, value: string): void {
  const control = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  navigate.mockReset();
  confirmAction.mockClear();
  requests.splice(0);
  vi.unstubAllGlobals();
});

describe("organization email domains", () => {
  it("lists each domain with its source and people, and removes a claim after confirmation", async () => {
    stub();
    const host = mount(<OrganizationDomains organizationId={organizationId} canWrite />);
    await settle();
    expect(host.textContent).toContain("@acme-labs.example");
    expect(host.textContent).toContain("Through people");
    expect(host.textContent).toContain("Claimed");
    // Only a claim has a command; a derived domain is explained, not removed.
    expect(button(host, "Actions for @acme-labs.example")).toBeUndefined();

    await act(async () => button(host, "Actions for @acme.example")!.click());
    await act(async () => button(host, "Remove claim")!.click());
    await settle();
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(requests.find((request) => request.method === "DELETE")?.path).toBe(
      `/api/v1/organizations/${organizationId}/domains/acme.example`,
    );
  });

  it("keeps the organization hero above the sub-page heading on the domains and claim pages", async () => {
    stub();
    const domains = mount(<OrganizationDomains organizationId={organizationId} canWrite />);
    await settle();
    const domainsHeadings = Array.from(domains.querySelectorAll("h2, h3"), (heading) => heading.textContent?.trim());
    expect(domainsHeadings.slice(0, 2)).toEqual(["Acme", "Email domains"]);

    stub(json(preview));
    const claim = mount(<OrganizationDomainClaimForm organizationId={organizationId} />);
    await settle();
    expect(claim.querySelector("h2")?.textContent?.trim()).toBe("Acme");
    expect(claim.textContent).toContain("Claim a domain");
  });

  it("offers no claim commands to a reader without write permission", async () => {
    stub();
    const host = mount(<OrganizationDomains organizationId={organizationId} canWrite={false} />);
    await settle();
    expect(button(host, "Claim a domain")).toBeUndefined();
    expect(button(host, "Actions for @acme.example")).toBeUndefined();
  });

  async function submitClaim(host: HTMLElement): Promise<void> {
    await act(async () => type(host, "domain", "@Acme.example"));
    await act(async () => type(host, "reason", "Their own web site"));
    await act(async () => button(host, "Claim domain")!.click());
    await settle();
  }

  it("says how many people the claim links before sending a claim the contract accepts", async () => {
    stub(
      json(preview),
      json(
        {
          domain: { domain: "acme.example", status: "claimed", people: 3, claimedAt: "2026-10-10T00:00:00.000Z" },
          linking: { peopleLinked: 3, continuing: false },
        },
        201,
      ),
    );
    const host = mount(<OrganizationDomainClaimForm organizationId={organizationId} />);
    await settle();
    await submitClaim(host);

    expect(confirmAction.mock.calls[0]?.[0].consequences).toEqual([
      "3 people with a verified address on @acme.example will be linked to Acme",
    ]);
    const sent = requests.find((request) => request.method === "POST")!;
    expect(sent.path).toBe(`/api/v1/organizations/${organizationId}/domains`);
    expect(organizationDomainClaimCreateSchema.parse(sent.body)).toEqual({
      domain: "acme.example",
      reason: "Their own web site",
    });
    expect(navigate).toHaveBeenCalledWith(`/organizations/${organizationId}/domains`);
  });

  it("offers the merge instead of a claim when another organization claims the domain", async () => {
    stub(
      json(
        {
          error: {
            code: "ORGANIZATION_DOMAIN_CLAIMED_ELSEWHERE",
            message: "Acme Duplicate already claims acme.example; merge the organizations instead",
            details: { organizationId: duplicateId, organizationName: "Acme Duplicate" },
          },
        },
        409,
      ),
    );
    const host = mount(<OrganizationDomainClaimForm organizationId={organizationId} />);
    await settle();
    await submitClaim(host);

    expect(confirmAction).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    const merge = Array.from(host.querySelectorAll("a")).find((link) => link.textContent?.includes("Merge"));
    expect(merge?.getAttribute("href")).toContain(`/organizations/${duplicateId}/merge`);
  });
});
