// @vitest-environment jsdom
/** The user record's account deletion: the preview decides between a typed delete and anonymizing instead. */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userWith } from "./helpers/affiliation-fixtures";
import { UserDetail as UserDetailView } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { typedConfirmationInput } from "./helpers/confirm-dialog";
import { accountDeletionSchema, type AccountDeletionPreview } from "../../assets/shared/schemas/account-deletion";
import { accountDeletionBlockerLabel, accountDeletionRemovedLabel } from "../../assets/shared/account-deletion";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
const apiClient = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  ...apiClient,
}));

const userId = "00000000-0000-4000-8000-000000000098";
const email = "casey@example.test";
let container: HTMLDivElement | undefined;

beforeEach(() => {
  navigate.mockReset();
  Object.values(apiClient).forEach((mock) => mock.mockReset());
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = undefined;
  }
  history.replaceState(null, "", "/portal/#/");
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderRecord(
  deletion: AccountDeletionPreview,
  { canAnonymize = true, viewerUserId }: { canAnonymize?: boolean; viewerUserId?: string } = {},
): Promise<HTMLDivElement> {
  const detailUser = {
    ...userWith([]),
    id: userId,
    email,
    first_name: "Casey",
    last_name: "Rivera",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  apiClient.getJson.mockImplementation(async (url: string) => {
    if (url === `/api/v1/users/${userId}`) return { user: detailUser };
    if (url === `/api/v1/users/${userId}/emails`) {
      return { emails: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } };
    }
    if (url === `/api/v1/users/${userId}/deletion`) return { deletion };
    throw new Error(`Unexpected getJson call: ${url}`);
  });
  apiClient.deleteJson.mockResolvedValue({ success: true, userId });

  const host = document.createElement("div");
  container = host;
  document.body.append(host);
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <UserDetailView
          userId={userId}
          viewerUserId={viewerUserId}
          permissions={{
            canRead: true,
            canWrite: true,
            canGrantAccess: false,
            canAnonymize,
            canDelete: true,
            canManageMembership: false,
            canActivateIdentity: false,
          }}
        />
      </>,
      host,
    ),
  );
  await settle();
  return host;
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = findButton(host, label);
  if (!found) throw new Error(`missing button: ${label}`);
  return found;
}

const deletable: AccountDeletionPreview = {
  userId,
  email,
  revision: "rev-1",
  deletable: true,
  removes: [
    { kind: "email_address", count: 1 },
    { kind: "proposal", count: 2 },
  ],
  blockers: [],
};

async function openDelete(host: HTMLElement): Promise<void> {
  await act(() => button(host, "⋯").click());
  await act(() => button(host, "Delete account…").click());
  await settle();
}

describe("portal user record account deletion", () => {
  it("lists what goes, requires the typed email, and deletes the reviewed revision", async () => {
    const host = await renderRecord(deletable);
    await openDelete(host);

    for (const entry of deletable.removes) expect(host.textContent).toContain(accountDeletionRemovedLabel(entry));
    expect(button(host, "Delete account").disabled).toBe(true);

    const typed = typedConfirmationInput(host)!;
    await act(() => {
      typed.value = email;
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => button(host, "Delete account").click());
    await settle();

    expect(apiClient.deleteJson).toHaveBeenCalledTimes(1);
    const sent = new URL(apiClient.deleteJson.mock.calls[0][0], "http://portal.test");
    expect(sent.pathname).toBe(`/api/v1/users/${userId}`);
    expect(accountDeletionSchema.parse(Object.fromEntries(sent.searchParams))).toEqual({ revision: "rev-1" });
    expect(navigate).toHaveBeenCalledWith("/users");
  });

  it("explains what keeps a blocked account and offers to anonymize it instead", async () => {
    apiClient.postJson.mockResolvedValue({ success: true, userId });
    const host = await renderRecord({
      userId,
      email,
      revision: "rev-2",
      deletable: false,
      removes: [],
      blockers: [{ kind: "proposal", count: 1 }],
    });
    await openDelete(host);

    expect(host.textContent).toContain(accountDeletionBlockerLabel({ kind: "proposal", count: 1 }));
    await act(() => button(host, "Anonymize instead…").click());
    await settle();

    expect(apiClient.deleteJson).not.toHaveBeenCalled();
    expect(findButton(host, "Anonymize user")).toBeDefined();
  });

  it("only closes when the reader may not anonymize", async () => {
    const host = await renderRecord(
      { userId, email, revision: "rev-3", deletable: false, removes: [], blockers: [{ kind: "vote", count: 2 }] },
      { canAnonymize: false },
    );
    await openDelete(host);

    expect(host.textContent).toContain(accountDeletionBlockerLabel({ kind: "vote", count: 2 }));
    expect(findButton(host, "Anonymize instead…")).toBeUndefined();
    await act(() => button(host, "Close").click());
    await settle();
    expect(apiClient.deleteJson).not.toHaveBeenCalled();
  });

  it("never offers staff the deletion of their own account", async () => {
    const host = await renderRecord(deletable, { viewerUserId: userId });
    await act(() => button(host, "⋯").click());

    expect(findButton(host, "Delete account…")).toBeUndefined();
  });
});
