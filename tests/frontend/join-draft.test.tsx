// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberJoinVerifySchema } from "../../assets/shared/schemas/member-join";
import {
  forgetJoinDraft,
  rememberJoinApplicant,
  rememberJoinChoice,
  rememberedJoinChoice,
  restoreJoinAnswers,
  saveJoinAnswers,
} from "../../assets/ts/member-flows/join-draft";
import { JOIN_USER_ID, openJoinPage, personalIdentity } from "./helpers/join-page";
import { renderMembershipApplicationQuestions } from "../../assets/ts/member-flows/join-application-fields";
import { readCustomFieldValues } from "../../assets/ts/shared/widgets/custom-fields";
const organizationContext = {
  status: "application_ready",
  applicantEmail: "ada@example-corp.test",
  applicantKind: "organization",
  joinToken: "a".repeat(32),
};
const organizationPath = { unaffiliatedAttestation: false };

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const STORAGE_KEY = "pkic.join.verifiedApplication";

describe("a membership application kept for this tab", () => {
  it("restores the chosen path and organization only for the same account", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    const choice = {
      unaffiliatedAttestation: false,
      organizationName: "Example Organization",
      domain: "division.example.test",
    };
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

  function applicationForm(): HTMLFormElement {
    const form = document.createElement("form");
    form.innerHTML = `
      <input type="radio" name="membershipCategory" value="A" />
      <input type="radio" name="membershipCategory" value="B" />
      <input name="firstName" />
      <div data-custom-fields></div>
      <div data-membership-legal-field="bylaws">
        <input name="custom.agrees_bylaws" type="checkbox" data-membership-legal-input />
      </div>
    `;
    document.body.append(form);
    return form;
  }

  it("restores answers after a reload but never an agreement", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    const before = applicationForm();
    before.querySelector<HTMLInputElement>('input[value="B"]')!.checked = true;
    before.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    before.querySelector<HTMLInputElement>('[name="custom.agrees_bylaws"]')!.checked = true;
    saveJoinAnswers(before);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).answers).not.toHaveProperty("agrees_bylaws");
    before.remove();

    const after = applicationForm();
    const categoryChanges: string[] = [];
    after.addEventListener("change", (event) => categoryChanges.push((event.target as HTMLInputElement).value));
    expect(restoreJoinAnswers(after, () => undefined)).toBe(true);
    expect(categoryChanges).toEqual(["B"]);
    expect(after.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe("Jane");
    expect(after.querySelector<HTMLInputElement>('[name="custom.agrees_bylaws"]')!.checked).toBe(false);
  });

  it("preserves an unfinished answer even when it exceeds the submission limit", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    const before = applicationForm();
    const question = document.createElement("textarea");
    question.name = "custom.reason";
    question.value = "unfinished ".repeat(1001);
    before.append(question);
    saveJoinAnswers(before);
    const restored: Record<string, unknown>[] = [];
    expect(restoreJoinAnswers(applicationForm(), (answers) => restored.push(answers))).toBe(true);
    expect(restored[0].reason).toBe(question.value.trim());
  });

  it.each([
    "{",
    JSON.stringify({ applicantUserId: JOIN_USER_ID, values: { firstName: {} }, checked: [], answers: {} }),
  ])("ignores malformed stored drafts", (stored) => {
    sessionStorage.setItem(STORAGE_KEY, stored);
    expect(rememberedJoinChoice(JOIN_USER_ID)).toBeUndefined();
    expect(restoreJoinAnswers(applicationForm(), () => undefined)).toBe(false);
  });

  it("starts a fresh draft for another account and forgets everything after submitting", () => {
    rememberJoinApplicant(JOIN_USER_ID);
    const form = applicationForm();
    form.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    saveJoinAnswers(form);
    rememberJoinApplicant(OTHER_USER_ID);
    expect(restoreJoinAnswers(applicationForm(), () => undefined)).toBe(false);
    forgetJoinDraft();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps and restores every question widget, including the stateful ones", async () => {
    const fields = [
      { key: "topics", fieldType: "multi_select", options: [{ value: "pqc", label: "PQC", active: true }] },
      { key: "score", fieldType: "number", validation: { uiWidget: "rating_stars", min: 1, max: 5 } },
      { key: "reason", fieldType: "textarea" },
      { key: "authority", fieldType: "boolean" },
    ].map((field, sortOrder) => ({ label: field.key, required: false, sortOrder, ...field })) as never;
    rememberJoinApplicant(JOIN_USER_ID);

    const before = applicationForm();
    const beforeQuestions = before.querySelector<HTMLElement>("[data-custom-fields]")!;
    renderMembershipApplicationQuestions(beforeQuestions, fields);
    const saves: unknown[] = [];
    before.addEventListener("change", () => {
      saveJoinAnswers(before);
      saves.push(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).answers);
    });
    beforeQuestions.querySelector<HTMLButtonElement>('[data-tag-chip][data-value="pqc"]')!.click();
    await vi.waitFor(() => expect(saves.at(-1)).toMatchObject({ topics: ["pqc"] }));
    beforeQuestions.querySelector<HTMLButtonElement>('button[data-value="4"]')!.click();
    expect(saves.at(-1)).toMatchObject({ topics: ["pqc"], score: 4 });
    beforeQuestions.querySelector<HTMLTextAreaElement>('[name="custom.reason"]')!.value = "We run a CA.";
    beforeQuestions.querySelector<HTMLInputElement>('[name="custom.authority"]')!.checked = true;
    saveJoinAnswers(before);
    before.remove();

    const after = applicationForm();
    const afterQuestions = after.querySelector<HTMLElement>("[data-custom-fields]")!;
    const restored = restoreJoinAnswers(after, (answers) =>
      renderMembershipApplicationQuestions(afterQuestions, fields, answers),
    );
    expect(restored).toBe(true);
    await vi.waitFor(() =>
      expect(readCustomFieldValues(after)).toEqual({
        topics: ["pqc"],
        score: 4,
        reason: "We run a CA.",
        authority: true,
        agrees_bylaws: false,
      }),
    );
  });

  /** The draft a signed-in applicant left in this tab: their path, and one answer. */
  function keepDraft(choice: Parameters<typeof rememberJoinChoice>[0] = organizationPath): string {
    rememberJoinApplicant(JOIN_USER_ID);
    rememberJoinChoice(choice);
    const form = applicationForm();
    form.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    saveJoinAnswers(form);
    form.remove();
    return sessionStorage.getItem(STORAGE_KEY)!;
  }

  async function reload(): Promise<HTMLElement> {
    vi.resetModules();
    await import("../../assets/ts/member-flows/join-form");
    return document.querySelector<HTMLElement>("[data-flow-status]")!;
  }

  it.each([503, 429, "network"] as const)(
    "keeps the path and answers when the membership path cannot be read right now (%s)",
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

  it("asks to sign in again when the session ended, and keeps the answers", async () => {
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
    keepDraft({ unaffiliatedAttestation: false, organizationName: "Saved Organization", domain: "example-corp.test" });
    sessionStorage.setItem(STORAGE_KEY, sessionStorage.getItem(STORAGE_KEY)!.replace(JOIN_USER_ID, OTHER_USER_ID));
    const requests = openJoinPage([personalIdentity]);
    await reload();
    await vi.waitFor(() => expect(document.querySelector('input[name="joinPath"]')).not.toBeNull());
    // No path is chosen for this account yet, so nothing was asked or restored on its behalf.
    expect(document.querySelector('input[name="joinPath"]:checked')).toBeNull();
    expect(requests).toEqual([]);
  });

  it.each(["IDENTITY_DOMAIN_MISMATCH", "ORGANIZATION_AFFILIATION_CHANGED", "ORGANIZATION_NAME_IN_USE"])(
    "refreshes a stale saved choice once and preserves its refusal and answers (%s)",
    async (code) => {
      keepDraft({
        unaffiliatedAttestation: false,
        organizationName: "Saved Organization",
        domain: "example-corp.test",
      });
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
          organizations: [],
          affiliation: {
            email: organizationContext.applicantEmail,
            domain: "example-corp.test",
            domains: [],
            organization: null,
            organizations: [],
          },
        });
      });
      const status = await reload();
      await vi.waitFor(() => expect(status.textContent).toContain("Choose your organization again."));
      const choices = requests.map(({ body }) => memberJoinVerifySchema.parse(body));
      expect(choices).toEqual([
        { unaffiliatedAttestation: false, organizationName: "Saved Organization", domain: "example-corp.test" },
        organizationPath,
      ]);
      expect(rememberedJoinChoice(JOIN_USER_ID)).toEqual(organizationPath);
      const restored = applicationForm();
      expect(restoreJoinAnswers(restored, () => undefined)).toBe(true);
      expect(restored.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe("Jane");
    },
  );

  it("leaves the kept answers alone when the application fails to load on a reload", async () => {
    const kept = keepDraft();
    openJoinPage([personalIdentity], ({ path }) =>
      path.endsWith("/members/join/verify") ? Response.json(organizationContext) : new Response(null, { status: 500 }),
    );
    const status = await reload();
    await vi.waitFor(() => expect(status.textContent).toMatch(/could not load the membership application/i));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(kept);
  });
});
