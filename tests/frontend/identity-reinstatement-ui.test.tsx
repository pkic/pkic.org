// @vitest-environment jsdom
/**
 * Reinstating an ended representation: the three places it is offered and the
 * page an emailed link lands on.
 *
 * A manager reinstates directly, through the organization's identity route.
 * The owner cannot: they ask for a link to the identity's address, and the
 * link's page reinstates only on an explicit click, so a mail scanner that
 * opens it changes nothing.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import { ActingIdentityDirectory } from "../../assets/ts/member-flows/portal/sections/OrganizationIdentityDirectory";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { menuItemNamed, rowMenuTrigger, runRowAction } from "./helpers/row-actions";
import {
  IDENTITY_ID,
  ORGANIZATION_ID,
  errorResponse,
  jsonResponse,
  mount,
  press,
  settle,
  stubFetch,
  toastArea,
  userWith,
} from "./helpers/affiliation-fixtures";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

const RECIPIENT = "ada@organization-a.example";
const IDENTITY_PATH = `/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`;
const LINK_PATH = `/api/v1/users/current/identities/${IDENTITY_ID}/reinstatement`;

beforeEach(() => {
  toastArea();
});

function userWithPastIdentity(reinstatable: boolean) {
  return {
    ...userWith([]),
    formerIdentities: [
      {
        identityId: IDENTITY_ID,
        organizationId: ORGANIZATION_ID,
        organizationName: "Organization A",
        jobTitle: null,
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: "2026-03-01T00:00:00.000Z",
        emailAddress: RECIPIENT,
        reinstatable,
        selfReinstatable: reinstatable,
      },
    ],
  };
}

function mountPanel(options: {
  reinstatable?: boolean;
  canManage: boolean;
  viewerIsSubject?: boolean;
  onChanged?: () => void;
}): HTMLElement {
  const container = mount();
  void act(() =>
    render(
      <UserAffiliationsPanel
        user={userWithPastIdentity(options.reinstatable ?? true)}
        onChanged={options.onChanged ?? vi.fn()}
        canManage={options.canManage}
        viewerIsSubject={options.viewerIsSubject}
      />,
      container,
    ),
  );
  return container;
}

/** The reinstate dialog, past the panel's own closed "Add identity" dialog. */
function reinstateDialog(root: ParentNode): HTMLDialogElement | null {
  return (
    [...root.querySelectorAll("dialog")].find((dialog) =>
      dialog.querySelector("h2")?.textContent?.startsWith("Reinstate"),
    ) ?? null
  );
}

function openReinstate(container: HTMLElement): void {
  void act(() => rowMenuTrigger(container, "Organization A")?.click());
  const item = menuItemNamed(container, "Reinstate representation…");
  if (!item) throw new Error("the past identity offers no reinstate item");
  void act(() => item.click());
}

describe("reinstating from a user's past identities", () => {
  it("lets a manager reinstate directly and refreshes the record", async () => {
    const requests = stubFetch(() => jsonResponse({ success: true, identityId: IDENTITY_ID, state: "active" }));
    const onChanged = vi.fn();
    const container = mountPanel({ canManage: true, onChanged });

    openReinstate(container);
    expect(reinstateDialog(container)?.querySelector("h2")?.textContent).toBe(
      "Reinstate Test User's representation of Organization A?",
    );
    await press(container, "Reinstate");

    expect(requests).toEqual([
      {
        method: "PATCH",
        pathname: IDENTITY_PATH,
        body: { transition: { state: "active", reason: "Reinstated from System Users" } },
      },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(reinstateDialog(container)).toBeNull();
  });

  it("lets the owner ask for a link to the identity's address, and changes nothing else", async () => {
    const requests = stubFetch(() => jsonResponse({ success: true, recipientEmail: RECIPIENT }));
    const onChanged = vi.fn();
    const container = mountPanel({ canManage: false, viewerIsSubject: true, onChanged });

    openReinstate(container);
    expect(reinstateDialog(container)?.querySelector("h2")?.textContent).toBe(
      "Reinstate your representation of Organization A?",
    );
    expect(reinstateDialog(container)?.textContent).toContain(RECIPIENT);
    await press(container, "Send link");

    expect(requests).toEqual([{ method: "POST", pathname: LINK_PATH, body: {} }]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(document.getElementById("portal-toast-area")?.textContent).toContain(`Check ${RECIPIENT} for the link`);
  });

  it("offers nothing when the end can no longer be undone", () => {
    const container = mountPanel({ canManage: true, reinstatable: false });

    expect(menuItemNamed(container, "Reinstate representation…")).toBeNull();
    void act(() => rowMenuTrigger(container, "Organization A")?.click());
    expect(menuItemNamed(container, "Reinstate representation…")).toBeNull();
    expect(container.textContent).not.toContain("Reinstate representation");
  });

  it("offers nothing to somebody who neither manages nor is the subject", () => {
    const container = mountPanel({ canManage: false });

    expect(rowMenuTrigger(container, "Organization A")).toBeNull();
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    stubFetch(() => errorResponse("A newer identity already represents this organization.", 409));
    const onChanged = vi.fn();
    const container = mountPanel({ canManage: true, onChanged });

    openReinstate(container);
    await press(container, "Reinstate");

    const dialog = reinstateDialog(container);
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
      "A newer identity already represents this organization.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("reinstating from the organization identity directory", () => {
  const ENDED_USER_ID = "00000000-0000-4000-8000-000000000011";

  function directory(): Response {
    const now = "2026-01-01T00:00:00.000Z";
    return jsonResponse(
      identitiesListResponseSchema.parse({
        identities: [
          {
            id: IDENTITY_ID,
            memberId: "00000000-0000-4000-8000-000000000031",
            organizationId: ORGANIZATION_ID,
            organizationName: "Example Corp",
            membershipCategory: "full",
            userId: ENDED_USER_ID,
            userName: "Ended Person",
            emailId: null,
            email: "ended@example.test",
            jobTitle: null,
            biography: null,
            links: [],
            headshotUrl: null,
            source: "membership_approval",
            state: "ended",
            showOnOrganizationProfile: true,
            invitedAt: now,
            startedAt: now,
            endedAt: "2026-02-01T00:00:00.000Z",
            blockedAt: null,
            blockedByUserId: null,
            predecessorIdentityId: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    );
  }

  async function mountDirectory(canBlock: (userId: string) => boolean): Promise<HTMLElement> {
    const container = mount();
    portalSession.value = null;
    await act(async () => {
      render(
        <ActingIdentityDirectory
          organizationId={ORGANIZATION_ID}
          activeIdentities={[]}
          canManage
          canBlock={canBlock}
        />,
        container,
      );
      await Promise.resolve();
    });
    await settle();
    return container;
  }

  it("offers an ended row the reinstate action and PATCHes it active", async () => {
    const requests = stubFetch((url) =>
      url.pathname === IDENTITY_PATH
        ? jsonResponse({ success: true, identityId: IDENTITY_ID, state: "active" })
        : directory(),
    );
    const container = await mountDirectory(() => true);

    await runRowAction(container, "Ended Person", "Reinstate representation…");
    expect(reinstateDialog(container)?.querySelector("h2")?.textContent).toBe(
      "Reinstate Ended Person's representation of this organization?",
    );
    await press(container, "Reinstate");

    expect(requests.filter((request) => request.method !== "GET")).toEqual([
      {
        method: "PATCH",
        pathname: IDENTITY_PATH,
        body: { transition: { state: "active", reason: "Reinstated from the organization identity directory" } },
      },
    ]);
  });

  it("offers nothing when the viewer may not block that person", async () => {
    stubFetch(() => directory());
    const container = await mountDirectory(() => false);

    expect(rowMenuTrigger(container, "Ended Person")).toBeNull();
    expect(container.textContent).not.toContain("Reinstate representation");
  });
});

describe("the emailed reinstatement link", () => {
  const PREVIEW_PATH = "/api/v1/users/current/identities/reinstatement/preview";
  const CONFIRM_PATH = "/api/v1/users/current/identities/reinstatement/confirmation";
  const TOKEN = "a".repeat(43);

  afterEach(() => {
    window.location.hash = "";
  });

  /** The link lands on the owner's own record, which asks before reinstating. */
  async function openLink(hash: string, onChanged = vi.fn()): Promise<HTMLElement> {
    window.location.hash = hash;
    const container = mountPanel({ canManage: false, viewerIsSubject: true, onChanged });
    await settle();
    return container;
  }

  function previewResponse(): Response {
    return jsonResponse({
      success: true,
      organizationName: "Organization A",
      recipientEmail: RECIPIENT,
      identityId: IDENTITY_ID,
    });
  }

  it("previews on load without reinstating, then reinstates on an explicit click", async () => {
    const onChanged = vi.fn();
    const requests = stubFetch((url) =>
      url.pathname === PREVIEW_PATH
        ? previewResponse()
        : jsonResponse({ success: true, identityId: IDENTITY_ID, state: "active" }),
    );
    const container = await openLink(`#/users/current?reinstatement=${TOKEN}`, onChanged);

    expect(requests).toEqual([{ method: "POST", pathname: PREVIEW_PATH, body: { token: TOKEN } }]);
    expect(reinstateDialog(container)?.textContent).toContain("Organization A");

    await press(container, "Reinstate");

    expect(requests.map((request) => request.pathname)).toEqual([PREVIEW_PATH, CONFIRM_PATH]);
    expect(requests[1].body).toEqual({ token: TOKEN });
    expect(document.body.textContent).toContain("Representation reinstated");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(reinstateDialog(container)).toBeNull();
  });

  it("says the link expired or was already used when it is gone", async () => {
    stubFetch(() => errorResponse("Gone", 410));
    const container = await openLink(`#/users/current?reinstatement=${TOKEN}`);

    expect(reinstateDialog(container)?.querySelector('[role="alert"]')?.textContent).toContain(
      "expired, was already used",
    );
  });

  it("says the link belongs to another account when the signed-in account differs", async () => {
    stubFetch(() => errorResponse("Forbidden", 403));
    const container = await openLink(`#/users/current?reinstatement=${TOKEN}`);

    expect(reinstateDialog(container)?.querySelector('[role="alert"]')?.textContent).toContain("sent to someone else");
  });

  it("asks nothing and calls nothing on a record opened without a link", async () => {
    const requests = stubFetch(() => previewResponse());
    const container = await openLink("#/users/current");

    expect(reinstateDialog(container)).toBeNull();
    expect(requests).toEqual([]);
  });
});
