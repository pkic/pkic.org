// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalAddressPrompt } from "../../assets/ts/components/events/PersonalAddressPrompt";
import {
  ACCOUNT_EMAIL_ADDRESSES_HREF,
  PERSONAL_ADDRESS_FOLLOW_UP_COPY,
  PERSONAL_ADDRESS_WAITLIST_COPY,
} from "../../assets/shared/email-first-copy";
import { emailDomainResponseSchema } from "../../assets/shared/schemas/email-domains";

/** The server's lists, which the browser only sees through this answer. */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      const domain = decodeURIComponent(path.slice("/api/v1/email/domains/".length));
      const body = emailDomainResponseSchema.parse({ domain, kind: domain === "gmail.com" ? "free" : "work" });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

let host: HTMLDivElement | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

async function mount(email: string, waiting = false) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<PersonalAddressPrompt email={email} waiting={waiting} />, host!));
  // Let the classification answer land.
  for (let round = 0; round < 3; round += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return host;
}

describe("personal address follow-up", () => {
  it("asks a personal-address registrant to add a work address in account settings", async () => {
    const root = await mount("ada@gmail.com");
    expect(root.textContent).toContain(PERSONAL_ADDRESS_FOLLOW_UP_COPY.body);
    const link = root.querySelector("a")!;
    expect(link.textContent).toBe(PERSONAL_ADDRESS_FOLLOW_UP_COPY.action);
    expect(link.getAttribute("href")).toBe(ACCOUNT_EMAIL_ADDRESSES_HREF);
    expect(root.textContent).not.toMatch(/sponsor/i);
  });

  it("tells a waiting personal-address registrant they are handled last and how to regain their place", async () => {
    const root = await mount("ada@gmail.com", true);
    expect(root.textContent).toContain(PERSONAL_ADDRESS_WAITLIST_COPY.title);
    expect(root.textContent).toContain(PERSONAL_ADDRESS_WAITLIST_COPY.body);
    expect(root.querySelector("a")!.textContent).toBe(PERSONAL_ADDRESS_WAITLIST_COPY.action);
  });

  it("follows the server's verdict over every verified address", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<PersonalAddressPrompt email="ada@gmail.com" withoutWorkAddress={false} waiting />, host!));
    expect(host.textContent).toBe("");
    await act(() => render(<PersonalAddressPrompt withoutWorkAddress waiting />, host!));
    expect(host.textContent).toContain(PERSONAL_ADDRESS_WAITLIST_COPY.title);
  });

  it("stays silent for a work address", async () => {
    expect((await mount("ada@organization.example", true)).textContent).toBe("");
  });
});
