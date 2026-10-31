// @vitest-environment jsdom
/** The speaker self-service page opened from, or resuming, an email proof. */
import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { NEW_TAB_HINT } from "../../assets/ts/ui/new-tab";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { eventProposalProofVerifySchema } from "../../assets/shared/schemas/event-proposal-proof";
import {
  AUTH,
  READ,
  TERMS,
  boot,
  installApi,
  json,
  mountShell,
  panel,
  profileReceipt,
  resetSpeakerPageBetweenTests,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";

resetSpeakerPageBetweenTests();

describe("speaker self-service email proof", () => {
  it("opens email verification directly on the invited speaker using a resumed capability", async () => {
    history.replaceState({}, "", "/events/2026/pqc-2026/speaker/#verify=" + "v".repeat(40));
    const root = mountShell();
    const requests = installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => {
        history.replaceState(history.state, "", location.pathname + location.search);
        return json(speakerTerms());
      },
      ["/api/v1/events/pqc-2026/proposals/proof/verify"]: () =>
        json({
          status: "ready",
          consents: [],
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: "ada@example.test",
          organization: {
            id: "00000000-0000-4000-8000-000000000052",
            name: "Analytical Engines",
            jobTitle: "Engineer",
          },
          person: {
            email: "ada@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
          speakerManagementToken: "speaker-token-12345678901234567890",
          speakerManageUrl: "http://localhost/events/2026/pqc-2026/speaker/?token=speaker-token-12345678901234567890",
        }),
    });
    await boot();
    expect(panel(root, "data-speaker-content").hidden).toBe(false);
    expect(new URL(location.href).searchParams.get("token")).toBe("speaker-token-12345678901234567890");
    expect(location.hash).toBe("");
    expect(requests.some(({ path }) => path === READ)).toBe(true);
    await vi.waitFor(() => expect(root.textContent).toContain("Analytical Engines"));
    expect(root.querySelector('[data-speaker-identity] input[type="email"]')).toBeNull();
    expect(requests.filter(({ path }) => path.endsWith("/proof/verify"))).toHaveLength(1);
    const addRepresentation = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Add representation",
    );
    expect(addRepresentation).toBeDefined();
    await act(async () => addRepresentation!.click());
    await vi.waitFor(() => expect(root.querySelector('[data-speaker-identity] input[type="email"]')).not.toBeNull());
    expect(requests.filter(({ path }) => path.endsWith("/proof/verify"))).toHaveLength(1);
  });

  it("preserves the invitation and offers account sign-in instead of requesting the email again", async () => {
    const verification = "v".repeat(40);
    history.replaceState({}, "", "/events/2026/pqc-2026/speaker/#verify=" + verification);
    const root = mountShell();
    const requests = installApi({
      ["/api/v1/events/pqc-2026/proposals/proof/verify"]: () =>
        json({ status: "sign_in_required", email: "ada@example.test" }),
    });
    await boot();
    const signIn = root.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(signIn?.getAttribute("href")).toBe("/portal/");
    expect(signIn?.textContent).toBe(`Sign in ${NEW_TAB_HINT}`);
    expect(signIn?.closest(".pk-sr-only")).toBeNull();
    expect(signIn?.closest("p[data-flow-status]")).toBeNull();
    expect(signIn?.closest("[hidden]")).toBeNull();
    expect(root.textContent).toContain("using your existing account");
    expect(panel(root, "data-resend-speaker-manage-section").hidden).toBe(true);
    expect(location.hash).toBe("#verify=" + verification);
    expect(requests.some(({ path }) => path === READ)).toBe(false);
  });

  it("does not load a speaker when email proof belongs to an initial proposal", async () => {
    history.replaceState({}, "", "/events/2026/pqc-2026/speaker/#verify=" + "v".repeat(40));
    mountShell();
    const requests = installApi({
      ["/api/v1/events/pqc-2026/proposals/proof/verify"]: () =>
        json({
          status: "ready",
          consents: [],
          continuationToken: "c".repeat(40),
          applicantKind: "individual",
          email: "ada@example.test",
          organization: null,
          person: null,
        }),
    });
    await boot();
    expect(requests.some(({ path }) => path === READ)).toBe(false);
    expect(document.body.textContent).toContain("could not confirm this speaker invitation");
  });

  it("resumes guest individual proof on the exact speaker capability and saves selection before confirmation", async () => {
    history.replaceState({}, "", location.pathname + location.search + "#verify=" + "v".repeat(40));
    const root = mountShell();
    const proof = "/api/v1/events/pqc-2026/proposals/proof/verify";
    // The account's mailbox was proved before, so the link alone may not change its photo.
    const requests = installApi({
      [READ]: () => json(speakerPage({ personalDetailsEditable: false })),
      [TERMS]: () => json(speakerTerms()),
      [proof]: () =>
        json({
          status: "ready",
          consents: [],
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
      [`${READ}/profile`]: () => profileReceipt(undefined, { personalDetailsEditable: false }),
    });
    await boot();
    await vi.waitFor(() => expect(panel(root, "data-speaker-identity").textContent).toContain("Ada Lovelace"));
    const photoButton = () => root.querySelector('[data-headshot-section] button[aria-label^="Upload photo of"]');
    expect(photoButton()).toBeNull();
    await completeIndependentCapacityDisclosure(root);
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
    expect(photoButton()).not.toBeNull(); // The saved proof speaks for the account in this step.
  });
});
