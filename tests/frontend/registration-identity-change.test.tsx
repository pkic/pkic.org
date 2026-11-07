// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationIdentityChange } from "../../assets/ts/components/events/RegistrationIdentityChange";
import { registrationIdentityChangeSchema } from "../../assets/shared/schemas/registration-identity";
import { readResponse } from "./helpers/participant-registration-fixtures";
const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const container of mounted.splice(0)) {
    render(null, container);
    container.remove();
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});
function button(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label && !b.closest("[hidden]"),
    ) ?? null
  );
}
async function click(target: HTMLElement | null): Promise<void> {
  if (!target) throw new Error("control not found");
  await act(async () => target.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
describe("RegistrationIdentityChange", () => {
  it("retries a failed refresh without saving the representation twice", async () => {
    const identity = {
      id: "00000000-0000-4000-8000-000000000042",
      organizationId: null,
      organizationName: null,
      jobTitle: null,
    };
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "PUT"
              ? { success: true, identity, badgeVersion: "2026-01-01T00:00:00.000Z" }
              : {
                  success: true,
                  sessionId: "00000000-0000-4000-8000-000000000045",
                  expiresAt: "2099-12-31T23:59:59.000Z",
                  idleExpiresAt: "2099-12-31T23:59:59.000Z",
                  identity: { id: "00000000-0000-4000-8000-000000000041", email: "ada@example.test" },
                  eventParticipation: true,
                  actingIdentityId: identity.id,
                  actingIdentities: [identity],
                },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const changed = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() =>
      render(
        <RegistrationIdentityChange data={readResponse({ identityId: identity.id })} onChanged={changed}>
          {(edit) => (
            <>
              {edit("Change representation")}
              {edit("Edit job title")}
            </>
          )}
        </RegistrationIdentityChange>,
        container,
      ),
    );
    await click(container.querySelector('button[aria-label="Edit job title"]'));
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => url === "/api/v1/auth/session")).toHaveLength(1);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await click(button(document, "Save changes"));
    await vi.waitFor(() => expect(container.textContent).toContain("could not be refreshed"));
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(registrationIdentityChangeSchema.parse(JSON.parse(String(writes[0]![1]?.body)))).toMatchObject({
      identityId: identity.id,
    });
    await click(button(container, "Retry refresh"));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(button(container, "Retry refresh")).toBeNull();
  });
});
