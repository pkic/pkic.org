// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepresentativeRoster } from "../../assets/ts/member-flows/portal/sections/system-organizations/RepresentativeRoster";
import type { OrganizationDetail } from "../../assets/shared/schemas/organization-management";
import { representativeAssociateSchema } from "../../assets/shared/schemas/organization-representation";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/organizations", vi.fn()],
}));

const ORG_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";

const organization = {
  id: ORG_ID,
  name: "Example Trust Services",
  representatives: [],
} as unknown as OrganizationDetail;

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

function mount(): void {
  void act(() =>
    render(
      <RepresentativeRoster organization={organization} canManageRepresentatives onChanged={async () => {}} />,
      container,
    ),
  );
}

function clickButton(label: string): void {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
  void act(() => button.click());
}

describe("linking existing users as representatives", () => {
  it("links a picked existing user through the kind:user association", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        if (url.pathname === "/api/v1/users" && method === "GET") {
          return new Response(
            JSON.stringify({
              users: [
                {
                  id: USER_ID,
                  email: "alex@example.test",
                  first_name: "Alex",
                  last_name: "Chair",
                  organization_name: null,
                },
              ],
              page: { limit: 10, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/representatives` && method === "POST") {
          return new Response(JSON.stringify({ success: true, representativeId: "rep-1" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/representatives` && method === "GET") {
          return new Response(
            JSON.stringify({ representatives: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    mount();
    await settle();
    clickButton("Link existing user");
    await settle();

    const search = container.querySelector<HTMLInputElement>("input")!;
    search.value = "alex";
    await act(async () => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    const option = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("alex@example.test"),
    )!;
    void act(() => option.click());
    await settle();

    clickButton("Link");
    await settle();

    const association = requests.find(({ method }) => method === "POST");
    // The body must satisfy the canonical contract, not merely be what the form happens to send.
    const parsed = representativeAssociateSchema.parse(association?.body);
    expect(parsed).toEqual({ kind: "existing_user", userId: USER_ID, showOnOrganizationProfile: true });
  });

  it("surfaces a failed association instead of closing the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        if (url.pathname === "/api/v1/users" && method === "GET") {
          return new Response(
            JSON.stringify({
              users: [
                {
                  id: USER_ID,
                  email: "alex@example.test",
                  first_name: "Alex",
                  last_name: "Chair",
                  organization_name: null,
                },
              ],
              page: { limit: 10, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/representatives` && method === "POST") {
          return new Response(
            JSON.stringify({ error: { code: "REPRESENTATIVE_BLOCKED", message: "This representative was removed" } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/representatives` && method === "GET") {
          return new Response(
            JSON.stringify({ representatives: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    mount();
    await settle();
    clickButton("Link existing user");
    await settle();
    const search = container.querySelector<HTMLInputElement>("input")!;
    search.value = "alex";
    await act(async () => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const option = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("alex@example.test"),
    )!;
    void act(() => option.click());
    await settle();
    clickButton("Link");
    await settle();

    expect(container.textContent).toContain("This representative was removed");
    expect(container.querySelector("form")).toBeTruthy();
  });
});
