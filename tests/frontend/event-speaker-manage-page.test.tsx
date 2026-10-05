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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../assets/shared/schemas/proposal-management";
import { typeMarkdown } from "./helpers/labelled-control";
import { eventProposalProofVerifySchema } from "../../assets/shared/schemas/event-proposal-proof";
import {
  AUTH,
  READ,
  SPEAKER_USER_ID,
  TERMS,
  boot,
  chooseIndividual,
  installApi,
  json,
  mountShell,
  panel,
  personDetail,
  profileReceipt,
  signedInSession,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/?token=speaker-token-12345678901234567890");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

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
    expect(panel(root, "data-profile-section").hidden).toBe(false);
    expect(panel(root, "data-presentation-link").hidden).toBe(false);
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
    // same thing only to whoever could see the colour.
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

  it("requires choosing and saving representation before confirming participation", async () => {
    const root = mountShell();
    const requests = installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json(speakerTerms()),
      [AUTH]: () => signedInSession(),
      [`/api/v1/users/${SPEAKER_USER_ID}`]: () => personDetail(),
      [`${READ}/profile`]: () => profileReceipt(),
    });
    await boot();
    const confirmation = root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!;
    expect(confirmation.disabled).toBe(true);
    expect(root.textContent).toContain("Confirm and save your speaker identity");
    await chooseIndividual(root);
    expect(confirmation.disabled).toBe(true);
    await act(async () => {
      root
        .querySelector("[data-profile-form]")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const saved = speakerSelfProfilePatchSchema.parse(requests.find(({ method }) => method === "PATCH")?.body);
    expect(saved.actingIdentityId).toBeNull();
    expect(saved.unaffiliatedAttestation).toBe(true);
    expect(saved.organizationName).toBeUndefined();
    expect(saved.jobTitle).toBeUndefined();
    expect(confirmation.disabled).toBe(false);
    expect(requests.some(({ path }) => path === AUTH)).toBe(true);
    expect(requests.some(({ path }) => path === `/api/v1/users/${SPEAKER_USER_ID}`)).toBe(true);
    await act(async () => {
      root.querySelector<HTMLButtonElement>("[data-profile-edit]")!.click();
    });
    await typeMarkdown(root, "Biography", "An updated professional speaker biography for the conference program.");
    await act(async () => {
      root
        .querySelector("[data-profile-form]")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const biographySave = speakerSelfProfilePatchSchema.parse(
      requests.filter(({ method }) => method === "PATCH")[1].body,
    );
    expect(biographySave.actingIdentityId).toBeUndefined();
    expect(biographySave.biography).toContain("updated professional speaker biography");
  });

  it("submits the final external confirmation button through its terms form and restores it after refusal", async () => {
    const root = mountShell();
    const data = speakerPage();
    data.profile = {
      ...(data.profile as Record<string, unknown>),
      actingIdentitySelection: "individual",
      actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
    };
    let resolveParticipation!: (response: Response) => void;
    const term = {
      termKey: "speaker-agreement",
      version: "1",
      required: true,
      contentRef: null,
      displayText: "I accept the speaker agreement.",
    };
    const requests = installApi({
      [READ]: () => json(data),
      [TERMS]: () => json({ ...speakerTerms(), terms: [term] }),
      [`${READ}/participation`]: () => new Promise<Response>((resolve) => (resolveParticipation = resolve)),
    });
    await boot();
    const confirmation = root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!;
    expect(confirmation.disabled).toBe(false);
    await act(async () => {
      root.querySelector<HTMLInputElement>('input[name="consents"]')!.click();
      confirmation.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const submitted = requests.find(({ path }) => path === `${READ}/participation`)!;
    expect(submitted.method).toBe("PATCH");
    expect(speakerParticipationPatchSchema.parse(submitted.body)).toEqual({
      status: "confirmed",
      consents: [{ termKey: term.termKey, version: term.version }],
    });
    expect(confirmation.disabled).toBe(true);
    await act(async () => {
      resolveParticipation(json({ error: { code: "TEST_REFUSAL", message: "Please try confirming again." } }, 409));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(confirmation.disabled).toBe(false);
    expect(panel(root, "data-flow-status").textContent).toContain("Please try confirming again.");
  });

  it("retains a failed identity selection for retry and preserves a newer choice made during a save", async () => {
    const root = mountShell();
    let profileAttempt = 0;
    let resolveProfile!: (response: Response) => void;
    const pendingProfile = new Promise<Response>((resolve) => {
      resolveProfile = resolve;
    });
    const requests = installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json(speakerTerms()),
      [AUTH]: () => signedInSession(),
      [`/api/v1/users/${SPEAKER_USER_ID}`]: () => personDetail(),
      [`${READ}/profile`]: () => {
        profileAttempt += 1;
        if (profileAttempt === 1) return json({ error: "Try again" }, 409);
        return profileAttempt === 2 ? pendingProfile : profileReceipt();
      },
    });
    await boot();
    const submit = () =>
      root
        .querySelector("[data-profile-form]")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await chooseIndividual(root);
    await act(async () => {
      submit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      speakerSelfProfilePatchSchema.parse(requests.filter(({ method }) => method === "PATCH")[0].body).actingIdentityId,
    ).toBeNull();
    await act(() => {
      submit();
    });
    expect(
      speakerSelfProfilePatchSchema.parse(requests.filter(({ method }) => method === "PATCH")[1].body).actingIdentityId,
    ).toBeNull();
    // Even selecting the same value again is a newer deliberate choice.
    await chooseIndividual(root);
    await act(async () => {
      resolveProfile(profileReceipt());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!.disabled).toBe(true);
    expect(panel(root, "data-profile-form-wrap").hidden).toBe(false);
    await act(async () => {
      submit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      speakerSelfProfilePatchSchema.parse(requests.filter(({ method }) => method === "PATCH")[2].body).actingIdentityId,
    ).toBeNull();
    expect(root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!.disabled).toBe(false);
  });

  it("never enumerates identities when the speaker capability is expired", async () => {
    const root = mountShell();
    const requests = installApi({ [READ]: () => json({ error: "Expired", code: "TOKEN_EXPIRED" }, 410) });
    await boot();
    expect(root.querySelector('[role="combobox"]')).toBeNull();
    expect(requests.some(({ path }) => path.endsWith("/identities"))).toBe(false);
    expect(requests.some(({ path }) => path === AUTH)).toBe(false);
  });

  it.each(["guest", "different account"])(
    "keeps invitation editing available for a %s without enumerating identities or changing representation",
    async (actor) => {
      const root = mountShell();
      const data = speakerPage();
      data.profile = {
        ...(data.profile as Record<string, unknown>),
        actingIdentityId: "00000000-0000-4000-8000-000000000042",
        actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
        actingIdentitySelection: "identity",
        organizationName: "Recorded Example Labs",
      };
      const requests = installApi({
        [READ]: () => json(data),
        [TERMS]: () => json(speakerTerms()),
        [AUTH]: () =>
          actor === "guest"
            ? json({ error: "Unauthorized" }, 401)
            : signedInSession("00000000-0000-4000-8000-000000000099"),
        [`${READ}/profile`]: () => profileReceipt(data),
      });
      await boot();
      expect(root.querySelector('[role="combobox"]')).toBeNull();
      expect(panel(root, "data-speaker-identity").hidden).toBe(false);
      expect(root.textContent).not.toContain("Representation needs review");
      expect(root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!.disabled).toBe(false);
      expect(root.querySelector('input[name="organizationName"]')).toBeNull();
      await typeMarkdown(root, "Biography", "A biography for this session only, retaining the recorded affiliation.");
      await act(async () => {
        root
          .querySelector("[data-profile-form]")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const request = requests.find(({ method }) => method === "PATCH")!;
      const saved = speakerSelfProfilePatchSchema.parse(request.body);
      expect(saved.organizationName).toBeUndefined();
      expect(saved.firstName).toBeUndefined();
      expect(saved.biography).toContain("retaining the recorded affiliation");
      expect(Object.hasOwn(request.body as object, "actingIdentityId")).toBe(false);
      expect(requests.some(({ path }) => path.endsWith("/identities"))).toBe(false);
    },
  );

  it("requires verified representation for an unrecorded guest while retaining invitation access", async () => {
    const root = mountShell();
    const requests = installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });
    await boot();
    expect(root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!.disabled).toBe(true);
    expect(root.querySelector('[role="combobox"]')).toBeNull();
    expect(root.textContent).not.toContain("Representation needs review");
    expect(requests.some(({ path }) => path.endsWith("/identities"))).toBe(false);
  });

  it("resumes guest individual proof on the exact speaker capability and saves selection before confirmation", async () => {
    history.replaceState({}, "", location.pathname + location.search + "#verify=" + "v".repeat(40));
    const root = mountShell();
    const proof = "/api/v1/events/pqc-2026/proposals/proof/verify";
    const requests = installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json(speakerTerms()),
      [proof]: () =>
        json({
          status: "ready",
          continuationToken: "c".repeat(40),
          applicantKind: "individual",
          email: "ada@example.test",
          organization: null,
          person: {
            email: "ada@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        }),
      [`${READ}/profile`]: () => profileReceipt(),
    });
    await boot();
    await vi.waitFor(() => expect(panel(root, "data-speaker-identity").textContent).toContain("Ada Lovelace"));
    const verified = eventProposalProofVerifySchema.parse(requests.find(({ path }) => path === proof)?.body);
    expect(verified.speakerManagementToken).toBe("speaker-token-12345678901234567890");
    expect(location.hash).toContain("verify");
    await act(async () => {
      root
        .querySelector("[data-profile-form]")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const saved = speakerSelfProfilePatchSchema.parse(requests.find(({ method }) => method === "PATCH")?.body);
    expect(saved.continuationToken).toBe("c".repeat(40));
    expect(saved.actingIdentityId).toBeNull();
    expect(saved.unaffiliatedAttestation).toBe(true);
    expect(saved.firstName).toBeUndefined();
    expect(location.hash).toBe("");
    expect(root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!.disabled).toBe(false);
    expect(requests.some(({ path }) => path === AUTH)).toBe(false);
  });

  it("toggles the decline panel through the attribute, both ways", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    const decline = panel(root, "data-decline-panel");
    expect(decline.hidden).toBe(true);

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
