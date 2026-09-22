// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { bootstrap } from "../../assets/ts/event-flows/boot";
import { registrationInvitation } from "../../assets/ts/event-flows/registration-invitation";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { inviteResendLinkSchema } from "../../assets/shared/schemas/proposal-management";

function setup(invite = true) {
  window.history.replaceState(
    {},
    "",
    `/events/test/register/${invite ? "?invite=expired-token&id=invitation-id&source=invite" : ""}`,
  );
  document.body.innerHTML =
    '<main data-registration data-event-slug="test"><div class="event-flow-stepper"></div><form><div data-step="1" class="is-active"><input name="email" value="guest@example.com"><input name="firstName" value="Guest"></div></form><div data-flow-status></div></main>';
  const boot = bootstrap("[data-registration]")!;
  const gate = registrationInvitation(boot);
  return { boot, gate };
}
function respond(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
function button(text: string) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent === text)!;
}
const valid = {
  status: "valid",
  eventName: "Test",
  inviteeFirstName: "Guest",
  inviteType: "attendee",
  registrationUrl: "/events/test/register/",
  proposalUrl: null,
  inviters: [],
  totalInviters: 0,
};
afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("registration invitation access", () => {
  it("blocks an expired invitation before showing signup and sends no automatic email", async () => {
    const fetch = vi.fn().mockResolvedValue(respond({ status: "expired" }));
    vi.stubGlobal("fetch", fetch);
    const { boot, gate } = setup();
    expect(boot.form.hidden).toBe(true);
    await act(() => gate.check("public"));
    expect(gate.canSubmit()).toBe(false);
    expect(boot.root.textContent).toContain("This invitation has expired");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => button("Continue without invitation").click());
    expect(boot.form.hidden).toBe(false);
    expect(gate.canSubmit()).toBe(true);
    expect(boot.query.inviteToken).toBeNull();
    expect(window.location.search).toBe("");
    expect(boot.form.elements.namedItem("firstName")).toHaveProperty("value", "Guest");
  });
  it("does not offer public continuation for an invitation-only event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond({ status: "invalid" })));
    const { gate } = setup();
    await act(() => gate.check("invitation_only"));
    expect(button("Continue without invitation")).toBeUndefined();
    expect(gate.canSubmit()).toBe(false);
  });
  it("preserves entered details when an invitation expires during submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(valid)));
    const { boot, gate } = setup();
    await act(() => gate.check("public"));
    expect(gate.canSubmit()).toBe(true);
    await act(() => {
      expect(gate.handleError(new ApiClientError({ error: { code: "INVITE_EXPIRED", message: "Expired" } }, 400))).toBe(
        true,
      );
    });
    expect(boot.form.hidden).toBe(true);
    await act(() => button("Continue without invitation").click());
    expect(boot.form.elements.namedItem("email")).toHaveProperty("value", "guest@example.com");
    expect(gate.canSubmit()).toBe(true);
  });
  it("refuses a valid invitation for a different event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond({ ...valid, registrationUrl: "/events/other/register/" })),
    );
    const { gate } = setup();
    await act(() => gate.check("public"));
    expect(gate.canSubmit()).toBe(false);
    expect(document.body.textContent).toContain("This invitation link is not valid");
  });
  it("keeps signup blocked on a failed lookup and allows a retry", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(respond(valid));
    vi.stubGlobal("fetch", fetch);
    const { gate } = setup();
    await act(() => gate.check("public"));
    expect(gate.canSubmit()).toBe(false);
    expect(button("Continue without invitation")).toBeUndefined();
    await act(async () => {
      button("Try checking again").click();
    });
    await vi.waitFor(() => expect(gate.canSubmit()).toBe(true));
  });
  it("only requests a fresh invitation on explicit submission with the canonical email contract", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond({ status: "invalid" }))
      .mockResolvedValueOnce(respond({ success: true }));
    vi.stubGlobal("fetch", fetch);
    const { gate } = setup();
    await act(() => gate.check("public"));
    await act(async () => {
      button("Send fresh invitation link")
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe("/api/v1/invites/resend-link");
    expect(inviteResendLinkSchema.parse(JSON.parse(init.body))).toEqual({ email: "guest@example.com" });
    await vi.waitFor(() => expect(document.body.textContent).toContain("a fresh link will arrive by email"));
  });
});
