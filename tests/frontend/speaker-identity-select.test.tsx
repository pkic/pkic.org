// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalOwnIdentitySelect } from "../../assets/ts/components/ProposalOwnIdentitySelect";
import { SpeakerIdentitySelect } from "../../assets/ts/components/SpeakerIdentitySelect";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";

const OWNER = "00000000-0000-4000-8000-000000000041";
const NOW = "2026-01-01T00:00:00.000Z";
let host: HTMLDivElement;

function installApi(signedIn = true): string[] {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      requests.push(url.pathname);
      if (!signedIn && url.pathname === "/api/v1/auth/session")
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        );
      const body =
        url.pathname === "/api/v1/auth/session"
          ? userAuthSessionResponseSchema.parse({
              success: true,
              sessionId: "00000000-0000-4000-8000-000000000045",
              identity: { id: OWNER, email: "ada@example.test" },
              eventParticipation: true,
              expiresAt: "2099-12-31T23:59:59.000Z",
              idleExpiresAt: "2099-12-31T23:59:59.000Z",
            })
          : identitiesListResponseSchema.parse({
              identities: [
                {
                  id: "00000000-0000-4000-8000-000000000042",
                  memberId: OWNER,
                  organizationId: OWNER,
                  organizationName: "Example Labs",
                  membershipCategory: "full",
                  userId: OWNER,
                  userName: "Ada Lovelace",
                  emailId: null,
                  email: "ada@example.test",
                  jobTitle: "Engineer",
                  biography: null,
                  links: [],
                  headshotUrl: null,
                  source: "membership_approval",
                  state: "active",
                  showOnOrganizationProfile: true,
                  invitedAt: NOW,
                  startedAt: NOW,
                  endedAt: null,
                  blockedAt: null,
                  blockedByUserId: null,
                  predecessorIdentityId: null,
                  createdAt: NOW,
                  updatedAt: NOW,
                },
              ],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            });
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    }),
  );
  return requests;
}

function mountForm(): HTMLFormElement {
  document.body.innerHTML =
    '<form><input name="email" value="ada@example.test"><input name="speaker.1.email"><div></div></form>';
  host = document.querySelector("div")!;
  return document.querySelector("form")!;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  render(null, host);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("speaker identity authority", () => {
  it("does not discover guest or co-speaker identities from typed emails", async () => {
    const form = mountForm();
    const requests = installApi(false);
    const onChange = vi.fn();
    await act(() => render(<ProposalOwnIdentitySelect form={form} onChange={onChange} />, host));
    const email = form.elements.namedItem("speaker.1.email") as HTMLInputElement;
    await act(() => {
      email.value = "other@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(requests).toEqual(["/api/v1/auth/session"]);
    expect(host.querySelector('[role="combobox"]')).toBeNull();
  });

  it("makes no initial choice and clears a choice when the proposer actor changes", async () => {
    const form = mountForm();
    const requests = installApi();
    const onChange = vi.fn();
    await act(() => render(<ProposalOwnIdentitySelect form={form} onChange={onChange} />, host));
    await vi.waitFor(() => expect(host.querySelector('[role="combobox"]')).not.toBeNull());
    expect(onChange.mock.calls.every(([choice]) => choice === undefined)).toBe(true);
    await click(host.querySelector('[role="combobox"]')!);
    await vi.waitFor(() => expect(host.querySelector('[role="option"][data-key]:not([data-key=""])')).not.toBeNull());
    await click(host.querySelector('[role="option"][data-key]:not([data-key=""])')!);
    expect(onChange.mock.lastCall?.[0]?.organizationName).toBe("Example Labs");
    const email = form.elements.namedItem("email") as HTMLInputElement;
    await act(() => {
      email.value = "other@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.lastCall).toEqual([undefined]);
    expect(host.querySelector('[role="combobox"]')).toBeNull();
    expect(
      requests.every((path) => path === "/api/v1/auth/session" || path === "/api/v1/users/current/identities"),
    ).toBe(true);
  });

  it("uses only the supplied speaker authority and distinguishes an explicit individual choice", async () => {
    mountForm();
    const requests = installApi();
    const onChange = vi.fn();
    const endpoint = "/api/v1/proposals/speakers/access/verified-token/identities";
    await act(() => render(<SpeakerIdentitySelect endpoint={endpoint} value={undefined} onChange={onChange} />, host));
    const fieldControl = host.querySelector(".pk-field__control")!;
    const stack = fieldControl.querySelector(":scope > .pk-control-stack")!;
    expect(fieldControl.children).toHaveLength(1);
    expect(stack.querySelector('[role="combobox"]')).not.toBeNull();
    expect(stack.textContent).toContain("Representation needs review");
    await click(host.querySelector('[role="combobox"]')!);
    await click(host.querySelector('[role="option"][data-key=""]')!);
    expect(onChange.mock.lastCall).toEqual([null]);
    expect(stack.textContent).toContain("You are participating as an individual.");
    expect(fieldControl.children).toHaveLength(1);
    expect(requests).toEqual([endpoint]);
  });

  it("keeps the chosen speaker's readable identity label after selection and catalog rerenders", async () => {
    mountForm();
    const endpoint = "/api/v1/proposals/speakers/access/verified-token/identities";
    const requests = installApi();
    const onChange = vi.fn();
    await act(() => render(<SpeakerIdentitySelect endpoint={endpoint} value={undefined} onChange={onChange} />, host));
    await click(host.querySelector('[role="combobox"]')!);
    await vi.waitFor(() => expect(host.querySelector('[role="option"][data-key]:not([data-key=""])')).not.toBeNull());
    await click(host.querySelector('[role="option"][data-key]:not([data-key=""])')!);
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input.value).toBe("Example Labs · Engineer · ada@example.test");
    expect(onChange.mock.lastCall?.[0]?.id).toBe("00000000-0000-4000-8000-000000000042");
    await click(input);
    await act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(input.value).toBe("Example Labs · Engineer · ada@example.test");
    expect(requests.every((path) => path === endpoint)).toBe(true);
  });
});
