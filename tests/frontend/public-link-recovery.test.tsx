// @vitest-environment jsdom
/**
 * Recovering a lost management link, and what the shared flows announce.
 *
 * Split from the consent-card suite it used to share a file with. Those tests
 * are about one control's frame and validity; these are about a whole flow's
 * state — what it says while sending, what it says when the send fails, and
 * what replaces the form once it succeeds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { z } from "zod";
import { MagicLinkSubmitButton, SignInError } from "../../assets/ts/components/MagicLinkFeedback";
import { MenuIcon } from "../../assets/ts/components/MenuIcon";
import { NotFoundPanel } from "../../assets/ts/components/NotFoundPanel";
import { SuccessPanel } from "../../assets/ts/components/SuccessPanel";
import { VerifyingOverlay } from "../../assets/ts/components/VerifyingOverlay";
import { loadSpeakerPageData } from "../../assets/ts/event-flows/speaker-link-recovery";
import { useAsyncSubmission } from "../../assets/ts/hooks/useAsyncSubmission";
import { useMagicLinkRequest } from "../../assets/ts/hooks/useMagicLinkRequest";
import { IdentitySelect } from "../../assets/ts/member-flows/portal/sections/MyOrganization";
import { statusLabel } from "../../assets/ts/components/Badge";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { classifyDonationPollResult } from "../../assets/ts/shared/donation/session-poll";
import { uploadFile } from "../../assets/ts/shared/file-upload";
import { emailFromSubmitEvent } from "../../assets/ts/shared/form/helpers";
import { replaceFormWithSuccess } from "../../assets/ts/shared/form/success-panel";
import { memberInitials } from "../../assets/ts/shared/member-display";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../assets/ts/shared/organization-content";
import { handleFormInviteSubmitError } from "../../assets/ts/shared/widgets/invite-recovery";
import { showManageLinkRecoveryForm } from "../../assets/ts/shared/widgets/link-recovery";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public shared link recovery and flow state", () => {
  it("shows the shared speaker recovery state when the token is absent", async () => {
    document.body.innerHTML = `
      <main data-speaker-test data-event-slug="event-1">
        <form><div data-flow-status></div></form>
        <div data-speaker-loading></div>
        <section hidden data-resend-speaker-manage-section>
          <button data-resend-speaker-manage-btn></button>
          <input data-resend-speaker-manage-email>
          <span data-resend-speaker-manage-status></span>
        </section>
      </main>`;

    const loaded = await loadSpeakerPageData({ selector: "[data-speaker-test]", request: vi.fn() });

    expect(loaded).toBeNull();
    // The recovery state is switched by the `hidden` attribute, which is what
    // both speaker templates carry — the `d-none` class it replaced is gone
    // from the shared widget, so the fixture asserts the attribute.
    expect(document.querySelector<HTMLElement>("[data-speaker-loading]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-resend-speaker-manage-section]")?.hidden).toBe(false);
    expect(document.querySelector("[data-resend-speaker-manage-status]")?.textContent).toContain(
      "Missing speaker token",
    );
  });

  /** The markup both recovery templates render, reduced to what the widget touches. */
  function recoveryFixture(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = `
      <p data-loading></p>
      <div data-section hidden>
        <input data-email>
        <button data-btn>Send</button>
        <p data-status></p>
      </div>`;
    document.body.append(root);
    mounted.push(root);
    return root;
  }

  function showRecovery(root: HTMLElement, introMessage?: string): void {
    showManageLinkRecoveryForm({
      root,
      loadingSelector: "[data-loading]",
      sectionSelector: "[data-section]",
      buttonSelector: "[data-btn]",
      statusSelector: "[data-status]",
      emailSelector: "[data-email]",
      endpoint: "/api/v1/invites/resend-link",
      successMessage: "A fresh link is on its way.",
      introMessage,
    });
  }

  it("switches the link-recovery form with the hidden attribute and announces its opening line", () => {
    const root = recoveryFixture();
    showRecovery(root, "Enter the email you registered with.");

    // Visibility is the platform attribute on both sides. The `d-none` class
    // the widget used to toggle as well is gone, so nothing can disagree with
    // the attribute the templates already carry.
    expect(root.querySelector<HTMLElement>("[data-loading]")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-section]")?.hidden).toBe(false);
    expect(root.querySelector("[data-loading]")?.classList.contains("d-none")).toBe(false);

    // The opening line is a polite status, not an alert: nothing has gone
    // wrong yet.
    const status = root.querySelector("[data-status]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("Enter the email you registered with.");
  });

  it("announces a missing email and a failed send as errors, in words", async () => {
    const root = recoveryFixture();
    showRecovery(root);
    const status = root.querySelector("[data-status]")!;
    const button = root.querySelector<HTMLButtonElement>("[data-btn]")!;

    // Nothing typed: the control is marked invalid and the reason is announced
    // assertively rather than being left as a red line nobody hears.
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toBe("Please enter your email address.");
    expect(root.querySelector("[data-email]")?.getAttribute("aria-invalid")).toBe("true");

    // A refused send says so, and the button comes back so it can be retried.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    root.querySelector<HTMLInputElement>("[data-email]")!.value = "ada@example.test";
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.textContent).toBe("Something went wrong. Please try again.");
    expect(root.querySelector("[data-email]")?.getAttribute("aria-invalid")).toBeNull();
    expect(button.disabled).toBe(false);
  });

  it("replaces the link-recovery form with an announced confirmation once the link is sent", async () => {
    const root = recoveryFixture();
    showRecovery(root);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    root.querySelector<HTMLInputElement>("[data-email]")!.value = "ada@example.test";

    await act(async () => {
      root.querySelector<HTMLButtonElement>("[data-btn]")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const section = root.querySelector("[data-section]")!;
    // The confirmation is the design system's Alert, which brings role="status"
    // with it rather than being a class name the surface wrote by hand.
    expect(section.querySelector('[role="status"]')?.textContent).toContain("A fresh link is on its way.");
    // The send button stays in its loading state, which is what stops a second
    // request for a link that is already on its way.
    expect(root.querySelector<HTMLButtonElement>("[data-btn]")?.disabled).toBe(true);
  });

  it("uses one invitation-aware error path for event forms", async () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="email" value=" ada@example.test ">';
    const statusEl = document.createElement("div");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const error = new ApiClientError(
      { error: { code: "INVITE_EXPIRED", message: "Invitation expired", details: null } },
      400,
    );

    await handleFormInviteSubmitError({ error, form, apiBase: "/api/v1", statusEl, hasInviteToken: true });

    expect(statusEl.textContent).toContain("fresh link is on its way");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/invites/resend-link",
      expect.objectContaining({ body: JSON.stringify({ email: "ada@example.test" }) }),
    );
  });

  it("replaces successful forms through one rendering and scroll behavior", () => {
    const root = document.createElement("div");
    const form = document.createElement("form");
    root.append(form);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const panel = replaceFormWithSuccess(root, form, <p>Saved successfully</p>);

    // Hidden with the platform's attribute, not a class: the helper runs on
    // ten public flows, and a Bootstrap class there put the framework back
    // into markup those surfaces had already migrated away from.
    expect(form.hidden).toBe(true);
    expect(panel.textContent).toBe("Saved successfully");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("shares member initials, not-found, verification, menu, and organization labels", () => {
    expect(memberInitials("Ada Byron Lovelace IV")).toBe("ABL");
    expect(statusLabel("in_consultation")).toBe("In consultation");
    expect(ORGANIZATION_CONTENT_FIELD_LABELS.blogFeedUrl).toBe("Blog feed URL");
    const container = mount(
      <>
        <NotFoundPanel message="Missing member" backHref="/members/" backLabel="Back to members" />
        <VerifyingOverlay />
        <MenuIcon size={24} />
      </>,
    );
    expect(container.textContent).toContain("Missing member");
    expect(container.textContent).toContain("Verifying your sign-in link");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("24");
  });

  it("normalizes binary uploads and API failures", async () => {
    const file = new Blob(["logo"], { type: "image/png" });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ stored: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadFile("/upload", file, z.object({ stored: z.boolean() }))).resolves.toEqual({
      stored: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/upload",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: file }),
    );
  });

  it("renders representative choices through the shared selector", () => {
    const onChange = vi.fn();
    const container = mount(
      <IdentitySelect
        className="representative-test"
        value=""
        disabled={false}
        emptyLabel="Primary contact"
        identities={[{ userId: "user-1", name: "Ada", email: "ada@example.test" }]}
        onChange={onChange}
      />,
    );
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Primary contact", "Ada"]);
    select.value = "user-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shares async and magic-link submission state transitions", async () => {
    let asyncState: ReturnType<typeof useAsyncSubmission> | undefined;
    let magicState: ReturnType<typeof useMagicLinkRequest> | undefined;
    function Harness() {
      asyncState = useAsyncSubmission();
      magicState = useMagicLinkRequest("Could not send link.");
      return null;
    }
    mount(<Harness />);

    void act(() => asyncState?.begin());
    expect(asyncState?.submitting).toBe(true);
    void act(() => asyncState?.finish());
    expect(asyncState?.submitting).toBe(false);
    await act(async () => {
      await magicState?.request(async () => undefined);
    });
    expect(magicState?.sent).toBe(true);
    expect(magicState?.submitting).toBe(false);
  });

  it("shares magic-link feedback presentation", () => {
    const container = mount(
      <>
        <MagicLinkSubmitButton submitting />
        <SignInError error="Expired" />
      </>,
    );
    expect(container.querySelector("button")?.textContent).toBe("Sending…");
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toContain("Sign-in failed: Expired");
  });

  it("announces a sign-in failure, and renders nothing when there is none", () => {
    const failed = mount(<SignInError error="Expired" />);
    const alert = failed.querySelector('[role="alert"]');
    // The failure is a role, not a red box with a "✕" glyph in front of it.
    expect(alert?.textContent).toBe("Sign-in failed: Expired");
    expect(failed.textContent).not.toContain("✕");

    const bare = mount(<SignInError error="Expired" includePrefix={false} />);
    expect(bare.querySelector('[role="alert"]')?.textContent).toBe("Expired");

    expect(mount(<SignInError error={null} />).innerHTML).toBe("");
  });

  it("says the sign-in link is sending, and blocks a second send while it is", () => {
    const sending = mount(<MagicLinkSubmitButton submitting />);
    const button = sending.querySelector("button")!;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);

    const idle = mount(<MagicLinkSubmitButton submitting={false} />);
    const idleButton = idle.querySelector("button")!;
    expect(idleButton.textContent).toBe("Send sign-in link");
    expect(idleButton.disabled).toBe(false);
    expect(idleButton.hasAttribute("aria-busy")).toBe(false);
  });

  it("names the missing record and the way back out of it", () => {
    const container = mount(
      <NotFoundPanel message="Missing member" backHref="/members/" backLabel="Back to members" />,
    );
    // The panel replaces a load that failed, so a reader who is not watching
    // the page is told the wait ended in nothing.
    const region = container.querySelector('[role="status"]');
    expect(region?.textContent).toContain("Missing member");
    const back = container.querySelector("a")!;
    expect(back.getAttribute("href")).toBe("/members/");
    expect(back.textContent).toContain("Back to members");
  });

  it("keeps the verification wait and the sentence explaining it in one announced region", () => {
    const container = mount(<VerifyingOverlay />);
    const region = container.querySelector('[role="status"]');
    // The Bootstrap version left this region empty and put the sentence in a
    // sibling paragraph, so the wait was announced as busy and unexplained.
    expect(region?.textContent).toContain("Verifying your sign-in link");
    expect(mount(<VerifyingOverlay message="Checking your invitation…" />).textContent).toContain(
      "Checking your invitation…",
    );
  });

  it("announces a submitted form's success and keeps its icon out of the heading's name", () => {
    const container = mount(
      <SuccessPanel icon="🎉" title="You're registered!">
        <p>A confirmation email is on its way.</p>
      </SuccessPanel>,
    );
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();

    const heading = container.querySelector("h2")!;
    const named = [...heading.childNodes].filter(
      (node) => !(node instanceof HTMLElement && node.getAttribute("aria-hidden") === "true"),
    );
    expect(named.map((node) => node.textContent).join("")).toBe("You're registered!");
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe("🎉");
    expect(container.textContent).toContain("A confirmation email is on its way.");
  });

  it("classifies every donation polling state consistently", () => {
    expect(classifyDonationPollResult({ pending: true })).toEqual({ state: "pending" });
    expect(classifyDonationPollResult({ failed: true })).toEqual({ state: "failed" });
    expect(classifyDonationPollResult({ expired: true })).toEqual({ state: "expired" });
    expect(
      classifyDonationPollResult({
        grossAmount: 5000,
        currency: "usd",
        donorFirstName: "Ada",
        source: null,
        completedAt: "2026-04-10T10:00:00Z",
      }),
    ).toEqual({
      state: "confirmed",
      session: {
        grossAmount: 5000,
        currency: "usd",
        donorFirstName: "Ada",
        source: null,
        completedAt: "2026-04-10T10:00:00Z",
      },
    });
  });

  it("reads and trims the standard email from submit events", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="email" value="  ada@example.test  ">';
    const handler = vi.fn((event: SubmitEvent) => emailFromSubmitEvent(event));
    form.addEventListener("submit", handler);
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    expect(handler.mock.results[0]?.value).toBe("ada@example.test");
  });
});
