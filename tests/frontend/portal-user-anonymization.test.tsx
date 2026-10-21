// @vitest-environment jsdom
/** The user record's destructive anonymization confirmation. */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userWith } from "./helpers/affiliation-fixtures";
import { UserDetail as UserDetailView } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { typedConfirmationInput } from "./helpers/confirm-dialog";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
const apiClient = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  ...apiClient,
}));
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = undefined;
  }
  history.replaceState(null, "", "/portal/#/");
});

describe("portal System Users anonymize confirmation", () => {
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("requires the typed email confirmation and only anonymizes once confirmed", async () => {
    const userId = "00000000-0000-4000-8000-000000000099";
    const email = "dana@example.test";
    const detailUser = {
      ...userWith([]),
      id: userId,
      email,
      first_name: "Dana",
      last_name: "Yu",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    apiClient.getJson.mockReset();
    apiClient.postJson.mockReset();
    apiClient.getJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${userId}`) return { user: detailUser };
      if (url === `/api/v1/users/${userId}/emails`) {
        return { emails: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } };
      }
      throw new Error(`Unexpected getJson call: ${url}`);
    });
    apiClient.postJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${userId}/anonymize`) return { success: true, userId };
      throw new Error(`Unexpected postJson call: ${url}`);
    });

    container = document.createElement("div");
    const host = container;
    document.body.append(host);
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserDetailView
            userId={userId}
            permissions={{
              canRead: true,
              canWrite: true,
              canGrantAccess: false,
              canAnonymize: true,
              canManageMembership: false,
              canActivateIdentity: false,
            }}
          />
        </>,
        host,
      ),
    );
    await settle();

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    // The record's destructive command lives in its actions menu now, so the
    // menu is opened first. The confirmation contract below is unchanged.
    await act(() => dialogButton("⋯").click());
    await act(() => dialogButton("Anonymize user…").click());
    // Selecting from a menu adds an async hop before the dialog mounts, which
    // a direct button click did not have.
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain(`Anonymize ${email}?`);

    const confirmButton = dialogButton("Anonymize user");
    expect(confirmButton.disabled).toBe(true);
    const typed = typedConfirmationInput(host)!;
    await act(() => {
      typed.value = "not-the-email";
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialogButton("Anonymize user").disabled).toBe(true);

    // Cancel: no anonymize request is sent.
    await act(() => dialogButton("Cancel").click());
    await settle();
    expect(apiClient.postJson).not.toHaveBeenCalled();

    // Confirm with the exact typed email: the anonymize request is sent.
    // Re-opening goes back through the menu, as it did the first time.
    await act(() => dialogButton("⋯").click());
    await act(() => dialogButton("Anonymize user…").click());
    await act(async () => {
      await Promise.resolve();
    });
    const retyped = typedConfirmationInput(host)!;
    await act(() => {
      retyped.value = email;
      retyped.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => dialogButton("Anonymize user").click());
    await settle();

    expect(apiClient.postJson).toHaveBeenCalledWith(`/api/v1/users/${userId}/anonymize`, {}, expect.anything());
  });
});
