// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberJoinVerifySchema } from "../../assets/shared/schemas/member-join";
import {
  forgetJoinDraft,
  rememberJoinApplicant,
  rememberJoinChoice,
  rememberedJoinChoice,
} from "../../assets/ts/member-flows/join-draft";
import { JOIN_USER_ID, openJoinPage, personalIdentity } from "./helpers/join-page";
const organizationContext = {
  status: "application_ready",
  applicantEmail: "ada@example-corp.test",
  applicantKind: "organization",
  joinToken: "a".repeat(32),
};
const organizationPath = { unaffiliatedAttestation: false };
const SAVED_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000042";

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const STORAGE_KEY = "pkic.join.verifiedApplication";

describe("a membership path kept for this tab", () => {
  it("restores the chosen path and organization only for the same account", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    const choice = { unaffiliatedAttestation: true, organizationId: SAVED_ORGANIZATION_ID };
    rememberJoinChoice(choice);
    expect(rememberedJoinChoice(JOIN_USER_ID)).toEqual(choice);
    expect(rememberedJoinChoice(OTHER_USER_ID)).toBeUndefined();
    rememberJoinApplicant(OTHER_USER_ID);
    expect(rememberedJoinChoice(JOIN_USER_ID)).toBeUndefined();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    vi.unstubAllGlobals();
    history.replaceState({}, "", "/");
  });

  it.each(["{", JSON.stringify({ applicantUserId: JOIN_USER_ID, choice: { unaffiliatedAttestation: "yes" } })])(
    "ignores malformed stored drafts",
    (stored) => {
      sessionStorage.setItem(STORAGE_KEY, stored);
      expect(rememberedJoinChoice(JOIN_USER_ID)).toBeUndefined();
    },
  );

  it("starts a fresh draft for another account and forgets everything after submitting", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    rememberJoinChoice(organizationPath);
    rememberJoinApplicant(OTHER_USER_ID);
    expect(rememberedJoinChoice(OTHER_USER_ID)).toBeUndefined();
    forgetJoinDraft();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  /** The path a signed-in applicant left in this tab. */
  function keepDraft(choice: Parameters<typeof rememberJoinChoice>[0] = organizationPath): string {
    rememberJoinApplicant(JOIN_USER_ID);
    rememberJoinChoice(choice);
    return sessionStorage.getItem(STORAGE_KEY)!;
  }

  async function reload(): Promise<HTMLElement> {
    vi.resetModules();
    await import("../../assets/ts/member-flows/join-form");
    return document.querySelector<HTMLElement>("[data-flow-status]")!;
  }

  it.each([503, 429, "network"] as const)(
    "keeps the path when the membership path cannot be read right now (%s)",
    async (failure) => {
      const kept = keepDraft();
      const requests = openJoinPage([personalIdentity], () => {
        if (failure === "network") throw new TypeError("Network unavailable");
        return Response.json({ error: { code: "TEMPORARY_FAILURE", message: "Try again" } }, { status: failure });
      });
      const status = await reload();
      await vi.waitFor(() =>
        expect(status.textContent).toBe("We could not load your membership options right now. Refresh to try again."),
      );
      expect(requests.map(({ path }) => path)).toEqual(["/api/v1/members/join/verify"]);
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe(kept);
    },
  );

  it("asks to sign in again when the session ended, and keeps the path", async () => {
    const kept = keepDraft();
    openJoinPage([personalIdentity], () =>
      Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in" } }, { status: 401 }),
    );
    const status = await reload();
    await vi.waitFor(() =>
      expect(status.textContent).toBe("Your session has ended. Refresh the page to sign in again."),
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(kept);
  });

  it("never shows one account's draft to another account on the same tab", async () => {
    keepDraft({ unaffiliatedAttestation: true, organizationId: SAVED_ORGANIZATION_ID });
    sessionStorage.setItem(STORAGE_KEY, sessionStorage.getItem(STORAGE_KEY)!.replace(JOIN_USER_ID, OTHER_USER_ID));
    const requests = openJoinPage([personalIdentity]);
    await reload();
    await vi.waitFor(() => expect(document.querySelector('input[name="joinPath"]')).not.toBeNull());
    // No path is chosen for this account yet, so nothing was asked or restored on its behalf.
    expect(document.querySelector('input[name="joinPath"]:checked')).toBeNull();
    expect(requests).toEqual([]);
  });

  it.each(["IDENTITY_DOMAIN_MISMATCH", "ORGANIZATION_AFFILIATION_CHANGED"])(
    "refreshes a stale saved choice once and preserves its refusal (%s)",
    async (code) => {
      const individualPath = { unaffiliatedAttestation: true };
      keepDraft({ ...individualPath, organizationId: SAVED_ORGANIZATION_ID });
      const requests = openJoinPage([personalIdentity], ({ path }) => {
        if (!path.endsWith("/members/join/verify")) return new Response(null, { status: 500 });
        if (requests.length === 1)
          return Response.json(
            { error: { code, message: "Choose your organization again." } },
            { status: code === "IDENTITY_DOMAIN_MISMATCH" ? 422 : 409 },
          );
        return Response.json({
          status: "organization_selection_required",
          domain: "example-corp.test",
          organizations: [{ id: SAVED_ORGANIZATION_ID, name: "Saved Organization" }],
          canApplyAsIndividual: true,
        });
      });
      const status = await reload();
      await vi.waitFor(() => expect(status.textContent).toContain("Choose your organization again."));
      const choices = requests.map(({ body }) => memberJoinVerifySchema.parse(body));
      expect(choices).toEqual([{ ...individualPath, organizationId: SAVED_ORGANIZATION_ID }, individualPath]);
      expect(rememberedJoinChoice(JOIN_USER_ID)).toEqual(individualPath);
    },
  );

  it("keeps the path when the application fails to load on a reload", async () => {
    const kept = keepDraft();
    openJoinPage([personalIdentity], ({ path }) =>
      path.endsWith("/members/join/verify") ? Response.json(organizationContext) : new Response(null, { status: 500 }),
    );
    const status = await reload();
    await vi.waitFor(() => expect(status.textContent).toMatch(/could not load the membership application/i));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(kept);
  });
});
