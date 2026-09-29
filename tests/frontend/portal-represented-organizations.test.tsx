// @vitest-environment jsdom
/**
 * The representative's own slice of the organization directory.
 *
 * What matters here is what the list exposes when nobody is looking at it
 * with a mouse: a named table, named columns, and a row whose activation is a
 * real link rather than a click handler on a `<tr>`.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import {
  userOrganizationsListResponseSchema,
  type UserOrganization,
} from "../../assets/shared/schemas/user-organizations";
import { RepresentedOrganizations } from "../../assets/ts/member-flows/portal/sections/RepresentedOrganizations";

let container: HTMLDivElement | null = null;

const ORGANIZATION: UserOrganization = {
  organizationId: "11111111111111111111111111111111",
  memberId: "22222222222222222222222222222222",
  name: "Example Corp",
  membershipCategory: "Full",
  isOrgContact: false,
  isPrimaryContact: false,
  hasPendingReview: true,
};

function ok(organizations: UserOrganization[]): Response {
  const body = userOrganizationsListResponseSchema.parse({
    organizations,
    page: buildPageInfo(25, 0, organizations.length, organizations.length),
  });
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function respondWith(response: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response())),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<RepresentedOrganizations />, container!);
    await Promise.resolve();
  });
  await settle();
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("RepresentedOrganizations", () => {
  it("names the table and every column, leaving none announced as blank", async () => {
    respondWith(() => ok([ORGANIZATION]));
    const root = await mount();

    expect(root.querySelector("caption")?.textContent).toBe("Your organizations");
    // The sort control appends its own arrow, which is decoration; the name
    // is what precedes it.
    const headers = [...root.querySelectorAll("thead th")].map((cell) =>
      (cell.textContent ?? "").replace(/[↑↓↕]/g, "").trim(),
    );
    expect(headers).toEqual(["Organization", "Your role", "Review"]);
    for (const header of headers) expect(header).not.toBe("");
    expect(root.querySelector('thead th[aria-sort="ascending"]')?.textContent).toContain("Organization");
  });

  it("activates a row through a real link, not a handler on the row", async () => {
    respondWith(() => ok([ORGANIZATION]));
    const root = await mount();

    const link = root.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(link).not.toBeNull();
    // The name says where the row goes, so it is useful out of context.
    expect(link?.textContent).toBe("Open Example Corp");
    expect(link?.getAttribute("href")).toContain(ORGANIZATION.organizationId);
  });

  it("says what a reader's role is in words rather than by tone alone", async () => {
    respondWith(() => ok([{ ...ORGANIZATION, isPrimaryContact: true }]));
    const root = await mount();

    expect(root.textContent).toContain("Primary contact");
    expect(root.textContent).toContain("Review pending");
  });

  it("explains an empty list instead of showing an unexplained blank table", async () => {
    respondWith(() => ok([]));
    const root = await mount();

    expect(root.textContent).toContain("You do not represent any organizations right now.");
  });

  it("states the failure plainly when the list cannot be loaded", async () => {
    respondWith(
      () =>
        new Response(JSON.stringify({ error: { code: "forbidden", message: "HTTP 403" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    const root = await mount();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
  });
});
