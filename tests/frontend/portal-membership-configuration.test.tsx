// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembershipConfiguration } from "../../assets/ts/member-flows/portal/sections/MembershipConfiguration";

const NOW = "2026-08-27T12:00:00.000Z";
const settings = {
  consultationWindowDays: 7,
  ecReviewWindowDays: 7,
  onHoldResponseDeadlineDays: 7,
  consultationEmailRecipients: "consultation@example.test",
  ecEmailRecipients: "ec@example.test",
  ccApplicantEmails: "members@example.test",
  autoReminderOnHolds: true,
  revision: 3,
  updatedAt: NOW,
};
const category = {
  code: "H1",
  label: "Government entities",
  description: "Existing description",
  displayOrder: 80,
  isIndividual: false,
  isVoting: false,
  revision: 4,
  updatedAt: NOW,
};

let container: HTMLElement | null = null;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(canWrite: boolean): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<MembershipConfiguration canWrite={canWrite} />, container!));
  return container;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("portal membership configuration", () => {
  it("uses canonical system APIs and sends revision-guarded settings and category updates", async () => {
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ path: url.pathname, body });
          if (url.pathname.endsWith("/H1")) {
            return json({ category: { ...category, ...body, revision: 5, updatedAt: NOW } });
          }
          return json({ ...settings, ...body, revision: 4, updatedAt: NOW });
        }
        if (url.pathname.endsWith("/membership-settings")) return json(settings);
        if (url.pathname.endsWith("/membership-categories")) return json({ categories: [category] });
        return new Response(null, { status: 404 });
      }),
    );

    const page = mount(true);
    await settle();
    expect(page.textContent).toContain("Application workflow");
    expect(page.textContent).toContain("Category H1");
    expect(page.textContent).toContain("Organization");

    const categoryLabel = page.querySelector("#membership-category-h1-label") as HTMLInputElement;
    await act(() => {
      categoryLabel.value = "Government PKI participants";
      categoryLabel.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const categorySave = [...page.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save category H1"),
    )!;
    await act(async () => categorySave.click());
    await settle();

    const settingsSave = [...page.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save workflow settings"),
    )!;
    await act(async () => settingsSave.click());
    await settle();

    expect(writes).toContainEqual({
      path: "/api/v1/system/membership-categories/H1",
      body: {
        expectedRevision: 4,
        label: "Government PKI participants",
        description: "Existing description",
        displayOrder: 80,
        isVoting: false,
      },
    });
    expect(writes.find((write) => write.path.endsWith("membership-settings"))?.body.expectedRevision).toBe(3);
    expect(writes.every((write) => write.path.startsWith("/api/v1/system/"))).toBe(true);
  });

  it("renders the same data read-only without mutation controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname.endsWith("/membership-settings") ? json(settings) : json({ categories: [category] });
      }),
    );

    const page = mount(false);
    await settle();
    expect(page.querySelectorAll("button")).toHaveLength(0);
    expect([...page.querySelectorAll("input, textarea")].every((field) => (field as HTMLInputElement).disabled)).toBe(
      true,
    );
  });
});
