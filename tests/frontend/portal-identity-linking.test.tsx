// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityRoster } from "../../assets/ts/member-flows/portal/sections/system-organizations/IdentityRoster";
import type { OrganizationDetail } from "../../assets/shared/schemas/organization-management";
import { identityCreateSchema } from "../../assets/shared/schemas/identity";
import { buttonNamed, controlFor, groupNames, namedGroup } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/organizations", vi.fn()],
}));

const ORG_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";

const organization = {
  id: ORG_ID,
  name: "Example Trust Services",
  identities: [],
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
    render(<IdentityRoster organization={organization} canManageIdentities onChanged={async () => {}} />, container),
  );
}

function clickButton(label: string): void {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
  void act(() => button.click());
}

/**
 * Runs one of the roster's add commands.
 *
 * They live in the list's own menu rather than as two filled buttons above it:
 * adding a representative is the rarest thing done on the page and was the
 * loudest. A menu names itself through `aria-label`, so the trigger is found
 * that way and the item by its text.
 */
function runRosterCommand(label: string): void {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Representative settings"]');
  if (!trigger) throw new Error("the roster offers no settings menu");
  void act(() => trigger.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) throw new Error(`the roster offers no "${label}"`);
  void act(() => item.click());
}

describe("linking existing users as acting identities", () => {
  it("invites a picked existing user through the canonical identity command", async () => {
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
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/identities` && method === "POST") {
          return new Response(JSON.stringify({ success: true, identityId: USER_ID, state: "pending" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/identities` && method === "GET") {
          return new Response(
            JSON.stringify({ identities: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    mount();
    await settle();
    runRosterCommand("Link an existing user…");
    await settle();

    // The picker's own field, not the list's search box beside the commands that opened it.
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search for a user"]')!;
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
    const parsed = identityCreateSchema.parse(association?.body);
    expect(parsed).toEqual({
      userReference: "existing_user",
      userId: USER_ID,
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
    });
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
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/identities` && method === "POST") {
          return new Response(
            JSON.stringify({ error: { code: "IDENTITY_BLOCKED", message: "This identity was blocked" } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === `/api/v1/organizations/${ORG_ID}/identities` && method === "GET") {
          return new Response(
            JSON.stringify({ identities: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    mount();
    await settle();
    runRosterCommand("Link an existing user…");
    await settle();
    // The picker's own field, not the list's search box beside the commands that opened it.
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search for a user"]')!;
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

    // A rejection is announced, not left as colored text beside the button.
    const alert = [...container.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("This identity was blocked"),
    );
    expect(alert).toBeTruthy();
    expect(container.querySelector("form")).toBeTruthy();
  });

  it("names the roster region, its groups, and every control the add form draws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ identities: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    mount();
    await settle();

    // The section carries its own name, so it is a region rather than an
    // anonymous box; the heading beside it says the same thing visually.
    const region = container.querySelector('section[aria-label="Representatives"]');
    expect(region).not.toBeNull();
    expect(region!.querySelector("caption")?.textContent).toBe("Representatives");

    // The picker's group is named by a `<legend>`, because `UserPicker` owns
    // the id of the control inside it and no outside label can point at it.
    runRosterCommand("Link an existing user…");
    await settle();
    expect(groupNames(container)).toContain("Existing user");
    // Nothing is picked yet, so the affirmative action is blocked rather than
    // pretending a request is already in flight.
    expect(buttonNamed(container, "Link").disabled).toBe(true);

    buttonNamed(container, "Cancel").click();
    await settle();
    runRosterCommand("Add a new person…");
    await settle();

    expect(groupNames(container)).toEqual(expect.arrayContaining(["New person", "Profile links"]));
    const addForm = namedGroup(container, "New person");
    expect(controlFor(addForm, "Name").required).toBe(true);
    expect(controlFor(addForm, "Email").type).toBe("email");
    expect(controlFor(addForm, "Job title").required).toBe(false);
  });
});
