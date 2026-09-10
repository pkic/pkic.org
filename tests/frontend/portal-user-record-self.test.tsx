// @vitest-environment jsdom
/**
 * Removing your own headshot from your own user record.
 *
 * There is one record page for a person now, and viewing yourself adds the
 * affordances only you hold. The photo is the clearest of them: a member holds
 * no `users:write`, so the staff headshot route would refuse them the one
 * portrait that is unarguably theirs, and the panel has to reach
 * `DELETE /api/v1/users/current/headshot` instead.
 *
 * What a rendering specimen cannot show is what matters here: that the control
 * reaches the canonical endpoint, that the removed photo actually leaves the
 * stored profile rather than only the component that removed it, and that a
 * refused removal says so in words a member can act on instead of a transport
 * status. The last case also proves the record is loadable at all by somebody
 * holding no Users permission.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { userDetailResponseSchema } from "../../assets/shared/schemas/user-management";
import { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/users/self", vi.fn()] }));

const userId = "00000000-0000-4000-8000-000000000041";
const HEADSHOT_URL = `/api/v1/users/${userId}/headshots/stored.jpg`;
const HEADSHOT_ENDPOINT = "/api/v1/users/current/headshot";
const RECORD_ENDPOINT = `/api/v1/users/${userId}`;

/** A member holds none of the staff permissions the record's other half needs. */
const MEMBER_PERMISSIONS = {
  canRead: false,
  canWrite: false,
  canGrantAccess: false,
  canAnonymize: false,
  canManageMembership: false,
  canActivateIdentity: false,
};

let container: HTMLDivElement;
let toastArea: HTMLDivElement;

/**
 * An organization-less member: the roster and the organization-page visibility
 * switch belong to their own files, and leaving them out keeps this file's
 * only network traffic the record's and the headshot's.
 */
function memberProfile(headshotUrl: string | null) {
  return myProfileSchema.parse({
    userId,
    emailId: null,
    email: "member@example.test",
    emailAddresses: [
      {
        id: null,
        email: "member@example.test",
        primary: true,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
    ],
    firstName: "Member",
    lastName: "Person",
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: "H5",
    organizationId: null,
    organizationName: null,
    memberSince: "2026-01-01",
    showOnOrgProfile: false,
    headshotUrl,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: [
      {
        identityId: "00000000-0000-4000-8000-000000000042",
        memberId: "00000000-0000-4000-8000-000000000043",
        organizationId: null,
        organizationName: null,
        membershipCategory: "H5",
      },
    ],
  });
}

/** The record as the API answers it, parsed through the contract it answers with. */
function userRecord(headshotUrl: string | null) {
  return userDetailResponseSchema.parse({
    user: {
      id: userId,
      email: "member@example.test",
      first_name: "Member",
      last_name: "Person",
      preferred_name: null,
      role: "user",
      active: true,
      isEcMember: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pii_redacted_at: null,
      headshotUrl,
      identities: [],
      formerIdentities: [],
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The portrait tile's removal control.
 *
 * The portrait is the affordance now (#28): a member changes or removes their
 * photograph by pressing the face at the top of their record, not through a
 * panel at the foot of it under "Account administration". The control exists
 * only when there is something to remove, so this answers `null` rather than
 * throwing — "there is no remove button" is one of the things under test.
 */
function removeButton(): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Remove photo",
    ) ?? null
  );
}

/** Confirms the open dialog, which is the portal's own rather than the browser's. */
async function acceptRemoval(): Promise<void> {
  const dialog = container.querySelector('[role="alertdialog"], dialog');
  if (!dialog) throw new Error("no confirmation is open");
  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Remove photo");
  if (!confirm) throw new Error("the confirmation offers no Remove photo");
  void act(() => confirm.click());
  await settle();
}

function toastMessages(): string[] {
  return [...toastArea.querySelectorAll(".pk-toast__message")].map((node) => node.textContent ?? "");
}

/**
 * `deleteHeadshot` is only reached once the native confirmation is accepted
 * (see the controller's note on why this surface still uses `confirm`).
 *
 * Requests to the record and to the participation resource the page loads
 * alongside it are answered but not recorded: this file is about the headshot.
 */
function stubEndpoints(
  storedHeadshotUrl: string | null,
  respond: (method: string) => Response,
): Array<{ method: string; url: string }> {
  const requests: Array<{ method: string; url: string }> = [];
  // The stored photo the record answers with, so a re-read after a successful
  // removal reports what the server would rather than what it held before.
  let stored = storedHeadshotUrl;
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : String(input), location.origin);
      const method = init?.method ?? "GET";
      if (url.pathname === RECORD_ENDPOINT) return json(userRecord(stored));
      if (url.pathname.endsWith("/participation") || url.pathname.endsWith("/skills")) {
        return json({ participation: null, skills: [], totalVouches: 0 });
      }
      if (url.pathname === HEADSHOT_ENDPOINT || url.pathname === "/api/v1/users/current") {
        requests.push({ method, url: url.pathname });
        const response = respond(method);
        if (method === "DELETE" && response.ok) stored = null;
        return response;
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

function renderRecord(): void {
  void act(() =>
    render(
      <>
        {/* The removal is confirmed in the portal's own dialog, which the
            shell mounts once near the root. */}
        <ConfirmDialogHost />
        <UserDetail userId={userId} permissions={MEMBER_PERMISSIONS} viewerUserId={userId} />
      </>,
      container,
    ),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(container, toastArea);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  toastArea.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("removing your own headshot from your own user record", () => {
  it("deletes through the current-user endpoint and drops the photo from the stored profile", async () => {
    const requests = stubEndpoints(HEADSHOT_URL, (method) =>
      method === "DELETE" ? json({ success: true }) : json(memberProfile(null)),
    );
    profile.value = memberProfile(HEADSHOT_URL);
    renderRecord();
    await settle();

    // The control is only offered when there is something to remove.
    expect(removeButton()).not.toBeNull();

    void act(() => removeButton()!.click());
    await settle();
    await acceptRemoval();

    expect(requests).toEqual([
      { method: "DELETE", url: HEADSHOT_ENDPOINT },
      // The removal is re-read from the server, not merely assumed.
      { method: "GET", url: "/api/v1/users/current" },
    ]);
    expect(profile.value?.headshotUrl).toBeNull();
    // Back to a tile offering to upload one, with nothing left to remove.
    expect(removeButton()).toBeNull();
    expect(toastMessages()).toContain("Photo removed");
  });

  it("keeps the photo and says what went wrong when the server refuses the removal", async () => {
    const requests = stubEndpoints(HEADSHOT_URL, (method) =>
      method === "DELETE" ? new Response(null, { status: 500 }) : json(memberProfile(null)),
    );
    const stored = memberProfile(HEADSHOT_URL);
    profile.value = stored;
    renderRecord();
    await settle();

    void act(() => removeButton()!.click());
    await settle();
    await acceptRemoval();

    // No refresh followed a removal that never happened, and the profile the
    // rest of the portal reads is untouched.
    expect(requests).toEqual([{ method: "DELETE", url: HEADSHOT_ENDPOINT }]);
    expect(profile.value).toBe(stored);
    expect(removeButton()).not.toBeNull();

    // A transport status is not something a member can act on: the toast
    // carries the sentence, not the status line.
    expect(toastMessages()).toEqual([
      "Something went wrong on our side. Try again, and let us know if it keeps happening.",
    ]);
  });

  it("offers no removal control to a member who has no headshot on file", async () => {
    stubEndpoints(null, () => json(memberProfile(null)));
    profile.value = memberProfile(null);
    renderRecord();
    await settle();

    expect(removeButton()).toBeNull();
  });

  it("offers a staff reader the record without the subject's own controls", async () => {
    const staffUserId = "00000000-0000-4000-8000-000000000099";
    stubEndpoints(HEADSHOT_URL, () => json(memberProfile(HEADSHOT_URL)));
    profile.value = memberProfile(HEADSHOT_URL);
    void act(() =>
      render(
        <UserDetail
          userId={userId}
          permissions={{ ...MEMBER_PERMISSIONS, canRead: true }}
          viewerUserId={staffUserId}
        />,
        container,
      ),
    );
    await settle();

    // Somebody else's record: the self-only panel and the photo in the open
    // are absent, and the photo lives behind account administration instead.
    expect(container.textContent).not.toContain("Your profile");
    expect(container.textContent).toContain("Account administration");
    // Reading is not writing: on a record that is not theirs, a reader
    // without `users:write` gets a read-only photo with no removal at all.
    expect(container.querySelector("[data-headshot-delete]")).toBeNull();
  });
});
