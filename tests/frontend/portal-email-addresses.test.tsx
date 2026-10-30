// @vitest-environment jsdom
/**
 * Email addresses on the user record: one panel for the person's own
 * addresses and for staff managing another user's. The list's row commands
 * send what each route accepts, adding an address is a form of its own, and
 * the public page a verification link opens previews it and verifies only on
 * request.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_VERIFIED_ELSEWHERE,
  ownEmailAddressUpdateSchema,
  ownEmailAddressVerificationSchema,
  ownEmailAddressesListResponseSchema,
} from "../../assets/shared/schemas/own-email-addresses";
import { userEmailAddSchema } from "../../assets/shared/schemas/user-emails";
import { EmailAddressAddForm } from "../../assets/ts/member-flows/portal/sections/EmailAddressAddForm";
import { EmailVerificationConfirmation } from "../../assets/ts/member-flows/portal/shell/EmailVerificationConfirmation";
import { EmailAddressesPanel } from "../../assets/ts/member-flows/portal/sections/system-users/EmailAddressesPanel";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/current", navigate] }));
const confirmAction = vi.fn(async () => true);
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: () => confirmAction() }));

const USER_ID = "00000000-0000-4000-8000-000000000050";
const aliasId = "00000000-0000-4000-8000-000000000053";
const workId = "00000000-0000-4000-8000-000000000051";
const waitingId = "00000000-0000-4000-8000-000000000052";
const mounted: HTMLElement[] = [];
const requests: Array<{ method: string; path: string; body: unknown }> = [];

const addresses = ownEmailAddressesListResponseSchema.parse({
  emails: [
    {
      id: null,
      email: "ana@gmail.com",
      primary: true,
      signInEnabled: true,
      verifiedAt: "2026-08-01T00:00:00.000Z",
      verificationMethod: "magic_link",
      identityId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: workId,
      email: "ana@work.example",
      primary: false,
      signInEnabled: false,
      verifiedAt: "2026-09-01T00:00:00.000Z",
      verificationMethod: "magic_link",
      identityId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: waitingId,
      email: "ana@waiting.example",
      primary: false,
      signInEnabled: false,
      verifiedAt: null,
      verificationMethod: null,
      identityId: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  page: { limit: 20, offset: 0, total: 3, hasMore: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stub(writeResponse: () => Response, list: unknown = addresses): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = new URL(String(input), location.origin).pathname;
      requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(method === "GET" ? json(list) : writeResponse());
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

async function press(host: HTMLElement, label: string): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

function writes(method: string) {
  return requests.filter((request) => request.method === method);
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

describe("email addresses on the user record", () => {
  it("makes a verified address primary, resends a waiting one's link, and removes after confirmation", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload, origin: window.location.origin });
    stub(() => json({ success: true }));
    const host = mount(<EmailAddressesPanel userId={USER_ID} isSelf primaryEmail="ana@gmail.com" />);
    await settle();
    // Expected states are plain text: a verified address wears a quiet mark, a waiting one says so.
    expect(host.textContent).toContain("Primary");
    expect(host.textContent).toContain("Not verified yet");
    expect(host.querySelectorAll('svg[role="img"][aria-label="Verified"]')).toHaveLength(2);
    expect(host.querySelector(".pk-badge")).toBeNull();
    // The primary address has no commands of its own.
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.getAttribute("aria-label") === "Actions for ana@gmail.com",
      ),
    ).toBe(false);

    await press(host, "Actions for ana@work.example");
    await press(host, "Make primary");
    const [primary] = writes("PATCH");
    expect(primary?.path).toBe(`/api/v1/users/current/emails/${workId}`);
    expect(ownEmailAddressUpdateSchema.parse(primary!.body)).toEqual({ primary: true });

    await press(host, "Actions for ana@waiting.example");
    await press(host, "Resend verification");
    expect(writes("POST").map((request) => request.path)).toEqual([
      `/api/v1/users/current/emails/${waitingId}/verification`,
    ]);

    await press(host, "Actions for ana@waiting.example");
    await press(host, "Remove");
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(writes("DELETE").map((request) => request.path)).toEqual([`/api/v1/users/current/emails/${waitingId}`]);
  });

  it("offers adding an address from the panel menu, and nothing for the primary address's row", async () => {
    stub(() => json({ success: true }));
    const host = mount(<EmailAddressesPanel userId={USER_ID} isSelf primaryEmail="ana@gmail.com" />);
    await settle();
    await press(host, "Email addresses actions");
    await press(host, "Add email address");
    expect(navigate).toHaveBeenCalledWith(`/users/${USER_ID}/emails/new`);
  });

  it("lets staff add and remove a secondary address, without the person's own commands", async () => {
    const list = {
      emails: [
        {
          id: aliasId,
          userId: USER_ID,
          email: "alias@example.test",
          identityId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      page: { limit: 10, offset: 0, total: 1, hasMore: false },
    };
    stub(() => json({ success: true }), list);
    const host = mount(<EmailAddressesPanel userId={USER_ID} isSelf={false} primaryEmail="primary@example.test" />);
    await settle();
    expect(requests[0]?.path).toBe(`/api/v1/users/${USER_ID}/emails`);
    expect(host.textContent).toContain("primary@example.test");
    expect(host.textContent).toContain("alias@example.test");
    expect(host.querySelector('[aria-label="Verified"]')).toBeNull();

    await press(host, "Actions for alias@example.test");
    const items = Array.from(host.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent);
    expect(items).toEqual(["Remove"]);
    await press(host, "Remove");
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(writes("DELETE").map((request) => request.path)).toEqual([`/api/v1/users/${USER_ID}/emails/${aliasId}`]);
  });

  it("adds a secondary address to another user's record through the same form", async () => {
    stub(() =>
      json(
        {
          email: {
            id: aliasId,
            userId: USER_ID,
            email: "alias@example.test",
            identityId: null,
            createdAt: "2026-10-10T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const host = mount(<EmailAddressAddForm userId={USER_ID} isSelf={false} />);
    await settle();
    const input = host.querySelector<HTMLInputElement>('[name="email"]')!;
    await act(async () => {
      input.value = "alias@example.test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(host, "Add email address");
    const [sent] = writes("POST");
    expect(sent?.path).toBe(`/api/v1/users/${USER_ID}/emails`);
    expect(userEmailAddSchema.parse(sent!.body)).toEqual({ email: "alias@example.test" });
    expect(navigate).toHaveBeenCalledWith(`/users/${USER_ID}`);
  });

  it("adds an address through its own form and returns to the user record", async () => {
    stub(() => json({ status: "verification_sent", email: "ana@new.example", requestId: waitingId }, 202));
    const host = mount(<EmailAddressAddForm userId={USER_ID} isSelf />);
    await settle();
    const input = host.querySelector<HTMLInputElement>('[name="email"]')!;
    await act(async () => {
      input.value = "Ana@New.example";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(host, "Send verification link");
    const [sent] = writes("POST");
    expect(sent?.path).toBe("/api/v1/users/current/emails");
    expect(userEmailAddSchema.parse(sent!.body)).toEqual({ email: "ana@new.example" });
    expect(navigate).toHaveBeenCalledWith(`/users/${USER_ID}`);
  });

  it("previews the mailbox link, names its destination account, and confirms only on an explicit click", async () => {
    window.location.hash = "#/email-verifications?token=pkc1_verification-token";
    const responses: unknown[] = [
      { email: "ana@member.example", accountEmail: "ana@gmail.com", consolidatesUnverifiedAccount: false },
      { email: "ana@member.example", joinedOrganization: null, offeredOrganization: { id: workId, name: "Member Co" } },
    ];
    stub(() => json(responses.shift()));
    const host = mount(<EmailVerificationConfirmation />);
    await settle();
    // A mail scanner opening the link only previews it.
    expect(writes("POST").map((request) => request.path)).toEqual(["/api/v1/auth/email-verifications/preview"]);
    expect(host.textContent).toContain("ana@member.example");

    await press(host, "Verify this address");
    const [, redeemed] = writes("POST");
    expect(redeemed?.path).toBe("/api/v1/auth/email-verifications");
    expect(ownEmailAddressVerificationSchema.parse(redeemed!.body)).toEqual({ token: "pkc1_verification-token" });
    const signIn = Array.from(host.querySelectorAll("a")).find((link) => link.textContent?.includes("Sign in to join"));
    expect(signIn?.textContent).toBe("Sign in to join Member Co");
    // The spent link leaves the address bar.
    expect(window.location.hash).toBe("#/email-verifications");
  });
  it("requires an explicit consolidation confirmation for a wholly unverified account", async () => {
    window.location.hash = "#/email-verifications?token=pkc1_consolidation-token";
    const responses = [
      { email: "ana@member.example", accountEmail: "ana@gmail.com", consolidatesUnverifiedAccount: true },
      { email: "ana@member.example", joinedOrganization: null, offeredOrganization: null },
    ];
    stub(() => json(responses.shift()));
    const host = mount(<EmailVerificationConfirmation />);
    await settle();
    expect(writes("POST")).toHaveLength(1);
    expect(host.textContent).toContain("previous permissions will not be transferred");
    await press(host, "Consolidate into my account");
    expect(ownEmailAddressVerificationSchema.parse(writes("POST")[1]!.body)).toEqual({
      token: "pkc1_consolidation-token",
      consolidateUnverifiedAccount: true,
    });
  });
  it("says an address verified on another account can be used there or combined, without naming that account", async () => {
    window.location.hash = "#/email-verifications?token=pkc1_elsewhere-token";
    stub(() => json({ error: EMAIL_VERIFIED_ELSEWHERE }, 409));
    const host = mount(<EmailVerificationConfirmation />);
    await settle();
    expect(host.textContent).toContain(EMAIL_VERIFIED_ELSEWHERE.message);
    expect(host.textContent).not.toContain("expired");
  });
});
