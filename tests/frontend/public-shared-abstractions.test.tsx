// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { z } from "zod";
import { ConsentCard, ConsentList } from "../../assets/ts/components/ConsentCard";
import { MagicLinkSubmitButton, SignInError } from "../../assets/ts/components/MagicLinkFeedback";
import { MenuIcon } from "../../assets/ts/components/MenuIcon";
import { NotFoundPanel } from "../../assets/ts/components/NotFoundPanel";
import { SuccessPanel } from "../../assets/ts/components/SuccessPanel";
import { VerifyingOverlay } from "../../assets/ts/components/VerifyingOverlay";
import { findEmailReviewCard } from "../../assets/ts/event-flows/registration-page";
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
import { controlFor, labelNames } from "./helpers/labelled-control";

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

describe("public shared frontend abstractions", () => {
  it("keeps featured and compact consent cards on the same interactive frame", () => {
    const compact = mount(
      <ConsentCard
        term={{ termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" }}
      />,
    );
    const featured = mount(
      <ConsentCard
        term={{
          termKey: "conduct",
          version: "2",
          required: false,
          contentRef: "/conduct/",
          displayText: "Code of conduct",
          helpText: "Please review this policy.",
        }}
      />,
    );

    // Both shapes agree through one real checkbox, named by its own label —
    // not a div claiming role="checkbox" that only a mouse could reach.
    for (const [container, label] of [
      [compact, "Privacy"],
      [featured, "Code of conduct"],
    ] as const) {
      const consent = controlFor(container, label);
      expect(consent.type).toBe("checkbox");
      expect(consent.checked).toBe(false);
      void act(() => consent.click());
      expect(consent.checked).toBe(true);
    }
    expect(featured.textContent).toContain("Please review this policy.");
    // The help text is not just nearby, it is announced with the control.
    const conduct = controlFor(featured, "Code of conduct");
    const describedBy = conduct.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(featured.querySelector(`#${describedBy ?? ""}`)?.textContent).toContain("Please review this policy.");
  });

  it("announces a required consent that a validation pass rejected", () => {
    const container = mount(
      <ConsentCard
        term={{ termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" }}
      />,
    );
    const form = document.createElement("form");
    document.body.append(form);
    const consent = controlFor(container, "Privacy");
    form.append(consent);

    expect(container.querySelector('[role="alert"]')).toBeNull();

    // What the event flows do on submit: the platform fires `invalid` at every
    // control that fails, and the card takes its state from that rather than
    // from a script reaching in to set a class.
    void act(() => {
      form.checkValidity();
    });

    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toContain("You need to agree to this to continue.");
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(consent.getAttribute("aria-describedby")).toBe(message?.id);

    // Agreeing clears it, without anything else having to be told.
    void act(() => consent.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(consent.getAttribute("aria-invalid")).toBeNull();
    form.remove();
  });

  it("names the consent list's terms without repeating an unagreed one as required", () => {
    const container = mount(
      <ConsentList
        terms={[
          { termKey: "privacy", version: "1", required: true, contentRef: null, displayText: "Privacy" },
          { termKey: "news", version: "1", required: false, contentRef: null, displayText: "Newsletter" },
        ]}
      />,
    );
    expect(labelNames(container)).toEqual(["Privacy", "Newsletter"]);
    expect(controlFor(container, "Privacy").required).toBe(true);
    expect(controlFor(container, "Newsletter").required).toBe(false);
    // "Optional" is a word, not a colour, so a reader who cannot separate the
    // hues still knows which of the two they may skip.
    expect(container.textContent).toContain("Optional");
  });

  it("reports no consents as a sentence rather than an empty region", () => {
    const container = mount(<ConsentList terms={[]} />);
    expect(container.textContent).toContain("No required consents for this flow.");
    expect(container.querySelector("input")).toBeNull();
  });

  it("finds the canonical registration email-review input and card", () => {
    const form = document.createElement("form");
    form.innerHTML = '<div data-email-review-card><input type="checkbox" name="emailReviewConfirmed"></div>';
    const review = findEmailReviewCard(form);
    expect(review?.confirmation.name).toBe("emailReviewConfirmed");
    expect(review?.card.dataset.emailReviewCard).toBe("");
  });

  it("loads speaker-page data once the common token context is valid", async () => {
    window.history.replaceState({}, "", "/speaker/?token=shared-token");
    document.body.innerHTML = `
      <main data-speaker-test data-event-slug="event-1" data-api-base="/api/v1">
        <form><div data-flow-status></div></form>
        <div data-speaker-loading></div><div data-speaker-content></div>
      </main>`;
    const request = vi.fn(async () => ({ speaker: "Ada" }));

    const loaded = await loadSpeakerPageData({ selector: "[data-speaker-test]", request });

    expect(request).toHaveBeenCalledWith("shared-token", expect.objectContaining({ eventSlug: "event-1" }));
    expect(loaded?.token).toBe("shared-token");
    expect(loaded?.data).toEqual({ speaker: "Ada" });
  });

  it("shows the shared speaker recovery state when the token is absent", async () => {
    document.body.innerHTML = `
      <main data-speaker-test data-event-slug="event-1">
        <form><div data-flow-status></div></form>
        <div data-speaker-loading></div>
        <section class="d-none" data-resend-speaker-manage-section>
          <button data-resend-speaker-manage-btn></button>
          <input data-resend-speaker-manage-email>
          <span data-resend-speaker-manage-status></span>
        </section>
      </main>`;

    const loaded = await loadSpeakerPageData({ selector: "[data-speaker-test]", request: vi.fn() });

    expect(loaded).toBeNull();
    expect(document.querySelector("[data-speaker-loading]")?.classList.contains("d-none")).toBe(true);
    expect(document.querySelector("[data-resend-speaker-manage-section]")?.classList.contains("d-none")).toBe(false);
    expect(document.querySelector("[data-resend-speaker-manage-status]")?.textContent).toContain(
      "Missing speaker token",
    );
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

    expect(form.classList.contains("d-none")).toBe(true);
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
