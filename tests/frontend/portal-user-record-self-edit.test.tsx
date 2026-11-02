// @vitest-environment jsdom
/**
 * What the subject edits on their own record: their names in the Account
 * panel, and each identity's job title, biography and links from its row
 * under Affiliations. The user has no profile of its own.
 */
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import type { UserPermissions } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { identitiesListResponseSchema, currentUserIdentityCreateSchema } from "../../assets/shared/schemas/identity";
import { identityAffiliationPreviewSchema } from "../../assets/shared/schemas/identity-affiliation";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/self", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: unknown; href: string }) => <a href={`#${href}`}>{children as never}</a>,
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => false }));

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000077";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000003";

function selfProfile() {
  const result = myProfileSchema.safeParse({
    userId: SELF_ID,
    identityId: IDENTITY_ID,
    emailId: null,
    email: "person@example.test",
    emailAddresses: [],
    firstName: "Patricia",
    lastName: "Person",
    preferredName: null,
    jobTitle: "Engineer",
    biography: null,
    links: [],
    membershipCategory: "A",
    organizationId: ORGANIZATION_ID,
    organizationName: "Example Org",
    memberSince: "2026-01-01",
    showOnOrgProfile: false,
    headshotUrl: null,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: [
      {
        identityId: IDENTITY_ID,
        memberId: "00000000-0000-4000-8000-000000000002",
        organizationId: ORGANIZATION_ID,
        organizationName: "Example Org",
        membershipCategory: "A",
      },
    ],
  });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

const NO_PERMISSIONS: UserPermissions = {
  canRead: false,
  canWrite: false,
  canGrantAccess: false,
  canAnonymize: false,
  canManageMembership: false,
  canActivateIdentity: false,
};

let container: HTMLDivElement;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function record(id: string) {
  return {
    user: {
      id,
      email: id === SELF_ID ? "person@example.test" : "other@example.test",
      first_name: "Pat",
      last_name: "Person",
      preferred_name: null,
      role: "user",
      active: true,
      isEcMember: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pii_redacted_at: null,
      headshotUrl: null,
      identities: [
        {
          identityId: "00000000-0000-4000-8000-000000000003",
          memberId: "00000000-0000-4000-8000-000000000002",
          membershipCategory: "A",
          status: "active",
          showOnOrgProfile: false,
          isDefault: true,
          organizationId: ORGANIZATION_ID,
          organizationName: "Example Org",
          organizationEmailDomain: null,
          emailId: null,
          email: "person@example.test",
          jobTitle: null,
          biography: null,
          links: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          groups: [],
        },
      ],
      formerIdentities: [],
    },
  };
}

/** Answers the record and the account resources; anything else is an empty refusal the panels tolerate. */
function stubApi(pending = false): Array<{ method: string; path: string; body: unknown }> {
  const paths: Array<{ method: string; path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      paths.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.pathname === "/api/v1/users/current/identities" && url.searchParams.get("state") === "pending") {
        const at = "2026-01-01T00:00:00.000Z";
        return json(
          identitiesListResponseSchema.parse({
            identities: pending
              ? [
                  {
                    id: OTHER_ID,
                    memberId: null,
                    organizationId: ORGANIZATION_ID,
                    organizationName: "Invited organization",
                    membershipCategory: null,
                    userId: SELF_ID,
                    userName: "Pat Person",
                    emailId: null,
                    email: "person@example.test",
                    jobTitle: "Representative",
                    biography: null,
                    links: [],
                    headshotUrl: null,
                    source: "staff",
                    state: "pending",
                    showOnOrganizationProfile: true,
                    invitedAt: at,
                    startedAt: null,
                    endedAt: null,
                    blockedAt: null,
                    blockedByUserId: null,
                    predecessorIdentityId: null,
                    createdAt: at,
                    updatedAt: at,
                  },
                ]
              : [],
            page: { limit: 25, offset: 0, total: pending ? 1 : 0, hasMore: false },
          }),
        );
      }
      if (url.pathname === "/api/v1/users/current") {
        return json(selfProfile());
      }
      if (url.pathname.endsWith("/profile") && url.pathname.includes("/identities/")) {
        return json({
          identityId: IDENTITY_ID,
          organizationId: ORGANIZATION_ID,
          organizationName: "Example Org",
          jobTitle: "Engineer",
          biography: null,
          links: [],
        });
      }
      const page = (total: number) => ({ limit: 20, offset: 0, total, hasMore: false });
      if (url.pathname === `/api/v1/users/${SELF_ID}` || url.pathname === `/api/v1/users/${OTHER_ID}`) {
        return json(record(url.pathname.endsWith(SELF_ID) ? SELF_ID : OTHER_ID));
      }
      if (url.pathname === "/api/v1/users/current/emails") {
        return json({
          emails: [
            {
              id: null,
              email: "person@example.test",
              primary: true,
              signInEnabled: true,
              verifiedAt: "2026-08-01T00:00:00.000Z",
              verificationMethod: "magic_link",
              identityId: null,
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          page: page(1),
        });
      }
      if (url.pathname === `/api/v1/users/${OTHER_ID}/emails`) return json({ emails: [], page: page(0) });
      if (url.pathname === "/api/v1/users/current/notifications/preferences") {
        return json({
          workingGroupUpdates: true,
          voteReminders: true,
          generalAnnouncements: true,
          wgChairMembershipDigest: false,
        });
      }
      if (url.pathname === "/api/v1/auth/passkeys") return json({ passkeys: [] });
      if (url.pathname === "/api/v1/users/current/identities/preview") {
        const request = identityAffiliationPreviewSchema.parse(init?.body ? JSON.parse(String(init.body)) : {});
        return json({
          email: "person@example.test",
          domain: "example.test",
          domains: [{ domain: "example.test", canLink: false, organizationName: "Example Org" }],
          organization: { id: ORGANIZATION_ID, name: "Example Org" },
          organizations: [{ id: ORGANIZATION_ID, name: "Example Org", identityId: null, jobTitle: null }],
          ...(request.phase === "prepare" ? { contextToken: "synthetic-prepared-context-for-identity-creation" } : {}),
        });
      }
      if (url.pathname === "/api/v1/users/current/identities") {
        if (init?.method === "POST") return json({ success: true, identityId: IDENTITY_ID, state: "active" }, 201);
        return json({ identities: [], page: page(0) });
      }
      return json({ error: { code: "NOT_FOUND", message: "Not stubbed" } }, 404);
    }),
  );
  return paths;
}

async function mount(userId: string, permissions: UserPermissions): Promise<void> {
  await act(() => render(<UserDetail userId={userId} permissions={permissions} viewerUserId={SELF_ID} />, container));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

beforeEach(() => {
  history.replaceState({}, "", "/");
  // jsdom has the element but not its modal behavior; mirror the platform's open state.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  // A save re-reads the record; let that settle while the stubs still answer.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  void act(() => render(null, container));
  container.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("editing your own record", () => {
  it("shows newly pending invitations even when the session's count is zero", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true, pendingIdentityCount: 0 });
    stubApi(true);
    await mount(SELF_ID, NO_PERMISSIONS);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const panel = container.querySelector('section[aria-label="Identity invitations"]');
    expect(panel?.textContent).toContain("Invited organization");
    const action = panel!.querySelector<HTMLButtonElement>('button[aria-label="Actions for Invited organization"]');
    expect(action).not.toBeNull();
    await act(async () => action!.click());
    expect(panel!.querySelector('[role="menuitem"]')?.textContent).toBe("Accept identity");
  });

  it("has no profile panel; the names are account facts shown in the Account panel", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true });
    stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    expect(container.querySelector('.pk-panel[aria-label="Your profile"]')).toBeNull();
    const account = container.querySelector('.pk-panel[aria-label="Account"]')!;
    expect(account.textContent).toContain("First name");
    expect(account.textContent).toContain("Pat");
    expect(account.textContent).not.toContain("Job title");
    expect(account.textContent).not.toContain("Biography");
  });

  it("edits the names in a dialog and sends only the names through the member contract", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true });
    const requests = stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    const account = container.querySelector('.pk-panel[aria-label="Account"]')!;
    await act(async () => account.querySelector<HTMLButtonElement>('button[aria-label="Account actions"]')!.click());
    await act(async () =>
      [...account.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((i) => i.textContent === "Edit names…")!
        .click(),
    );
    const first = account.querySelector<HTMLInputElement>('input[name="firstName"]')!;
    expect(account.querySelector('input[name="jobTitle"]')).toBeNull();
    await act(async () => {
      first.value = "Patricia";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      account.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/users/current");
    expect(patch?.body).toEqual({ firstName: "Patricia", lastName: "Person", preferredName: "" });
  });

  it("marks an empty first name on its field instead of sending it", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true });
    const requests = stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    const account = container.querySelector('.pk-panel[aria-label="Account"]')!;
    await act(async () => account.querySelector<HTMLButtonElement>('button[aria-label="Account actions"]')!.click());
    await act(async () =>
      [...account.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((i) => i.textContent === "Edit names…")!
        .click(),
    );
    const first = account.querySelector<HTMLInputElement>('input[name="firstName"]')!;
    await act(async () => {
      first.value = "";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      account.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    expect(account.querySelector("input[name=firstName]")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("leads from an identity's row to the page that edits its job title, biography and links", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true });
    stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Example Org"]')!;
    await act(async () => trigger.click());
    const edit = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Edit profile…",
    );
    expect(edit?.getAttribute("href")).toContain(`/users/${SELF_ID}/affiliations/${IDENTITY_ID}/profile`);
    // No form opens inside the row.
    expect(container.querySelector(".pk-affiliation form")).toBeNull();
  });
});

describe("who you are signed in as, and adding an identity", () => {
  it("resolves the verified representation email before showing its organization and never searches organizations", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    const requests = stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Add identity"]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(dialog.querySelector('[role="combobox"]')).toBeNull();
    expect(dialog.querySelector('input[name="jobTitle"]')).toBeNull();
    const email = dialog.querySelector<HTMLInputElement>('input[name="email"]')!;
    await act(async () => {
      email.value = "person@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dialog.textContent).toContain("Example Org"));
    expect(dialog.querySelector("select")?.value).toBe(ORGANIZATION_ID);
    const title = dialog.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
    await act(async () => {
      title.value = "Engineer";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          requests.some((request) => request.path === "/api/v1/users/current/identities" && request.method === "POST"),
        ).toBe(true),
      );
    });
    const sent = requests.find(
      (request) => request.path === "/api/v1/users/current/identities" && request.method === "POST",
    );
    expect(currentUserIdentityCreateSchema.parse(sent?.body)).toEqual({
      contextToken: "synthetic-prepared-context-for-identity-creation",
    });
    expect(
      requests.some((request) => request.path === "/api/v1/members" || request.path === "/api/v1/organizations"),
    ).toBe(false);
  });
  function twoIdentities() {
    const session = portalSessionFixture({ member: true });
    session.actingIdentities = [
      ...session.actingIdentities,
      {
        id: "00000000-0000-4000-8000-000000000099",
        organizationId: ORGANIZATION_ID,
        organizationName: "Example Org",
        jobTitle: "CTO",
        membershipCategory: null,
        membershipLabel: null,
      },
    ];
    session.actingIdentityId = "00000000-0000-4000-8000-000000000099";
    return session;
  }

  it("states the acting identity in its own panel, with the account menu's switch", async () => {
    portalSession.value = twoIdentities();
    stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);
    expect(container.textContent).not.toContain("Signed in as");
    const panel = container.querySelector('.pk-panel[aria-label="Acting as"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Example Org");
    expect(panel.textContent).toContain("CTO");
    const trigger = panel.querySelector<HTMLButtonElement>('button[aria-label="Switch identity"]')!;
    await act(async () => trigger.click());
    // The same choices as the account menu: each identity, the acting one checked.
    const choice = [...document.body.querySelectorAll('[role="menuitemradio"]')].find((item) =>
      item.textContent?.includes("Example Org · CTO"),
    );
    expect(choice?.getAttribute("aria-checked")).toBe("true");
  });

  it("offers Add identity to the subject as a header button that opens the create form in a dialog", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    const requests = stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);
    // The record already holds an organization identity, so the subject may add another.
    const add = container.querySelector<HTMLButtonElement>('button[aria-label="Add identity"]')!;
    expect(add.title).toBe("Add identity");
    await act(async () => add.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Add identity");
    const form = dialog.querySelector<HTMLFormElement>('form[aria-label="Add email address"]')!;
    expect(form).not.toBeNull();
    expect(form.textContent).toContain(EMAIL_FIRST_COPY.representation.work.label);
    expect(form.querySelector('[role="combobox"]')).toBeNull();
    // Nothing is sent until the contract accepts the draft.
    await act(async () => {
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Continue")!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(form.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => {
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click();
    });
    expect(container.querySelector('form[aria-label="Add email address"]')).toBeNull();
    await vi.waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
  });
});
