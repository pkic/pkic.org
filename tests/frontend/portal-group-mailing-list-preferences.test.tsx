// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailingListPreferenceMutationSchema } from "../../assets/shared/schemas/mailing-lists";
import { GroupMailingLists } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingLists";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

const MAILING_LIST = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "architecture@lists.example.test",
  label: "Architecture discussion",
  purpose: "group",
  groupId: GROUP_ID,
  primaryDiscussion: true,
  subscriptionDefault: "group_members",
  postingPolicy: "members",
  moderationPolicy: "moderated",
  autoSyncCategories: null,
  active: true,
  archivedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/** One eligible list, with the preference write answered as the caller asks. */
function stubList({ eligible = true, refusePut = false }: { eligible?: boolean; refusePut?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method ?? "GET") === "PUT" && refusePut) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "FORBIDDEN", message: "You cannot change that subscription." } }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      return Promise.resolve(
        json({
          subscriptions: [
            {
              mailingList: MAILING_LIST,
              eligible,
              defaultSubscribed: true,
              preference: null,
              effectiveSubscribed: true,
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        }),
      );
    }),
  );
}

describe("group mailing-list preferences", () => {
  it("updates a mailing-list preference through its selected group context", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let preference: "subscribed" | "unsubscribed" | null = null;
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
        const subscription = {
          mailingList: {
            id: "a0000000-0000-4000-8000-000000000001",
            email: "architecture@lists.example.test",
            label: "Architecture discussion",
            purpose: "group",
            groupId: GROUP_ID,
            primaryDiscussion: true,
            subscriptionDefault: "group_members",
            postingPolicy: "members",
            moderationPolicy: "moderated",
            autoSyncCategories: null,
            active: true,
            archivedAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
          eligible: true,
          defaultSubscribed: true,
          preference,
          effectiveSubscribed: preference !== "unsubscribed",
        } as const;
        if (method === "PUT") {
          preference = (body as { preference: typeof preference }).preference;
          return json({ success: true, subscription: { ...subscription, preference, effectiveSubscribed: false } });
        }
        return json({ subscriptions: [subscription], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} />);
    await settle();
    expect(container.textContent).toContain("Architecture discussion");
    expect(container.textContent).toContain("Subscribed");

    const select = container.querySelector<HTMLSelectElement>("select")!;
    select.value = "unsubscribed";
    await act(async () => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();

    expect(requests.find(({ method }) => method === "PUT")).toMatchObject({
      url: expect.objectContaining({
        pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists/a0000000-0000-4000-8000-000000000001/subscription`,
      }),
      body: { preference: "unsubscribed" },
    });
    expect(requests.filter(({ method }) => method === "GET")).toHaveLength(2);
    expect(container.textContent).toContain("Not subscribed");
    // Parsed through the canonical contract rather than compared to a literal.
    expect(mailingListPreferenceMutationSchema.parse(requests.find(({ method }) => method === "PUT")?.body)).toEqual({
      preference: "unsubscribed",
    });
  });

  it("names the region, the table and every row's control", async () => {
    stubList();
    const container = mount(<GroupMailingLists groupId={GROUP_ID} />);
    await settle();

    // The panel is a named region, so it is reachable among the group's other
    // panels rather than being an anonymous <section>.
    const region = container.querySelector<HTMLElement>('section[aria-label="My mailing-list preferences"]');
    expect(region).not.toBeNull();
    expect(region?.querySelector("caption")?.textContent).toBe("My mailing-list preferences");

    // A column of controls all called "Preference" is indistinguishable to
    // anyone navigating by form controls, so each one names its list.
    const select = region!.querySelector<HTMLSelectElement>("select")!;
    expect(select.getAttribute("aria-label")).toBe("Subscription preference for Architecture discussion");
    // The purpose reads as a word rather than as the stored identifier.
    expect(region?.textContent).toContain("Group");
    expect(region?.textContent).not.toContain("group_");
  });

  it("takes the control out of play for a list the member is not eligible for", async () => {
    stubList({ eligible: false });
    const container = mount(<GroupMailingLists groupId={GROUP_ID} />);
    await settle();

    const region = container.querySelector<HTMLElement>('section[aria-label="My mailing-list preferences"]')!;
    expect(region.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
  });

  it("states a refused preference change as a sentence beside the list", async () => {
    stubList({ refusePut: true });
    const container = mount(<GroupMailingLists groupId={GROUP_ID} />);
    await settle();

    const region = container.querySelector<HTMLElement>('section[aria-label="My mailing-list preferences"]')!;
    const select = region.querySelector<HTMLSelectElement>("select")!;
    select.value = "unsubscribed";
    await act(async () => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();

    // Announced where it appears: the danger tone carries role="alert".
    const alerts = [...region.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("You cannot change that subscription."))).toBe(true);
    expect(container.textContent).not.toContain("HTTP 403");
  });
});
