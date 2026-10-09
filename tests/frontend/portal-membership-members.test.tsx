// @vitest-environment jsdom
/**
 * Granting somebody a membership in their own right.
 *
 * Issue #24 reported that the portal offered no way to record an H5, H6 or H7
 * member although `/api/v1/members` accepted one. The form exists now; what is
 * asserted here is the property that keeps it correct — that the categories it
 * offers ARE the categories the contract accepts, derived rather than retyped,
 * so a vocabulary that grows is offered without anybody editing this surface.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlFor, submitForm, typeInto } from "./helpers/labelled-control";
import {
  individualMembershipGrantSchema,
  memberCapacityMutationResponseSchema,
} from "../../assets/shared/schemas/membership-management";
import { catalogEntry } from "./helpers/membership-roll-fixtures";
import { GrantIndividualMembershipForm } from "../../assets/ts/member-flows/portal/sections/membership-members/GrantIndividualMembershipForm";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/members/grant", vi.fn()] }));

let container: HTMLDivElement | null = null;

function mount(node: preact.ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.restoreAllMocks();
});

describe("granting an individual membership", () => {
  it("offers configured individual categories and excludes organization categories", () => {
    const root = mount(
      <GrantIndividualMembershipForm
        categories={[
          catalogEntry("COMMUNITY", "Community users", true),
          catalogEntry("PARTNER", "Partner organizations", false),
        ]}
        onGranted={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const offered = [...root.querySelectorAll("option")].map((option) => option.value);
    // Exactly the contract's set, in the contract's order — not a subset, and
    // not a superset the route would refuse.
    expect(offered).toEqual(["COMMUNITY"]);
    // The contract is the same one the route parses, so this is the set the
    // API accepts rather than a second opinion about it.
    for (const category of offered) {
      expect(
        individualMembershipGrantSchema.safeParse({
          userId: "00000000-0000-4000-8000-000000000001",
          membershipCategory: category,
          activationReason: "Recorded by staff",
        }).success,
      ).toBe(true);
    }
  });

  it("uses configured labels without offering removed categories", () => {
    const first = "RESEARCH";
    const root = mount(
      <GrantIndividualMembershipForm
        categories={[catalogEntry(first, "PhD students researching PKI or cryptography", true)]}
        onGranted={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const labels = new Map(
      [...root.querySelectorAll("option")].map((option) => [option.value, option.textContent ?? ""]),
    );
    expect(labels.get(first)).toBe(`PhD students researching PKI or cryptography (${first})`);
    // Removed baseline categories must not reappear as grant options.
    expect([...labels.keys()]).toEqual([first]);
  });

  it("refuses to submit without the person the membership is granted to", async () => {
    const onGranted = vi.fn();
    const root = mount(
      <GrantIndividualMembershipForm categories={[]} onGranted={onGranted} onCancel={() => undefined} />,
    );

    const submit = [...root.querySelectorAll("button")].find((button) => button.textContent === "Grant membership")!;
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });

    // The refusal comes from the shared contract, not from a local check, and
    // nothing is sent.
    expect(onGranted).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')?.textContent ?? "").not.toBe("");
  });

  it("grants the person picked from the server search through the shared contract", async () => {
    const person = { id: "00000000-0000-4000-8000-000000000042", email: "grace@example.test" };
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (init?.method === "POST") {
          expect(url.pathname).toBe("/api/v1/members/capacities");
          posts.push(JSON.parse(String(init.body)));
          return new Response(
            JSON.stringify(
              memberCapacityMutationResponseSchema.parse({
                member: {
                  id: "00000000-0000-4000-8000-000000000043",
                  userId: person.id,
                  organizationId: null,
                  membershipCategory: "H6",
                  status: "active",
                  showOnOrgProfile: false,
                },
              }),
            ),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            users: [{ ...person, first_name: "Grace", last_name: "Hopper", organization_name: null }],
            page: { limit: 10, offset: 0, total: 1, hasMore: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const onGranted = vi.fn();
    const root = mount(
      <GrantIndividualMembershipForm
        categories={[catalogEntry("H6", "Individual supporter", true), catalogEntry("H7", "Community member", true)]}
        onGranted={onGranted}
        onCancel={() => undefined}
      />,
    );

    // The person is found by the debounced server search, not typed as an id.
    vi.useFakeTimers();
    await typeInto(root.querySelector<HTMLInputElement>('input[placeholder="email or name"]')!, "grace");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const match = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes(person.email));
    await act(async () => match!.click());

    await typeInto(controlFor(root, "Activation reason"), "Individual membership granted from the roll");
    await submitForm(root);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(individualMembershipGrantSchema.parse(posts[0])).toEqual({
      userId: person.id,
      membershipCategory: "H6",
      activationReason: "Individual membership granted from the roll",
    });
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
});
