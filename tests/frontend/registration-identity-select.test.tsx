// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../assets/shared/schemas/user-management";
import { RegistrationIdentitySelect } from "../../assets/ts/components/RegistrationIdentitySelect";

const USER_ID = "00000000-0000-4000-8000-000000000041";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000042";
const MEMBER_ID = "00000000-0000-4000-8000-000000000043";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000044";
const NOW = "2026-01-01T00:00:00.000Z";
let host: HTMLDivElement | null = null;

function session() {
  // Event participation is an authenticated capacity without membership.
  return userAuthSessionResponseSchema.parse({
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000045",
    expiresAt: "2099-12-31T23:59:59.000Z",
    idleExpiresAt: "2099-12-31T23:59:59.000Z",
    identity: { id: USER_ID, email: "ada@example.test" },
    eventParticipation: true,
  });
}

function profile() {
  return userDetailResponseSchema.parse({
    user: {
      id: USER_ID,
      email: "ada@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      preferred_name: null,
      role: "user",
      active: true,
      isEcMember: false,
      created_at: NOW,
      updated_at: NOW,
      pii_redacted_at: null,
      headshotUrl: null,
      identities: [],
      formerIdentities: [],
    },
  });
}

function identity(organizationName: string | null) {
  return {
    id: IDENTITY_ID,
    memberId: MEMBER_ID,
    organizationId: organizationName ? ORGANIZATION_ID : null,
    organizationName,
    membershipCategory: "full",
    userId: USER_ID,
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
  };
}

function installResponses(organizationName: string | null | undefined): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      let body: unknown;
      if (url.pathname === "/api/v1/auth/session") body = session();
      else if (url.pathname === `/api/v1/users/${USER_ID}`) body = profile();
      else if (url.pathname === "/api/v1/users/current/identities") {
        const identities = organizationName === undefined ? [] : [identity(organizationName)];
        body = identitiesListResponseSchema.parse({
          identities,
          page: {
            limit: Number(url.searchParams.get("limit") ?? 50),
            offset: 0,
            total: identities.length,
            hasMore: false,
          },
        });
      } else throw new Error(`Unexpected request: ${url.pathname}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

async function mount(
  initial: Partial<Record<"firstName" | "lastName" | "email", string>> = {},
  deferUntilRequested = false,
) {
  host = document.createElement("div");
  document.body.append(host);
  const form = document.createElement("form");
  for (const name of ["firstName", "lastName", "email", "custom.organization_name", "custom.job_title"]) {
    const input = document.createElement("input");
    input.name = name;
    input.value = initial[name as keyof typeof initial] ?? "";
    form.append(input);
  }
  const mountPoint = document.createElement("div");
  form.append(mountPoint);
  host.append(form);
  await act(async () => {
    render(<RegistrationIdentitySelect form={form} deferUntilRequested={deferUntilRequested} />, mountPoint);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return form;
}

function value(form: HTMLFormElement, name: string): string {
  return (form.elements.namedItem(name) as HTMLInputElement).value;
}

afterEach(() => {
  if (host) render(null, host.querySelector("form > div")!);
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe("event registration identity", () => {
  it("makes no anonymous session request until the visitor asks to use a saved profile", async () => {
    installResponses(undefined);
    const form = await mount({}, true);
    expect(fetch).not.toHaveBeenCalled();
    const button = host!.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Use saved profile");
    await act(async () => button.click());
    await vi.waitFor(() => expect(value(form, "email")).toBe("ada@example.test"));
  });

  it("shows pending feedback and keeps typed details when the session is signed out", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const form = await mount({ firstName: "Chosen", email: "chosen@example.test" }, true);
    await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
    const button = host!.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("Loading saved profile");
    await act(async () =>
      finish(
        new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Sign in" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(host!.querySelector('[role="status"]')?.textContent).toContain("You are not signed in"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(value(form, "firstName")).toBe("Chosen");
    expect(value(form, "email")).toBe("chosen@example.test");
  });

  it("distinguishes a connection failure, supports retry and confirms saved details without overwriting input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    const form = await mount({ firstName: "Chosen", email: "chosen@example.test" }, true);
    await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
    await vi.waitFor(() => expect(host!.querySelector('[role="alert"]')?.textContent).toContain("We could not load"));
    expect(host!.textContent).not.toContain("You are not signed in");
    installResponses(undefined);
    await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
    await vi.waitFor(() =>
      expect(host!.querySelector('[role="status"]')?.textContent).toContain("Your saved profile is ready"),
    );
    expect(value(form, "firstName")).toBe("Chosen");
    expect(value(form, "email")).toBe("chosen@example.test");
    expect(value(form, "lastName")).toBe("Lovelace");
  });

  it("prefills a signed-in nonmember and hides an empty selector", async () => {
    installResponses(undefined);
    const form = await mount();
    expect(value(form, "firstName")).toBe("Ada");
    expect(value(form, "lastName")).toBe("Lovelace");
    expect(value(form, "email")).toBe("ada@example.test");
    expect(form.querySelector('[role="combobox"]')).toBeNull();
  });

  it("preserves details already entered and hides a lone individual identity", async () => {
    installResponses(null);
    const form = await mount({ firstName: "Chosen", email: "alternate@example.test" });
    expect(value(form, "firstName")).toBe("Chosen");
    expect(value(form, "lastName")).toBe("Lovelace");
    expect(value(form, "email")).toBe("alternate@example.test");
    expect(form.querySelector('[role="combobox"]')).toBeNull();
  });

  it("offers an existing organization identity to a signed-in nonmember", async () => {
    installResponses("Example Corp");
    const form = await mount();
    const combobox = form.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(combobox).not.toBeNull();
    await act(async () => {
      combobox!.click();
    });
    expect(
      [...document.querySelectorAll('[role="option"]')].some((option) => option.textContent === "Example Corp"),
    ).toBe(true);
  });
});
