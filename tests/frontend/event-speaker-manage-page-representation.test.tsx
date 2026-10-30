// @vitest-environment jsdom
/** Choosing and saving the speaker's representation before confirming participation. */
import { describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../assets/shared/schemas/proposal-management";
import { typeMarkdown } from "./helpers/labeled-control";
import { eventProposalProofIdentityPatchSchema } from "../../assets/shared/schemas/event-proposal-proof";
import {
  AUTH,
  INDIVIDUAL_IDENTITY_ID,
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
  resetSpeakerPageBetweenTests,
  signedInSession,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

const IDENTITY_PROFILE = `/api/v1/events/pqc-2026/proposals/proof/identities/${INDIVIDUAL_IDENTITY_ID}`;

resetSpeakerPageBetweenTests();

describe("speaker self-service representation", () => {
  it("requires choosing and saving representation before confirming participation", async () => {
    const root = mountShell();
    const requests = installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json(speakerTerms()),
      [AUTH]: () => signedInSession(),
      [`/api/v1/users/${SPEAKER_USER_ID}`]: () => personDetail(),
      [`${READ}/profile`]: () => profileReceipt(),
      [IDENTITY_PROFILE]: () =>
        json({
          identityId: INDIVIDUAL_IDENTITY_ID,
          organizationId: null,
          jobTitle: null,
          biography: "An updated professional speaker biography for the conference program.",
          links: [],
        }),
    });
    await boot();
    const confirmation = root.querySelector<HTMLButtonElement>("[data-confirm-participation]")!;
    expect(confirmation.disabled).toBe(true);
    expect(root.textContent).toContain("Confirm and save your speaker identity");
    // Nothing is chosen yet, so there is no save to offer.
    const save = root.querySelector<HTMLElement>("[data-profile-save]")!;
    expect(save.hidden).toBe(true);
    await chooseIndividual(root);
    expect(save.hidden).toBe(false);
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
    // The saved state confirms the save once, beside the profile; the page status does not repeat it.
    expect(panel(root, "data-profile-saved-state").hidden).toBe(false);
    expect(root.querySelector("[data-flow-status]")?.textContent).not.toContain("Speaker identity saved.");
    expect(requests.some(({ path }) => path === AUTH)).toBe(true);
    expect(requests.some(({ path }) => path === `/api/v1/users/${SPEAKER_USER_ID}`)).toBe(true);
    // The biography is the chosen identity's: edited on the identity, through this speaker link.
    expect(panel(root, "data-identity-profile").hidden).toBe(false);
    expect(root.querySelector('[data-profile-form] [name="biography"]')).toBeNull();
    await typeMarkdown(
      root,
      "Your speaker bio",
      "An updated professional speaker biography for the conference program.",
    );
    await act(async () => {
      root
        .querySelector("[data-identity-profile-form] form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const identitySave = requests.find(({ path }) => path === IDENTITY_PROFILE);
    expect(identitySave?.method).toBe("PATCH");
    const body = eventProposalProofIdentityPatchSchema.parse(identitySave!.body);
    expect(body.biography).toContain("updated professional speaker biography");
    expect(body.speakerManagementToken).toBe("speaker-token-12345678901234567890");
    expect(requests.filter(({ path }) => path === `${READ}/profile`)).toHaveLength(1);
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
    // Busy the way the design system's Button is: announced and inert, but still focusable.
    expect(confirmation.getAttribute("aria-busy")).toBe("true");
    expect(confirmation.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      resolveParticipation(json({ error: { code: "TEST_REFUSAL", message: "Please try confirming again." } }, 409));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(confirmation.hasAttribute("aria-busy")).toBe(false);
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
});
