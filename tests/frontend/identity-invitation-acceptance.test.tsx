// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityInvitationLinkRequestSchema } from "../../assets/shared/schemas/identity";
import { IdentityInvitationAcceptance } from "../../assets/ts/member-flows/portal/shell/IdentityInvitationAcceptance";

let container: HTMLElement;

function stubApi(viewer: "invitee" | "another_person" | "signed_out") {
  const accepted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      const body = JSON.parse(String(init?.body));
      if (path.endsWith("/preview"))
        return Response.json({
          success: true,
          organizationName: "Example Corp",
          recipientEmail: "invitee@example.test",
          viewer,
        });
      accepted.push(body);
      return Response.json({ success: true, identityId: "10000000-0000-4000-8000-000000000001", state: "active" });
    }),
  );
  return accepted;
}

async function mount() {
  window.location.hash = "#/identity-invitations?token=signed-token";
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => render(<IdentityInvitationAcceptance />, container));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button, a")].find((element) => element.textContent === label) as
    | HTMLElement
    | undefined;
}

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("identity invitation acceptance", () => {
  it("requires a fresh acceptance after navigating to a second invitation", async () => {
    const accepted = stubApi("signed_out");
    await mount();
    await act(async () => button("Accept identity")!.click());
    await vi.waitFor(() => expect(button("Sign in to continue")).toBeDefined());

    await act(async () => {
      window.location.hash = "#/identity-invitations?token=second-token";
      render(<IdentityInvitationAcceptance />, container);
    });
    await vi.waitFor(() => expect(button("Accept identity")).toBeDefined());
    expect(button("Sign in to continue")).toBeUndefined();
    await act(async () => button("Accept identity")!.click());
    await vi.waitFor(() => expect(accepted).toHaveLength(2));
    expect(identityInvitationLinkRequestSchema.parse(accepted[1])).toEqual({ token: "second-token" });
  });

  it("clears an unavailable invitation error when the invitation changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "NOT_FOUND", message: "Gone" } }, { status: 404 })),
    );
    await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    stubApi("signed_out");
    await act(async () => {
      window.location.hash = "#/identity-invitations?token=valid-token";
      render(<IdentityInvitationAcceptance />, container);
    });
    await vi.waitFor(() => expect(button("Accept identity")).toBeDefined());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("names the invited address and offers no acceptance to someone signed in as another person", async () => {
    stubApi("another_person");
    await mount();

    expect(container.textContent).toContain("You are signed in as someone else");
    expect(container.textContent).toContain("invitee@example.test");
    expect(button("Accept identity")).toBeUndefined();
  });

  it("shows the wrong-account state when another account signed in after the preview", async () => {
    stubApi("signed_out");
    await mount();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, error: { code: "IDENTITY_INVITATION_OTHER_ACCOUNT", message: "Another person." } },
          { status: 409 },
        ),
      ),
    );

    await act(async () => button("Accept identity")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(button("Accept identity")).toBeUndefined();
    expect(button("Open the portal")).toBeDefined();
  });

  it("confirms what was accepted and offers sign-in as the next step", async () => {
    const accepted = stubApi("signed_out");
    await mount();

    await act(async () => button("Accept identity")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(identityInvitationLinkRequestSchema.parse(accepted[0])).toEqual({ token: "signed-token" });
    expect(container.textContent).toContain("You now act for Example Corp as invitee@example.test.");
    expect(button("Sign in to continue")?.getAttribute("href")).toBe("/portal/#/users/current");
  });
});
