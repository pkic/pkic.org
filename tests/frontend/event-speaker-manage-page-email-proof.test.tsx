// @vitest-environment jsdom
/** The speaker self-service page opened from, or resuming, an email proof. */
import { describe, expect, it } from "vitest";
import { NEW_TAB_HINT } from "../../assets/ts/ui/new-tab";
import {
  READ,
  boot,
  installApi,
  json,
  mountShell,
  panel,
  resetSpeakerPageBetweenTests,
} from "./helpers/speaker-manage-page-fixture";

resetSpeakerPageBetweenTests();

describe("speaker self-service email proof", () => {
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
});
