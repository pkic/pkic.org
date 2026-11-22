// @vitest-environment jsdom
import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identitiesListResponseSchema, identityMutationResponseSchema } from "../../assets/shared/schemas/identity";
import {
  identityAffiliationPreviewResponseSchema,
  identityAffiliationPreviewSchema,
} from "../../assets/shared/schemas/identity-affiliation";
import { userAuthSessionResponseSchema, userSignUpRequestSchema } from "../../assets/shared/schemas/user-auth";
import { myProfileUpdateSchema } from "../../assets/shared/schemas/me";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { RegistrationIdentityField } from "../../assets/ts/components/RegistrationIdentitySelect";
import { RegistrationContactStep } from "../../assets/ts/components/RegistrationContactStep";
import { PERSONAL_ADDRESS_WAITLIST, EMAIL_FIRST_COPY, WORK_EMAIL_STEER } from "../../assets/shared/email-first-copy";
import { emailDomainResponseSchema } from "../../assets/shared/schemas/email-domains";
import { controlFor, buttonNamed } from "./helpers/labeled-control";

const USER_ID = "00000000-0000-4000-8000-000000000041";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000042";
const MEMBER_ID = "00000000-0000-4000-8000-000000000043";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000044";
const NOW = "2026-01-01T00:00:00.000Z";
let host: HTMLDivElement | null = null;

const PERSONAL_IDENTITY_ID = "00000000-0000-4000-8000-000000000099";

function session(organizationName?: string | null, actingIdentityId: string = IDENTITY_ID) {
  // Event participation is an authenticated capacity without membership.
  return userAuthSessionResponseSchema.parse({
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000045",
    expiresAt: "2099-12-31T23:59:59.000Z",
    idleExpiresAt: "2099-12-31T23:59:59.000Z",
    identity: { id: USER_ID, email: "ada@example.test" },
    eventParticipation: true,
    actingIdentityId: organizationName === undefined ? null : actingIdentityId,
    actingIdentities:
      organizationName === undefined
        ? []
        : [
            {
              id: PERSONAL_IDENTITY_ID,
              organizationId: null,
              organizationName: null,
              jobTitle: null,
            },
            {
              id: IDENTITY_ID,
              organizationId: organizationName ? ORGANIZATION_ID : null,
              organizationName,
              jobTitle: "Engineer",
            },
          ],
  });
}

function profile() {
  return { ...portalProfileFixture(portalSessionFixture({})), firstName: "Ada", lastName: "Lovelace" };
}

function identity(organizationName: string | null) {
  return {
    id: IDENTITY_ID,
    memberId: MEMBER_ID,
    organizationId: organizationName ? ORGANIZATION_ID : null,
    organizationName,
    membershipCategory: "full",
    membershipLabel: null,
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

interface Recorded {
  path: string;
  method: string;
  body: unknown;
}

const CONTEXT_TOKEN = "context-token-".padEnd(40, "x");

/** The domain's organizations as the shared affiliation preview answers them; null fails the preview. */
function affiliationPreview(
  organizations: { id: string; name: string }[] | null,
  prepare = false,
  personalAddress = false,
) {
  return organizations
    ? identityAffiliationPreviewResponseSchema.parse({
        email: "ada@example.test",
        domain: "example.test",
        domains: [{ domain: "example.test", canLink: true, organizationName: null }],
        organization: null,
        organizations: organizations.map((item) => ({ ...item, identityId: null, jobTitle: null })),
        contextToken: prepare ? CONTEXT_TOKEN : undefined,
        personalAddress,
      })
    : null;
}

/**
 * `signedIn` false answers the session with 401; `organizationName` undefined holds no identity.
 * `organizations` is what the domain resolves to for an account without an organization identity.
 * `personalAddress` is the Worker's answer that the person said at sign-in the address is personal.
 */
function installResponses(
  organizationName: string | null | undefined,
  signedIn = true,
  actingIdentityId: string = IDENTITY_ID,
  organizations: { id: string; name: string }[] | null = null,
  personalAddress = false,
): Recorded[] {
  const recorded: Recorded[] = [];
  let saved = profile();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      recorded.push({
        path: url.pathname,
        method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      let body: unknown;
      let status = 200;
      if (url.pathname === "/api/v1/users/current/identities/preview") {
        const input = identityAffiliationPreviewSchema.parse(JSON.parse(String(init.body)));
        body = affiliationPreview(organizations, input.phase === "prepare", personalAddress) ?? {
          error: { code: "UNAVAILABLE", message: "Unavailable" },
        };
        status = organizations ? 200 : 503;
      } else if (url.pathname === "/api/v1/users/current/identities" && method === "POST") {
        // The confirmed organization becomes the account's organization identity.
        organizationName = organizations?.[0]?.name ?? null;
        actingIdentityId = IDENTITY_ID;
        body = identityMutationResponseSchema.parse({ success: true, identityId: IDENTITY_ID, state: "active" });
      } else if (url.pathname === "/api/v1/auth/session") {
        body = signedIn
          ? session(organizationName, actingIdentityId)
          : { error: { code: "UNAUTHORIZED", message: "Sign in" } };
        status = signedIn ? 200 : 401;
      } else if (url.pathname === "/api/v1/auth/sign-up") body = { success: true };
      else if (url.pathname === "/api/v1/users/current") {
        if (method === "PATCH") saved = { ...saved, ...myProfileUpdateSchema.parse(JSON.parse(String(init.body))) };
        body = saved;
      } else if (url.pathname.startsWith("/api/v1/email/domains/")) {
        // The server's lists; the browser only ever sees this answer.
        const domain = decodeURIComponent(url.pathname.slice("/api/v1/email/domains/".length));
        body = emailDomainResponseSchema.parse({ domain, kind: domain === "ziggo.nl" ? "free" : "work" });
      } else if (url.pathname === "/api/v1/users/current/identities") {
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
      } else {
        // The component catches a refused fetch, so a stray request is recorded and failed in teardown.
        unexpectedRequests.push(`${method} ${url.pathname}`);
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return recorded;
}

async function settle() {
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** The sign-in card's place beside the form, as the registration flow provides it. */
const signInSlot = createRef<HTMLDivElement>();

async function mount(node: preact.ComponentChild): Promise<HTMLFormElement> {
  host = document.createElement("div");
  document.body.append(host);
  const slot = document.createElement("div");
  signInSlot.current = slot;
  const form = document.createElement("form");
  const mountPoint = document.createElement("div");
  form.append(mountPoint);
  host.append(slot, form);
  await act(async () => {
    render(node, mountPoint);
  });
  await settle();
  return form;
}

function value(form: HTMLFormElement, name: string): string | undefined {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.value;
}

const copy = EMAIL_FIRST_COPY.registration;

const unexpectedRequests: string[] = [];

afterEach(() => {
  history.replaceState({}, "", "/");
  if (host) render(null, host.querySelector("form > div")!);
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  const stray = unexpectedRequests.splice(0);
  expect(stray, "requests no stub answers").toEqual([]);
});

function contactStep(
  onReadyChange: (ready: boolean) => void = () => {},
  onSignInChange?: (shown: boolean) => void,
  onRepresentationMissingChange?: (missing: boolean) => void,
  confirmRepresentation?: { current: (() => Promise<boolean>) | null },
) {
  return (
    <RegistrationContactStep
      signInSlot={signInSlot}
      onReadyChange={onReadyChange}
      onSignInChange={onSignInChange}
      onRepresentationMissingChange={onRepresentationMissingChange}
      confirmRepresentation={confirmRepresentation}
    />
  );
}

describe("registration contact step", () => {
  it("hands a signed-out visitor the sign-in card beside the form, returning to this registration", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/?ref=AB12CD");
    const recorded = installResponses(undefined, false);
    let ready = true;
    let signingIn = false;
    const form = await mount(
      contactStep(
        (next) => (ready = next),
        (next) => (signingIn = next),
      ),
    );
    const card = signInSlot.current!.querySelector<HTMLElement>('section[aria-label="Sign in"]')!;
    expect(card).not.toBeNull();
    // The card owns a form, so it stays outside the registration form and nothing is asked there yet.
    expect(form.contains(card)).toBe(false);
    expect(form.querySelector("input")).toBeNull();
    expect(ready).toBe(false);
    expect(signingIn).toBe(true);

    await act(async () => buttonNamed(card, "Start registration")!.click());
    await act(() => {
      const control = controlFor(card, copy.work.label);
      control.value = "Ada@Example.test";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => document.querySelector<HTMLInputElement>('input[name="acceptsAccountPolicies"]')!.click());
    await act(async () => buttonNamed(card, copy.work.action)!.click());
    await settle();
    const signUp = recorded.find((request) => request.path === "/api/v1/auth/sign-up");
    expect(userSignUpRequestSchema.parse(signUp!.body)).toMatchObject({
      email: "ada@example.test",
      returnPath: "/events/2026/pqc/register/?ref=AB12CD",
    });
    expect(card.textContent).toContain(copy.sent("ada@example.test"));
    expect(ready).toBe(false);
  });

  it("continues a signed-in person with their saved details and selects their organization", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    installResponses("Example Corp");
    let ready = false;
    let signingIn = true;
    const form = await mount(
      contactStep(
        (next) => (ready = next),
        (next) => (signingIn = next),
      ),
    );
    expect(signInSlot.current!.childElementCount).toBe(0);
    expect(signingIn).toBe(false);
    expect(ready).toBe(true);
    expect(value(form, "email")).toBe("ada@example.test");
    // The names are the account's own: shown, never posted with the registration.
    expect(form.querySelector('input[name="firstName"], input[name="lastName"]')).toBeNull();
    expect(form.textContent).toContain("Ada Lovelace");
    expect(form.textContent).toContain("Example Corp");
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
    expect(form.querySelector('[role="combobox"]')).toBeNull();
    expect(form.querySelector('button[aria-label="Change representation"]')).not.toBeNull();
  });

  it("confirms the domain's only organization in place for a work address with no organization yet", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    const recorded = installResponses(null, true, PERSONAL_IDENTITY_ID, [
      { id: ORGANIZATION_ID, name: "Example Corp" },
    ]);
    let missing = true;
    const confirm: { current: (() => Promise<boolean>) | null } = { current: null };
    const form = await mount(contactStep(undefined, undefined, (next) => (missing = next), confirm));
    // The shared organization details select the only organization; the job title is still asked.
    expect(controlFor(form, "Organization").value).toBe(ORGANIZATION_ID);
    expect(value(form, "organizationRepresentationMissing")).toBe("false");
    expect(missing).toBe(false);
    expect(confirm.current).not.toBeNull();

    // Without a job title, nothing is created and the step stays put.
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await confirm.current!();
    });
    expect(confirmed).toBe(false);
    expect(
      recorded.some((request) => request.method === "POST" && request.path === "/api/v1/users/current/identities"),
    ).toBe(false);

    await act(() => {
      const control = controlFor(form, "Job title");
      control.value = "Engineer";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      confirmed = await confirm.current!();
    });
    await settle();
    expect(confirmed).toBe(true);
    const created = recorded.find(
      (request) => request.method === "POST" && request.path === "/api/v1/users/current/identities",
    );
    expect(created?.body).toEqual({ contextToken: CONTEXT_TOKEN });
    expect(confirm.current).toBeNull();
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
    expect(form.textContent).toContain("Example Corp");
  });

  it("keeps a work address from registering as the personal identity a new account starts with", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    // The domain's organizations could not be read, so the shared chooser is the way to one.
    installResponses(null);
    let missing = false;
    const form = await mount(contactStep(undefined, undefined, (next) => (missing = next)));
    // Nothing is selected for it, so the flow holds Continue until an organization is.
    expect(missing).toBe(true);
    expect(value(form, "identityId")).toBe("");
    expect(value(form, "organizationRepresentationMissing")).toBe("true");
    expect(form.textContent).toContain("Select your organization");
    expect(form.textContent).not.toContain("Personal");

    // The shared representation chooser is the one way to add the organization.
    await act(async () => form.querySelector<HTMLButtonElement>('button[aria-label="Change representation"]')!.click());
    await settle();
    const chooser = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(form.contains(chooser)).toBe(false);
    expect(chooser.querySelector('button[aria-label="Add identity"]')).not.toBeNull();
  });

  it("registers a work address the person said is personal at sign-in as their personal identity", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    // The domain resolves to an organization nobody has claimed; the person already said the address is personal.
    installResponses(null, true, PERSONAL_IDENTITY_ID, [{ id: ORGANIZATION_ID, name: "Example Corp" }], true);
    let missing = true;
    const confirm: { current: (() => Promise<boolean>) | null } = { current: null };
    const form = await mount(contactStep(undefined, undefined, (next) => (missing = next), confirm));
    expect(missing).toBe(false);
    expect(confirm.current).toBeNull();
    expect(value(form, "identityId")).toBe(PERSONAL_IDENTITY_ID);
    expect(value(form, "unaffiliatedAttestation")).toBe("true");
    expect(value(form, "organizationRepresentationMissing")).toBe("false");
    expect(form.querySelector('[name="organizationName"], [name="jobTitle"]')).toBeNull();
    expect(form.textContent).not.toContain("Job title");
    expect(form.textContent).not.toContain("uses an organization domain");
  });

  it("selects the organization a work address most likely registers for while the session acts personally", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    installResponses("Example Corp", true, PERSONAL_IDENTITY_ID);
    let missing = true;
    const form = await mount(contactStep(undefined, undefined, (next) => (missing = next)));
    expect(missing).toBe(false);
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
    expect(value(form, "organizationRepresentationMissing")).toBe("false");
    expect(form.textContent).toContain("Example Corp");
  });

  it("corrects a saved name through the shared editor on the signed-in person's own profile", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    const requests = installResponses("Example Corp");
    const form = await mount(contactStep());
    await act(() => form.querySelector<HTMLButtonElement>('button[aria-label="Edit personal details"]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(dialog).not.toBeNull();
    expect(form.contains(dialog)).toBe(false);
    await act(() => {
      const first = controlFor(dialog, "First name");
      first.value = "Zoë";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed(dialog, "Save my details")!.click());
    await settle();
    expect(form.textContent).toContain("Zoë Lovelace");
    const patch = requests.find((request) => request.path === "/api/v1/users/current" && request.method === "PATCH");
    expect(myProfileUpdateSchema.parse(patch!.body)).toMatchObject({ firstName: "Zoë", lastName: "Lovelace" });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});

describe("signed-in registration identity", () => {
  it.each([null, "Example Corp"])("warns only for a personal representation (%s)", async (organization) => {
    const form = await mount(<RegistrationIdentityField preferred={identity(organization)} />);
    const warning = form.querySelector<HTMLElement>('[role="img"]');
    if (organization) expect(warning).toBeNull();
    else {
      expect(warning?.title).toContain(WORK_EMAIL_STEER);
      expect(warning?.title).toContain(PERSONAL_ADDRESS_WAITLIST);
      expect(warning?.getAttribute("aria-label")).toBe(warning?.title);
      expect(warning?.tabIndex).toBe(0);
    }
  });
  it("offers an existing organization identity", async () => {
    installResponses("Example Corp");
    const onSelect = vi.fn();
    const form = await mount(
      <RegistrationIdentityField presentation="picker" available={[identity("Example Corp")]} onSelect={onSelect} />,
    );
    const combobox = form.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(combobox).not.toBeNull();
    await act(async () => {
      combobox!.click();
    });
    expect(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith("Example Corp"),
      ),
    ).toBe(true);
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.startsWith("Example Corp"),
    )!;
    await act(() => option.click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: IDENTITY_ID }));
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
  });

  it("keeps the sign-in representation visible while offering the other representation", async () => {
    const current = { ...identity("PKI Consortium"), id: "00000000-0000-4000-8000-000000000088" };
    const alternative = identity("Digitorus");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              identitiesListResponseSchema.parse({
                identities: [alternative, current],
                page: { limit: 25, offset: 0, total: 2, hasMore: false },
              }),
            ),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const onSelect = vi.fn();
    const form = await mount(
      <RegistrationIdentityField
        preferred={current}
        available={[current, alternative]}
        onSelect={onSelect}
        userId={USER_ID}
      />,
    );
    expect(value(form, "identityId")).toBe(current.id);
    expect(form.textContent).toContain("PKI Consortium");
    expect(form.querySelector('[role="combobox"]')).toBeNull();
    await act(() => form.querySelector<HTMLButtonElement>('button[aria-label="Change representation"]')!.click());
    const chooser = document.querySelector<HTMLButtonElement>('dialog[open] [role="combobox"]')!;
    expect(chooser.tagName).toBe("BUTTON");
    await act(() => chooser.click());
    await settle();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.some((option) => option.textContent?.includes("PKI Consortium"))).toBe(true);
    const digitorus = options.find((option) => option.textContent?.includes("Digitorus"))!;
    await act(() => digitorus.click());
    expect(value(form, "identityId")).toBe(current.id);
    expect(onSelect).not.toHaveBeenCalled();
    await act(() =>
      [...document.querySelectorAll<HTMLButtonElement>("dialog[open] button")]
        .find((button) => button.textContent === "Use representation")!
        .click(),
    );
    expect(value(form, "identityId")).toBe(alternative.id);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: alternative.id }));
    expect(form.textContent).toContain("Digitorus");
    await vi.waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
  });

  it("opens the existing creation form from the plus action without nesting forms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ emails: [] }), { headers: { "content-type": "application/json" } }),
      ),
    );
    const preferred = {
      id: IDENTITY_ID,
      organizationId: null,
      organizationName: null,
      jobTitle: null,
      membershipCategory: null,
      membershipLabel: null,
    };
    const form = await mount(
      <RegistrationIdentityField presentation="picker" preferred={preferred} userId={USER_ID} />,
    );
    const add = form.querySelector<HTMLButtonElement>('button[aria-label="Add identity"]')!;
    await act(() => add.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('form[aria-label="Add email address"]')).not.toBeNull();
    expect(dialog.closest("form")).toBeNull();
    expect(form.querySelector("form")).toBeNull();
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
  });

  it("keeps the only identity selected and hides an empty change action", async () => {
    installResponses(null);
    const form = await mount(
      <RegistrationIdentityField
        preferred={{
          id: IDENTITY_ID,
          organizationId: null,
          organizationName: null,
          jobTitle: null,
          membershipCategory: null,
          membershipLabel: null,
        }}
      />,
    );
    expect(form.querySelector('[role="combobox"]')).toBeNull();
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
  });
});
