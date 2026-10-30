// @vitest-environment jsdom
/**
 * The speaker self-service page, driven the way a browser drives it.
 *
 * The module runs `main()` at import, so each case builds the shortcode's
 * markup, stubs the network, then imports it. Two things moved with the
 * design-system migration and are asserted here because nothing else can see
 * them: visibility is now the platform's `hidden` attribute rather than
 * Bootstrap's `d-none` — a `display: none !important` class the attribute
 * cannot out-rank, so the two sides had to move together — and the status
 * pills are the system's `pk-badge` tones rather than `bg-success` and
 * friends. The failure path is the terms request: when it fails the reader
 * gets an announced alert rather than a red sentence.
 *
 * Email proof and representation live in the sibling
 * event-speaker-manage-page-*.test.tsx files.
 */
import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
  READ,
  TERMS,
  boot,
  installApi,
  json,
  mountShell,
  panel,
  resetSpeakerPageBetweenTests,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

resetSpeakerPageBetweenTests();

describe("speaker self-service page", () => {
  it("reveals the content through the hidden attribute the template carries, not a class", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    // `d-none` is `display: none !important`, which `hidden` cannot out-rank —
    // so a page that swapped one side without the other could never be shown.
    expect(panel(root, "data-speaker-loading").hidden).toBe(true);
    expect(panel(root, "data-speaker-content").hidden).toBe(false);
    expect(panel(root, "data-speaker-content").classList.contains("pk-container--narrow")).toBe(false);
    expect(panel(root, "data-speaker-content").classList.contains("pk-container--start")).toBe(true);
    // None of the panels this module switches carries a visibility class any
    // more; the attribute is the only switch.
    for (const name of [
      "data-speaker-content",
      "data-confirm-panel",
      "data-participation-actions",
      "data-decline-panel",
      "data-confirmed-msg",
      "data-declined-msg",
      "data-headshot-section",
      "data-profile-section",
      "data-presentation-link",
    ]) {
      expect(panel(root, name).className).not.toContain("d-none");
    }
  });

  it("paints both status pills with the design system's tone, not a Bootstrap background", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    const speakerBadge = panel(root, "data-speaker-status-badge");
    expect(speakerBadge.textContent).toBe("Invited");
    expect(speakerBadge.className).toBe("pk-badge pk-badge--warn");

    const proposalBadge = panel(root, "data-proposal-status-badge");
    expect(proposalBadge.textContent).toBe("Submitted");
    expect(proposalBadge.className).toBe("pk-badge pk-badge--info");
  });

  it("opens the confirm panel for an invited speaker", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    expect(panel(root, "data-confirm-panel").hidden).toBe(false);
    expect(panel(root, "data-participation-actions").hidden).toBe(false);
    expect(panel(root, "data-confirmed-msg").hidden).toBe(true);
    expect(panel(root, "data-declined-msg").hidden).toBe(true);
    // The editors are open for anyone who has not declined: the status branch
    // near the top of the module hides them for an invited speaker, and the
    // one at the bottom — which runs unconditionally — opens them again. That
    // ordering predates this migration and is preserved by it; the assertion
    // records what the page actually does rather than what the first branch
    // reads as.
    expect(panel(root, "data-headshot-section").hidden).toBe(false);
    expect(panel(root, "data-profile-section").hidden).toBe(false);
    const steps = ["data-confirm-form", "data-profile-section", "data-headshot-section", "data-participation-actions"];
    for (let index = 1; index < steps.length; index++)
      expect(panel(root, steps[index - 1]).compareDocumentPosition(panel(root, steps[index]))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    const confirmation = root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!;
    expect(confirmation.form).toBe(panel(root, "data-confirm-form"));
    expect(confirmation.closest("form")).toBeNull();
    expect(root.querySelector("form form")).toBeNull();
    expect(root.querySelector<HTMLButtonElement>("[data-decline-open]")!.disabled).toBe(false);
  });

  it("opens the editors for a confirmed speaker and the presentation link once accepted", async () => {
    const root = mountShell();
    installApi({
      [READ]: () => json(speakerPage({ status: "confirmed", proposalStatus: "accepted" })),
      [TERMS]: () => json(speakerTerms()),
    });

    await boot();

    expect(panel(root, "data-confirmed-msg").hidden).toBe(false);
    expect(panel(root, "data-participation-actions").hidden).toBe(true);
    expect(panel(root, "data-headshot-section").hidden).toBe(false);
    // The photo is the shared tile — the picture is the control, named for the
    // speaker — with no separate upload field or full-width remove button.
    const photoSection = panel(root, "data-headshot-section");
    expect(photoSection.querySelector('button[aria-label="Upload photo of Ada Lovelace"]')).not.toBeNull();
    expect(photoSection.querySelector('[role="status"]')).not.toBeNull();
    expect([...photoSection.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "Remove photo",
    );
    expect(panel(root, "data-profile-section").hidden).toBe(false);
    expect(panel(root, "data-presentation-link").hidden).toBe(false);
  });

  it("shows the account's name and photo read-only when the link alone may not change them", async () => {
    const root = mountShell();
    installApi({
      [READ]: () => json(speakerPage({ status: "confirmed", personalDetailsEditable: false })),
      [TERMS]: () => json(speakerTerms()),
    });

    await boot();

    const photoSection = panel(root, "data-headshot-section");
    expect(photoSection.hidden).toBe(false);
    expect(photoSection.querySelector('button[aria-label="Upload photo of Ada Lovelace"]')).toBeNull();
    const buttons = [...root.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).not.toContain("Edit my details");
    expect(root.textContent).toContain("Sign in to change the name or photo on your account.");
  });

  it("keeps the editors closed for a speaker who declined", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage({ status: "declined" })), [TERMS]: () => json(speakerTerms()) });

    await boot();

    expect(panel(root, "data-declined-msg").hidden).toBe(false);
    expect(panel(root, "data-participation-actions").hidden).toBe(true);
    expect(panel(root, "data-headshot-section").hidden).toBe(true);
    expect(panel(root, "data-profile-section").hidden).toBe(true);
  });

  it("announces a failed terms request as an alert rather than a red sentence", async () => {
    const root = mountShell();
    installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json({ error: "unavailable" }, 503),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await boot();

    const consents = panel(root, "data-speaker-consents");
    const alert = consents.querySelector(".pk-alert");
    // `role="alert"` is what interrupts; a `text-danger` paragraph said the
    // same thing only to whoever could see the color.
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.className).toContain("pk-alert--danger");
    expect(alert?.textContent).toContain("Could not load required terms right now.");
  });

  it("shows the recovery form and reaches no speaker resource when the token is absent", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/");
    const root = mountShell();
    const requests = installApi({});

    await boot();

    expect(requests.some(({ path }) => path.startsWith("/api/v1/proposals/speakers/access/"))).toBe(false);
    expect(panel(root, "data-resend-speaker-manage-section").hidden).toBe(false);
    expect(panel(root, "data-speaker-content").hidden).toBe(true);
  });

  it("toggles the decline panel through the attribute, both ways", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    const decline = panel(root, "data-decline-panel");
    expect(decline.hidden).toBe(true);
    // Declining is named for what it does and kept out of the confirm action's cluster.
    const open = panel(root, "data-decline-open");
    expect(open.textContent).toBe("Decline participation…");
    expect(open.classList.contains("pk-btn--danger-quiet")).toBe(true);
    expect(open.closest(".pk-cluster")!.querySelector("[data-confirm-participation]")).toBeNull();
    expect(panel(root, "data-decline-confirm").textContent).toBe("Decline participation");

    await act(async () => {
      panel(root, "data-decline-open").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(decline.hidden).toBe(false);

    await act(async () => {
      panel(root, "data-decline-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(decline.hidden).toBe(true);
  });
});
