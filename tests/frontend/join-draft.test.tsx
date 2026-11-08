// @vitest-environment jsdom
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberJoinVerifySchema } from "../../assets/shared/schemas/member-join";
import { JoinFlow } from "../../assets/ts/site/JoinFlow";
import {
  forgetJoinDraft,
  rememberJoinToken,
  rememberJoinChoice,
  rememberedJoinChoice,
  rememberedJoinToken,
  restoreJoinAnswers,
  saveJoinAnswers,
} from "../../assets/ts/member-flows/join-draft";
import { renderMembershipApplicationQuestions } from "../../assets/ts/member-flows/join-application-fields";
import { readCustomFieldValues } from "../../assets/ts/shared/widgets/custom-fields";
const organizationContext = {
  status: "application_ready",
  applicantEmail: "ada@example-corp.test",
  applicantKind: "organization",
  joinToken: "a".repeat(32),
};

describe("a verified application kept for this tab", () => {
  it("restores the verified organization selection only for the same link", () => {
    rememberJoinToken("token-1");
    rememberJoinChoice({ organizationName: "Example Organization", domain: "division.example.test" });
    expect(rememberedJoinChoice()).toEqual({
      organizationName: "Example Organization",
      domain: "division.example.test",
    });
    rememberJoinToken("token-2");
    expect(rememberedJoinChoice()).toBeUndefined();
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
    rememberJoinToken("token-1");
    const before = applicationForm();
    before.querySelector<HTMLInputElement>('input[value="B"]')!.checked = true;
    before.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    before.querySelector<HTMLInputElement>('[name="custom.agrees_bylaws"]')!.checked = true;
    saveJoinAnswers(before);
    expect(JSON.parse(sessionStorage.getItem("pkic.join.verifiedApplication")!).answers).not.toHaveProperty(
      "agrees_bylaws",
    );
    before.remove();

    expect(rememberedJoinToken()).toBe("token-1");
    const after = applicationForm();
    const categoryChanges: string[] = [];
    after.addEventListener("change", (event) => categoryChanges.push((event.target as HTMLInputElement).value));
    expect(restoreJoinAnswers(after, () => undefined)).toBe(true);
    expect(categoryChanges).toEqual(["B"]);
    expect(after.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe("Jane");
    expect(after.querySelector<HTMLInputElement>('[name="custom.agrees_bylaws"]')!.checked).toBe(false);
  });

  it("preserves an unfinished answer even when it exceeds the submission limit", () => {
    rememberJoinToken("token-1");
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

  it.each(["{", JSON.stringify({ token: "token-1", values: { firstName: {} }, checked: [], answers: {} })])(
    "ignores malformed stored drafts",
    (stored) => {
      sessionStorage.setItem("pkic.join.verifiedApplication", stored);
      expect(rememberedJoinToken()).toBeNull();
      expect(restoreJoinAnswers(applicationForm(), () => undefined)).toBe(false);
    },
  );

  it("starts a fresh draft for another link and forgets everything after submitting", () => {
    rememberJoinToken("token-1");
    const form = applicationForm();
    form.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    saveJoinAnswers(form);
    rememberJoinToken("token-2");
    expect(restoreJoinAnswers(applicationForm(), () => undefined)).toBe(false);
    forgetJoinDraft();
    expect(rememberedJoinToken()).toBeNull();
  });

  it("keeps and restores every question widget, including the stateful ones", async () => {
    const fields = [
      { key: "topics", fieldType: "multi_select", options: [{ value: "pqc", label: "PQC", active: true }] },
      { key: "score", fieldType: "number", validation: { uiWidget: "rating_stars", min: 1, max: 5 } },
      { key: "reason", fieldType: "textarea" },
      { key: "authority", fieldType: "boolean" },
    ].map((field, sortOrder) => ({ label: field.key, required: false, sortOrder, ...field })) as never;
    rememberJoinToken("token-1");

    const before = applicationForm();
    const beforeQuestions = before.querySelector<HTMLElement>("[data-custom-fields]")!;
    renderMembershipApplicationQuestions(beforeQuestions, fields);
    const saves: unknown[] = [];
    before.addEventListener("change", () => {
      saveJoinAnswers(before);
      saves.push(JSON.parse(sessionStorage.getItem("pkic.join.verifiedApplication")!).answers);
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

  it.each([503, 429, "network"] as const)(
    "retries a new verification link after a temporary failure without restoring the previous draft (%s)",
    async (failure) => {
      rememberJoinToken(organizationContext.joinToken);
      const oldForm = applicationForm();
      oldForm.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
      saveJoinAnswers(oldForm);
      const newToken = "b".repeat(32);
      history.replaceState({}, "", `/join/#verify=${newToken}`);
      document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
      const verifiedTokens: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!String(input).endsWith("/members/join/verify")) return new Response(null, { status: 500 });
          verifiedTokens.push(memberJoinVerifySchema.parse(JSON.parse(String(init?.body))).token);
          if (verifiedTokens.length === 1) {
            if (failure === "network") throw new TypeError("Network unavailable");
            return Response.json({ error: { code: "TEMPORARY_FAILURE", message: "Try again" } }, { status: failure });
          }
          return Response.json({ ...organizationContext, applicantEmail: "new@example-corp.test" });
        }),
      );
      vi.resetModules();
      await import("../../assets/ts/member-flows/join-form");
      await vi.waitFor(() =>
        expect(document.querySelector("[data-flow-status]")?.textContent).toMatch(/could not verify/i),
      );
      expect(document.querySelector("[data-flow-status]")?.textContent).toBe(
        "We could not verify your email right now. Refresh to try again.",
      );
      expect(window.location.hash).toBe("");
      expect(rememberedJoinToken()).toBe(newToken);

      // A fresh controller represents reloading after the address-bar link was removed.
      document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
      vi.resetModules();
      await import("../../assets/ts/member-flows/join-form");
      await vi.waitFor(() =>
        expect(document.querySelector("[data-flow-status]")?.textContent).toMatch(/could not load/i),
      );
      expect(verifiedTokens).toEqual([newToken, newToken]);
      const reloaded = applicationForm();
      expect(restoreJoinAnswers(reloaded, () => undefined)).toBe(false);
      expect(reloaded.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe("");
    },
  );

  it.each(["IDENTITY_DOMAIN_MISMATCH", "ORGANIZATION_AFFILIATION_CHANGED", "ORGANIZATION_NAME_IN_USE"])(
    "refreshes a stale saved choice once and preserves its refusal and answers (%s)",
    async (code) => {
      rememberJoinToken(organizationContext.joinToken);
      rememberJoinChoice({ organizationName: "Saved Organization", domain: "example-corp.test" });
      const before = applicationForm();
      before.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
      saveJoinAnswers(before);
      document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
      const requests: Array<ReturnType<typeof memberJoinVerifySchema.parse>> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(memberJoinVerifySchema.parse(JSON.parse(String(init?.body))));
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
        }),
      );
      vi.resetModules();
      await import("../../assets/ts/member-flows/join-form");
      await vi.waitFor(() =>
        expect(document.querySelector("[data-flow-status]")?.textContent).toContain("Choose your organization again."),
      );
      expect(requests).toHaveLength(2);
      expect(requests[1].domain).toBeUndefined();
      expect(rememberedJoinChoice()).toBeUndefined();
      const restored = applicationForm();
      expect(restoreJoinAnswers(restored, () => undefined)).toBe(true);
      expect(restored.querySelector<HTMLInputElement>('[name="firstName"]')!.value).toBe("Jane");
    },
  );

  it("offers a refresh without claiming saved answers for a first verification link", async () => {
    history.replaceState({}, "", `/join/#verify=${organizationContext.joinToken}`);
    document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    vi.resetModules();
    await import("../../assets/ts/member-flows/join-form");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-flow-status]")?.textContent).toBe(
        "We could not verify your email right now. Refresh to try again.",
      ),
    );
    expect(rememberedJoinToken()).toBe(organizationContext.joinToken);
  });

  it("leaves the kept answers alone when the application fails to load on a reload", async () => {
    rememberJoinToken(organizationContext.joinToken);
    const form = applicationForm();
    form.querySelector<HTMLInputElement>('[name="firstName"]')!.value = "Jane";
    saveJoinAnswers(form);
    const kept = sessionStorage.getItem("pkic.join.verifiedApplication");
    form.remove();

    document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/members/join/verify")
        ? Response.json(organizationContext)
        : new Response(null, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    await import("../../assets/ts/member-flows/join-form");

    const status = document.querySelector<HTMLElement>("[data-flow-status]")!;
    await vi.waitFor(() => expect(status.textContent).toMatch(/could not load/i));
    expect(sessionStorage.getItem("pkic.join.verifiedApplication")).toBe(kept);
  });
});

it.each([503, 410])(
  "keeps saved answers on a temporary verification refusal but clears an expired proof (%s)",
  async (statusCode) => {
    rememberJoinToken(organizationContext.joinToken);
    const form = document.createElement("form");
    form.innerHTML = '<input name="firstName" value="Jane" />';
    saveJoinAnswers(form);
    document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
    const kept = sessionStorage.getItem("pkic.join.verifiedApplication");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: statusCode === 410 ? "MEMBER_JOIN_LINK_EXPIRED" : "SERVICE_UNAVAILABLE",
              message: "Verification unavailable",
            },
          },
          { status: statusCode },
        ),
      ),
    );
    vi.resetModules();
    await import("../../assets/ts/member-flows/join-form");
    const status = document.querySelector<HTMLElement>("[data-flow-status]")!;
    await vi.waitFor(() => expect(status.textContent).toMatch(statusCode === 410 ? /expired/ : /saved answers/));
    expect(sessionStorage.getItem("pkic.join.verifiedApplication")).toBe(statusCode === 410 ? null : kept);
    vi.unstubAllGlobals();
    sessionStorage.clear();
  },
);
