// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  registrationProofPersonPatchSchema,
  registrationEmailProofStartSchema,
  registrationEmailProofVerifyResponseSchema,
  registrationEmailProofVerifySchema,
} from "../../assets/shared/schemas/registration-email-proof";
import type { ConfirmOrganizationController } from "../../assets/ts/components/RegistrationConfirmOrganization";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { RegistrationIdentityField } from "../../assets/ts/components/RegistrationIdentitySelect";
import { RegistrationContactStep } from "../../assets/ts/components/RegistrationContactStep";
import {
  PERSONAL_ADDRESS_WAITLIST,
  EMAIL_FIRST_ADVISORY_COPY,
  EMAIL_FIRST_COPY,
  WORK_EMAIL_STEER,
} from "../../assets/shared/email-first-copy";
import { emailDomainResponseSchema } from "../../assets/shared/schemas/email-domains";
import { controlFor, buttonNamed } from "./helpers/labeled-control";

const USER_ID = "00000000-0000-4000-8000-000000000041";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000042";
const MEMBER_ID = "00000000-0000-4000-8000-000000000043";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000044";
const NOW = "2026-01-01T00:00:00.000Z";
let host: HTMLDivElement | null = null;

function session(organizationName?: string | null) {
  // Event participation is an authenticated capacity without membership.
  return userAuthSessionResponseSchema.parse({
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000045",
    expiresAt: "2099-12-31T23:59:59.000Z",
    idleExpiresAt: "2099-12-31T23:59:59.000Z",
    identity: { id: USER_ID, email: "ada@example.test" },
    eventParticipation: true,
    actingIdentityId: organizationName === undefined ? null : IDENTITY_ID,
    actingIdentities:
      organizationName === undefined
        ? []
        : [
            {
              id: "00000000-0000-4000-8000-000000000099",
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
  query: URLSearchParams;
  body: unknown;
}

/** `signedIn` false answers the session with 401; `organizationName` undefined holds no identity. */
function installResponses(
  organizationName: string | null | undefined,
  signedIn = true,
  verifiedPerson: { firstName: string | null; lastName: string | null } | null = null,
  asksOrganization = false,
): Recorded[] {
  const recorded: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      recorded.push({
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      let body: unknown;
      let status = 200;
      if (url.pathname === "/api/v1/auth/session") {
        body = signedIn ? session(organizationName) : { error: { code: "UNAUTHORIZED", message: "Sign in" } };
        status = signedIn ? 200 : 401;
      } else if (url.pathname.endsWith("/registrations/proof")) body = { status: "verification_sent" };
      else if (url.pathname.endsWith("/registrations/proof/verify"))
        body = registrationEmailProofVerifyResponseSchema.parse({
          email: "ada@example.test",
          unaffiliatedAttestation: false,
          person: verifiedPerson ? { userId: USER_ID, ...verifiedPerson } : null,
          asksOrganization,
          affiliation: asksOrganization
            ? {
                email: "ada@example.test",
                domain: "example.test",
                domains: [{ domain: "example.test", canLink: false, organizationName: null }],
                organization: organizationName ? { id: ORGANIZATION_ID, name: organizationName } : null,
                organizations: organizationName
                  ? [{ id: ORGANIZATION_ID, name: organizationName, identityId: null, jobTitle: null }]
                  : [],
              }
            : null,
        });
      else if (url.pathname.endsWith("/registrations/proof/person")) {
        const patch = registrationProofPersonPatchSchema.parse(JSON.parse(String(init.body)));
        body = { person: { userId: USER_ID, firstName: patch.firstName, lastName: patch.lastName } };
      } else if (url.pathname === "/api/v1/users/current") body = profile();
      else if (url.pathname.startsWith("/api/v1/email/domains/")) {
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
      } else throw new Error(`Unexpected request: ${url.pathname}`);
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

async function mount(node: preact.ComponentChild): Promise<HTMLFormElement> {
  host = document.createElement("div");
  document.body.append(host);
  const form = document.createElement("form");
  const mountPoint = document.createElement("div");
  form.append(mountPoint);
  host.append(form);
  await act(async () => {
    render(node, mountPoint);
  });
  await settle();
  return form;
}

async function continueWith(form: HTMLFormElement, email: string) {
  await act(() => {
    const control = controlFor(form, copy.work.label);
    control.value = email;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...form.querySelectorAll("button")].find((button) => button.textContent === copy.work.action)!.click();
  });
  await settle();
}

function value(form: HTMLFormElement, name: string): string | undefined {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.value;
}

const copy = EMAIL_FIRST_COPY.registration;

afterEach(() => {
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  if (host) render(null, host.querySelector("form > div")!);
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const ENDPOINT = "/api/v1/events/pqc/registrations";
const PROOF_TOKEN = "proof-token-0123456789abcdefghijklmnopqrstuvwxyz";

function contactStep(
  onReadyChange: (ready: boolean) => void = () => {},
  organization: ConfirmOrganizationController = {},
) {
  return (
    <RegistrationContactStep
      endpoint={ENDPOINT}
      entry={{ referralCode: "AB12CD" }}
      organization={organization}
      onReadyChange={onReadyChange}
    />
  );
}

describe("registration contact step", () => {
  it("asks nothing until the visitor continues, then verifies the address before anything else", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/?ref=AB12CD");
    const recorded = installResponses(undefined, false);
    let ready = false;
    const form = await mount(contactStep((next) => (ready = next)));
    expect(recorded).toHaveLength(0);
    expect(form.querySelectorAll('input:not([type="radio"])')).toHaveLength(1);

    await continueWith(form, "Ada@Example.test");
    const proof = recorded.find((request) => request.path === `${ENDPOINT}/proof`);
    expect(registrationEmailProofStartSchema.parse(proof!.body)).toEqual({
      email: "ada@example.test",
      unaffiliatedAttestation: false,
      entry: { referralCode: "AB12CD" },
    });
    expect(form.textContent).toContain(copy.sentTitle);
    expect(form.textContent).toContain(copy.sent("ada@example.test"));
    // Nothing else is asked, and the wizard cannot continue, until the link is opened.
    expect(form.querySelector('input[name="firstName"]')).toBeNull();
    expect(ready).toBe(false);

    await act(async () => buttonNamed(form, copy.changeEmail)!.click());
    expect(controlFor(form, copy.work.label)).not.toBeNull();
  });

  it("continues from the opened link with the address verified and a known person's names filled in", async () => {
    window.history.replaceState({}, "", `/events/2026/pqc/register/?ref=AB12CD#verify=${PROOF_TOKEN}`);
    const recorded = installResponses(undefined, false, { firstName: "Ada", lastName: "Lovelace" });
    let ready = false;
    const form = await mount(contactStep((next) => (ready = next)));
    const verify = recorded.find((request) => request.path === `${ENDPOINT}/proof/verify`);
    expect(registrationEmailProofVerifySchema.parse(verify!.body)).toEqual({ token: PROOF_TOKEN });
    // The token leaves the address bar, so the page can be shared without it.
    expect(location.hash).toBe("");
    expect(location.search).toBe("?ref=AB12CD");
    expect(value(form, "email")).toBe("ada@example.test");
    expect(value(form, "emailProof")).toBe(PROOF_TOKEN);
    expect(value(form, "firstName")).toBe("Ada");
    expect(form.querySelector('input[name="firstName"]')?.getAttribute("type")).toBe("hidden");
    expect(form.textContent).toContain("Ada Lovelace");
    expect(ready).toBe(true);
  });

  it("corrects an invalid saved name through the shared editor without adding names to the registration", async () => {
    history.replaceState({}, "", `/events/2026/pqc/register/#verify=${PROOF_TOKEN}`);
    const requests = installResponses(undefined, false, { firstName: "ZoÃ«", lastName: "Fixture" });
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
    expect(value(form, "firstName")).toBe("Zoë");
    expect(value(form, "lastName")).toBe("Fixture");
    expect(form.textContent).toContain("Zoë Fixture");
    expect(requests.find((request) => request.path.endsWith("/proof/person"))?.body).toEqual({
      token: PROOF_TOKEN,
      userId: USER_ID,
      firstName: "Zoë",
      lastName: "Fixture",
    });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("continues when the link opens in the tab already showing the form", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    installResponses(undefined, false, { firstName: "Ada", lastName: "Lovelace" });
    let ready = false;
    const form = await mount(contactStep((next) => (ready = next)));
    expect(ready).toBe(false);
    await act(async () => {
      window.history.replaceState({}, "", `/events/2026/pqc/register/#verify=${PROOF_TOKEN}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await settle();
    expect(value(form, "emailProof")).toBe(PROOF_TOKEN);
    expect(location.hash).toBe("");
    expect(ready).toBe(true);
  });

  it("asks a verified work address with an unknown domain for its organization and job title", async () => {
    window.history.replaceState({}, "", `/events/2026/pqc/register/#verify=${PROOF_TOKEN}`);
    installResponses(undefined, false, null, true);
    const organization: ConfirmOrganizationController = {};
    const form = await mount(contactStep(() => {}, organization));
    const name = controlFor(form, "Organization name");
    expect(name.readOnly).toBe(false);
    expect(form.querySelector("select")).toBeNull();
    expect(form.querySelector('button[aria-label="Add organization"]')).toBeNull();
    expect(controlFor(form, "First name").value).toBe("");
    let named: ReturnType<NonNullable<ConfirmOrganizationController["read"]>> | undefined;
    await act(() => {
      named = organization.read?.();
    });
    expect(named).toEqual({ refused: true });
    expect(name.getAttribute("aria-invalid")).not.toBe("true");
    await act(() => {
      organization.validate?.();
    });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.parentElement?.querySelector(".pk-field__state")).not.toBeNull();
    await act(() => {
      name.value = "New Organization";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const title = controlFor(form, "Job title");
      title.value = "Researcher";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      named = organization.read?.();
    });
    expect(named).toMatchObject({
      organization: { name: "New Organization", organizationId: null, jobTitle: "Researcher" },
    });
  });

  it("embeds the shared chooser for a verified known domain and clears it when the address changes", async () => {
    window.history.replaceState({}, "", `/events/2026/pqc/register/#verify=${PROOF_TOKEN}`);
    installResponses("Example Corp", false, null, true);
    const organization: ConfirmOrganizationController = {};
    const form = await mount(contactStep(() => {}, organization));
    const choice = controlFor(form, "Organization") as HTMLSelectElement;
    expect(choice.value).toBe(ORGANIZATION_ID);
    const title = controlFor(form, "Job title");
    await act(() => {
      title.value = "Researcher";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let selected: ReturnType<NonNullable<ConfirmOrganizationController["read"]>> | undefined;
    await act(() => {
      selected = organization.read?.();
    });
    expect(selected).toMatchObject({
      organization: { name: "Example Corp", organizationId: ORGANIZATION_ID, jobTitle: "Researcher" },
    });
    expect([...choice.options].some((option) => option.textContent === "Another organization")).toBe(false);
    await act(() => buttonNamed(form, "Add organization").click());
    const dialog = document.querySelector<HTMLElement>("dialog")!;
    expect(dialog).not.toBeNull();
    const name = controlFor(dialog, "Organization name");
    await act(() => {
      name.value = "Another Organization";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => buttonNamed(dialog, "Use organization").click());
    await settle();
    await act(() => {
      selected = organization.read?.();
    });
    expect(selected).toMatchObject({
      organization: { name: "Another Organization", organizationId: null, jobTitle: "Researcher" },
    });
    const editEmail = buttonNamed(form, "Change email address");
    expect(editEmail.closest("dd")?.textContent).toContain("ada@example.test");
    expect(form.querySelectorAll('button[aria-label="Change email address"]')).toHaveLength(1);
    await act(() => editEmail.click());
    await settle();
    expect(organization.read).toBeUndefined();
  });

  it("continues a signed-in person without verifying again and selects their organization", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    const recorded = installResponses("Example Corp");
    const form = await mount(contactStep());
    await continueWith(form, "ada@example.test");
    expect(recorded.some((request) => request.path === `${ENDPOINT}/proof`)).toBe(false);
    expect(form.querySelector('input[name="firstName"]')?.getAttribute("type")).toBe("hidden");
    expect(value(form, "firstName")).toBe("Ada");
    expect(value(form, "lastName")).toBe("Lovelace");
    expect(value(form, "emailProof")).toBeUndefined();
    expect(form.textContent).toContain("Example Corp");
    expect(value(form, "identityId")).toBe(IDENTITY_ID);
    expect(form.querySelector('[role="combobox"]')).toBeNull();
    expect(form.querySelector('button[aria-label="Change representation"]')).not.toBeNull();
  });

  it("steers a free address from the server's answer before sending anything", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    const recorded = installResponses(undefined, false);
    const form = await mount(contactStep());
    await continueWith(form, "ada@ziggo.nl");
    expect(recorded.map((request) => request.path)).toEqual(["/api/v1/email/domains/ziggo.nl"]);
    const field = controlFor(form, copy.work.label).closest(".pk-field")!;
    expect(field.textContent).toContain(WORK_EMAIL_STEER);
    expect(field.classList.contains("pk-field--advisory")).toBe(true);

    await act(async () => buttonNamed(form, EMAIL_FIRST_ADVISORY_COPY.usePersonal)!.click());
    await act(async () => buttonNamed(form, copy.personal.action)!.click());
    await settle();
    const proof = recorded.find((request) => request.path === `${ENDPOINT}/proof`);
    expect(registrationEmailProofStartSchema.parse(proof!.body).unaffiliatedAttestation).toBe(true);
  });

  it("verifies a different address than the signed-in one", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc/register/");
    const recorded = installResponses("Example Corp");
    const form = await mount(contactStep());
    await continueWith(form, "colleague@example.test");
    expect(recorded.some((request) => request.path === `${ENDPOINT}/proof`)).toBe(true);
    expect(value(form, "identityId")).toBeUndefined();
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
