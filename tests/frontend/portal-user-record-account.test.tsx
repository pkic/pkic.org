// @vitest-environment jsdom
/**
 * The account panels on the user record, and who sees which.
 *
 * Email addresses, email notifications, passkeys and identity invitations are
 * the person's own to manage, so only the record's subject sees them. Staff
 * with user write permission manage another user's secondary addresses, and
 * anyone who may read the record sees what access it carries.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import type { UserPermissions } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { ownEmailAddressesListResponseSchema } from "../../assets/shared/schemas/own-email-addresses";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/self", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: unknown; href: string }) => <a href={`#${href}`}>{children as never}</a>,
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => false }));

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000077";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000010";

const NO_PERMISSIONS: UserPermissions = {
  canRead: false,
  canWrite: false,
  canGrantAccess: false,
  canAnonymize: false,
  canManageMembership: false,
  canActivateIdentity: false,
};
const READ_ONLY: UserPermissions = { ...NO_PERMISSIONS, canRead: true };
const WRITER: UserPermissions = { ...READ_ONLY, canWrite: true };

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

function pendingInvitation() {
  return {
    id: "00000000-0000-4000-8000-000000000091",
    memberId: null,
    organizationId: ORGANIZATION_ID,
    organizationName: "Invited Org",
    membershipCategory: null,
    userId: SELF_ID,
    userName: "Pat Person",
    emailId: null,
    email: "person@example.test",
    jobTitle: null,
    biography: null,
    links: [],
    headshotUrl: null,
    source: "membership_approval",
    state: "pending",
    showOnOrganizationProfile: false,
    invitedAt: "2026-10-01T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    blockedAt: null,
    blockedByUserId: null,
    predecessorIdentityId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** Answers the record and the account resources; anything else is an empty refusal the panels tolerate. */
function stubApi(options: { invitations?: unknown[] } = {}): string[] {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      paths.push(url.pathname);
      const page = (total: number) => ({ limit: 20, offset: 0, total, hasMore: false });
      if (url.pathname === `/api/v1/users/${SELF_ID}` || url.pathname === `/api/v1/users/${OTHER_ID}`) {
        return json(record(url.pathname.endsWith(SELF_ID) ? SELF_ID : OTHER_ID));
      }
      if (url.pathname === "/api/v1/users/current/emails") {
        return json(
          ownEmailAddressesListResponseSchema.parse({
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
          }),
        );
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
      if (url.pathname === "/api/v1/users/current/identities") {
        return json({ identities: options.invitations ?? [], page: page(options.invitations?.length ?? 0) });
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

function panel(name: string): Element | null {
  const element = container.querySelector(`.pk-panel[aria-label="${name}"]`);
  return element?.closest("[hidden]") ? null : element;
}

function panelNames(): string[] {
  return ["Email addresses", "Email notifications", "Passkeys", "Access", "Identity invitations"].filter(
    (name) => panel(name) !== null,
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("account panels on the user record", () => {
  it("shows the record's subject all four panels, with a named list of email addresses", async () => {
    portalSession.value = portalSessionFixture({ staff: true, member: true });
    stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    expect(panelNames()).toEqual(["Email addresses", "Email notifications", "Passkeys", "Access"]);

    const emails = panel("Email addresses")!;
    expect(emails.querySelector('ul[aria-label="Email addresses"]')).not.toBeNull();
    expect(emails.textContent).toContain("person@example.test");
    expect(emails.querySelector('[aria-label="Verified"]')).not.toBeNull();
    expect(emails.querySelector(".pk-badge")).toBeNull();
    expect(emails.querySelector('button[aria-label="Email addresses actions"]')).not.toBeNull();

    // Saved as each box is changed: no edit mode, no On or Off text.
    const notifications = panel("Email notifications")!;
    expect(notifications.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expect(notifications.querySelector("button")).toBeNull();

    // The add form lives in a dialog behind the panel's menu.
    expect(panel("Passkeys")!.querySelector("dialog")).not.toBeNull();

    const access = panel("Access")!;
    expect(access.textContent).toContain("Example Org");
    expect(access.textContent).toContain("all global");
    expect(access.querySelector("details code")?.textContent).toBeTruthy();
    expect(access.textContent).toContain("Set in each group");
    expect(access.textContent).not.toContain("Sponsor access");
  });

  it("states a plain member's access without a permission list", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    const access = panel("Access")!;
    expect(access.textContent).toContain("Example Org");
    expect(access.textContent).not.toContain("Permissions");
    expect(access.querySelector("code")).toBeNull();
  });

  it("shows a pending-only identity its invitations, and no member or staff panels or calls", async () => {
    portalSession.value = portalSessionFixture({ pendingIdentityCount: 1 });
    const paths = stubApi({ invitations: [pendingInvitation()] });
    await mount(SELF_ID, NO_PERMISSIONS);

    expect(panelNames()).toEqual(["Email addresses", "Access", "Identity invitations"]);
    expect(panel("Identity invitations")!.textContent).toContain("Invited Org");
    expect(paths).not.toContain("/api/v1/users/current/notifications/preferences");
    expect(paths).not.toContain("/api/v1/auth/passkeys");
  });

  it("renders no invitations panel when none are pending", async () => {
    portalSession.value = portalSessionFixture({ pendingIdentityCount: 1 });
    stubApi({ invitations: [] });
    await mount(SELF_ID, NO_PERMISSIONS);

    expect(panel("Identity invitations")).toBeNull();
  });

  it("shows a staff-only identity passkeys but no notification preferences", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    const paths = stubApi();
    await mount(SELF_ID, NO_PERMISSIONS);

    expect(panelNames()).toEqual(["Email addresses", "Passkeys", "Access"]);
    expect(paths).not.toContain("/api/v1/users/current/notifications/preferences");
  });

  it("shows another user's record to a read-only viewer as access only", async () => {
    portalSession.value = portalSessionFixture({ staff: true, administrator: false, grants: [] });
    const paths = stubApi();
    await mount(OTHER_ID, READ_ONLY);

    expect(panelNames()).toEqual(["Access"]);
    // The viewer's own permissions are not this user's: the list is the subject's alone.
    expect(panel("Access")!.textContent).not.toContain("Permissions");
    expect(paths).not.toContain("/api/v1/users/current/emails");
    expect(paths).not.toContain(`/api/v1/users/${OTHER_ID}/emails`);
  });

  it("lets a viewer with user write permission manage another user's addresses, and nothing of the person's own", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    stubApi();
    await mount(OTHER_ID, WRITER);

    expect(panelNames()).toEqual(["Email addresses", "Access"]);
    expect(panel("Email addresses")!.textContent).toContain("other@example.test");
  });

  it("shows nothing of the account to a viewer without permission", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubApi();
    await mount(OTHER_ID, NO_PERMISSIONS);

    expect(panelNames()).toEqual([]);
    expect(container.textContent).toContain("You need Users read permission");
  });
});
