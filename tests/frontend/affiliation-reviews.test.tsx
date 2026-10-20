// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AffiliationReviews } from "../../assets/ts/member-flows/portal/sections/AffiliationReviews";
import { affiliationReviewApproveSchema } from "../../assets/shared/schemas/affiliation-reviews";

vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: async () => true }));
const mounted: HTMLElement[] = [];
const userId = "00000000-0000-4000-8000-000000000001";
const group = {
  groupKey: "ibm",
  organizationName: "IBM",
  jobTitle: null,
  emailDomains: ["ibm.example"],
  people: 7,
  openReviews: 7,
  unverifiedPeople: 0,
  status: "open",
  firstRecordedAt: "2026-10-01T00:00:00.000Z",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
async function settle() {
  for (let step = 0; step < 5; step += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
afterEach(() => {
  for (const host of mounted.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
});
function mount(canApprove = true, canOverride = false) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  void act(() =>
    render(<AffiliationReviews groupKey="ibm" canWrite canApprove={canApprove} canOverride={canOverride} />, host),
  );
  return host;
}
it("approves all through bounded passes and sends validated cursors", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      if (init?.method === "POST") {
        bodies.push(affiliationReviewApproveSchema.parse(JSON.parse(String(init.body))));
        return Promise.resolve(
          json({ group, decided: bodies.length === 1 ? 5 : 2, nextUserId: bodies.length === 1 ? userId : null }),
        );
      }
      return Promise.resolve(
        json(
          path.endsWith("/groups/ibm")
            ? { group }
            : { reviews: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } },
        ),
      );
    }),
  );
  const host = mount();
  await settle();
  const button = Array.from(host.querySelectorAll("button")).find(
    (node) => node.textContent === "Approve verified affiliations",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
  expect(bodies).toEqual([{}, { afterUserId: userId }]);
});
it("does not expose approval without activation permission", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        json(
          new URL(String(input), location.origin).pathname.endsWith("/groups/ibm")
            ? { group }
            : { reviews: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } },
        ),
      ),
    ),
  );
  const host = mount(false);
  await settle();
  expect(Array.from(host.querySelectorAll("button")).some((node) => node.textContent?.includes("Approve"))).toBe(false);
});

it("shows missing verification and does not announce zero approvals as success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pendingGroup = { ...group, unverifiedPeople: 7 };
      if (init?.method === "POST") {
        affiliationReviewApproveSchema.parse(JSON.parse(String(init.body)));
        return Promise.resolve(json({ group: pendingGroup, decided: 0, nextUserId: null }));
      }
      return Promise.resolve(
        json(
          new URL(String(input), location.origin).pathname.endsWith("/groups/ibm")
            ? { group: pendingGroup }
            : { reviews: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } },
        ),
      );
    }),
  );
  const notifications = document.createElement("div");
  notifications.id = "portal-toast-area";
  document.body.append(notifications);
  try {
    const host = mount();
    await settle();
    expect(host.textContent).toContain("People without recorded verification");
    expect(host.textContent).toContain("do not need to verify again");
    const button = Array.from(host.querySelectorAll("button")).find(
      (node) => node.textContent === "Approve verified affiliations",
    );
    await act(async () => button!.click());
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("No affiliations were approved");
    expect(notifications.textContent).toBe("");
  } finally {
    notifications.remove();
  }
});

it("requires a recorded reason before sending an explicit staff override", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(affiliationReviewApproveSchema.parse(JSON.parse(String(init.body))));
        return Promise.resolve(json({ group, decided: 1, nextUserId: null }));
      }
      return Promise.resolve(
        json(
          new URL(String(input), location.origin).pathname.endsWith("/groups/ibm")
            ? { group }
            : { reviews: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } },
        ),
      );
    }),
  );
  const host = mount(true, true);
  await settle();
  const trigger = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Override missing verification",
  );
  expect(trigger).toBeDefined();
  await act(async () => trigger!.click());
  const dialog = document.querySelector("dialog");
  const confirm = Array.from(dialog!.querySelectorAll("button")).find(
    (button) => button.textContent === "Approve with override",
  )!;
  expect(confirm.disabled).toBe(true);
  const reason = dialog!.querySelector("textarea")!;
  await act(async () => {
    reason.value = "Organization contact confirmed the affiliation";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  await settle();
  expect(bodies).toHaveLength(1);
  expect(affiliationReviewApproveSchema.parse(bodies[0]).activation).toMatchObject({
    mode: "immediate",
    reason: reason.value,
  });
});
