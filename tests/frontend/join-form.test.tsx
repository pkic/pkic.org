// @vitest-environment jsdom
import { renderToString } from "preact-render-to-string";
import { JoinFlow } from "../../assets/ts/site/JoinFlow";
import { installMembershipLegalValidation } from "../../assets/ts/member-flows/membership-legal-validation";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { installLiveValidation, validateBeforeSubmit } from "../../assets/ts/shared/form/validation";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApplicationPayload,
  applyCategoryUI,
  configureMembershipLegalFields,
  filterApplicationFieldsForApplicantKind,
  filterCategoriesForApplicantKind,
  membershipCategoryFeeText,
  renderMembershipCategorySummary,
  renderMembershipCategories,
  renderMembershipApplicationQuestions,
} from "../../assets/ts/member-flows/join-form";
import { memberApplicationCreateSchemaForCategory } from "../../assets/shared/schemas/member-applications";
import type { MemberApplicationFormResponse } from "../../assets/shared/schemas/member-applications";

type Category = MemberApplicationFormResponse["categories"][number];
type FormField = NonNullable<MemberApplicationFormResponse["form"]>["fields"][number];

const organizationContext = {
  status: "application_ready" as const,
  applicantEmail: "ada@example-corp.test",
  applicantKind: "organization" as const,
  joinToken: "a".repeat(32),
};

const individualContext = {
  ...organizationContext,
  applicantEmail: "ada@example.test",
  applicantKind: "individual" as const,
};

const categories: Category[] = [
  {
    code: "A",
    label: "Certification authority",
    description: "An organization category.",
    displayOrder: 10,
    isIndividual: false,
    requiresUniversityEmail: false,
    isVoting: true,
    active: true,
    workflowVersionId: null,
    eligibleWorkingGroupIds: [],
    fee: null,
    revision: 0,
    updatedAt: "2026-08-27T00:00:00.000Z",
  },
  {
    code: "H6",
    label: "Independent consultant",
    description: "An individual category.",
    displayOrder: 60,
    isIndividual: true,
    requiresUniversityEmail: false,
    isVoting: false,
    active: true,
    workflowVersionId: null,
    eligibleWorkingGroupIds: [],
    fee: {
      label: "Membership fee",
      instructions: "Pay after review.",
      amount: 12500,
      currency: "usd",
      deadlineDays: 14,
    },
    revision: 0,
    updatedAt: "2026-08-27T00:00:00.000Z",
  },
];

function formField(key: string, fieldType: FormField["fieldType"] = "boolean"): FormField {
  return {
    id: crypto.randomUUID(),
    key,
    label: `Configured ${key}`,
    fieldType,
    required: true,
    options: null,
    optionSource: null,
    validation: fieldType === "boolean" ? { requireTrue: true } : null,
    sortOrder: 1,
    updatedAt: "2026-08-30T00:00:00.000Z",
    archivedAt: null,
  };
}

function buildForm(overrides: Partial<Record<string, string>> = {}): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="firstName" value="${overrides.firstName ?? "Ada"}" />
    <input name="lastName" value="${overrides.lastName ?? "Lovelace"}" />
    <div data-organization-name-field>
      <input id="organizationName" name="organizationName" value="${overrides.organizationName ?? "Example Corp"}" />
    </div>
    <input name="custom.reason" value="Because PKI." />
    <input name="custom.warranted_authority" type="checkbox" checked />
  `;
  document.body.append(form);
  return form;
}

describe("join-form helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("builds the application payload for an organization category", () => {
    const form = buildForm();
    const payload = buildApplicationPayload(form, "A", organizationContext);
    expect(payload.applicantName).toBe("Ada Lovelace");
    expect(payload.applicantEmail).toBe("ada@example-corp.test");
    expect(payload.membershipCategory).toBe("A");
    expect(payload.organizationName).toBe("Example Corp");
    expect(payload.joinToken).toBe("a".repeat(32));
    expect(payload.answers.reason).toBe("Because PKI.");
    expect(payload.answers.warranted_authority).toBe(true);
  });

  it("omits organizationName for individual categories", () => {
    const form = buildForm({ organizationName: "" });
    const payload = buildApplicationPayload(form, "H6", individualContext);
    expect(payload.organizationName).toBeUndefined();
  });

  it("toggles the organization field from server-provided category metadata", () => {
    const form = buildForm();
    const container = form.querySelector<HTMLElement>("[data-organization-name-field]")!;
    applyCategoryUI(form, categories[1]);
    const orgField = form.querySelector<HTMLInputElement>("#organizationName");
    expect(orgField?.required).toBe(false);
    expect(orgField?.disabled).toBe(true);
    expect(orgField?.value).toBe("");
    expect(container.hidden).toBe(true);

    applyCategoryUI(form, categories[0]);
    expect(orgField?.required).toBe(true);
    expect(orgField?.disabled).toBe(false);
    expect(container.hidden).toBe(false);
  });

  it("filters and renders only the server-authorized category catalog", () => {
    expect(filterCategoriesForApplicantKind(categories, "organization").map(({ code }) => code)).toEqual(["A"]);
    expect(filterCategoriesForApplicantKind(categories, "individual").map(({ code }) => code)).toEqual(["H6"]);

    const container = document.createElement("div");
    renderMembershipCategories(container, filterCategoriesForApplicantKind(categories, "individual"));
    expect(container.querySelectorAll('input[name="membershipCategory"]')).toHaveLength(1);
    expect(container.textContent).toContain("Independent consultant");
    expect(container.textContent).not.toContain("Certification authority");
    expect(container.textContent).toContain("Required fee: $125.00");
    expect(membershipCategoryFeeText(categories[0])).toBeNull();
  });

  it("draws each category radio with all three check parts and a label that names it", () => {
    const container = document.createElement("div");
    renderMembershipCategories(container, categories);

    // All three parts, or the browser draws its own control instead: the block
    // on the label, the input class, and the label class.
    const checks = [...container.querySelectorAll("label.pk-check")];
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      const input = check.querySelector<HTMLInputElement>("input.pk-check__input");
      expect(input).not.toBeNull();
      expect(input?.type).toBe("radio");
      expect(check.querySelector(".pk-check__label")).not.toBeNull();
      // The label's `for` and the input's `id` are the pair that names the
      // control; without it a radio is announced with no name at all.
      expect((check as HTMLLabelElement).htmlFor).toBe(input?.id);
      expect(input?.id).not.toBe("");
    }
    expect(container.querySelector(".pk-check__hint")?.textContent).toBe("An organization category.");
  });

  it("takes the applicant to an unanswered category on submit and reports it in the category's own slot", () => {
    document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
    const form = document.querySelector<HTMLFormElement>("form[data-join-application-form]")!;
    renderMembershipCategories(form.querySelector<HTMLElement>("[data-membership-categories]")!, categories);
    form.querySelector<HTMLInputElement>('input[name="firstName"]')!.value = "Ada";
    form.querySelector<HTMLInputElement>('input[name="lastName"]')!.value = "Lovelace";

    expect(validateBeforeSubmit(form, document.createElement("p"))).toBe(false);

    const firstCategory = form.querySelector<HTMLInputElement>('input[type="radio"]')!;
    // The control name is the request contract's field, so a server refusal
    // and the browser's own check land in the same message slot.
    expect(firstCategory.name).toBe("membershipCategory");
    expect(document.activeElement).toBe(firstCategory);
    expect(form.querySelector('[data-field-error="membershipCategory"]')?.textContent).not.toBe("");
  });

  it("defaults participation to active and preserves an applicant's choice when questions are rendered again", () => {
    const form = buildForm();
    const container = document.createElement("div");
    form.append(container);
    const fields = [
      {
        ...formField("contribution_type", "select"),
        options: [
          { value: "active", label: "Active", active: true },
          { value: "observer", label: "Observer", active: true },
        ],
      },
    ];
    renderMembershipApplicationQuestions(container, fields);
    expect(buildApplicationPayload(form, "A", organizationContext).answers.contribution_type).toBe("active");

    const select = container.querySelector<HTMLSelectElement>("select")!;
    select.value = "observer";
    const answers = buildApplicationPayload(form, "A", organizationContext).answers;
    renderMembershipApplicationQuestions(container, fields, answers);
    expect(buildApplicationPayload(form, "A", organizationContext).answers.contribution_type).toBe("observer");
  });

  it("does not invent a participation answer when active is not offered", () => {
    const form = buildForm();
    const container = document.createElement("div");
    form.append(container);
    renderMembershipApplicationQuestions(container, [
      {
        ...formField("contribution_type", "select"),
        options: [{ value: "observer", label: "Observer", active: true }],
      },
    ]);
    expect(buildApplicationPayload(form, "A", organizationContext).answers.contribution_type).not.toBe("active");
  });

  it("binds configured agreement fields to canonical document controls without generic duplicates", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <div data-membership-legal-agreements hidden>
        <section data-membership-legal-field="agrees_bylaws">
          <input type="checkbox" name="custom.agrees_bylaws" data-membership-legal-input />
          <label data-membership-legal-label></label>
        </section>
        <section data-membership-legal-field="agrees_ipr_policy">
          <input type="checkbox" name="custom.agrees_ipr_policy" data-membership-legal-input />
          <label data-membership-legal-label></label>
        </section>
      </div>
    `;
    const genericFields = configureMembershipLegalFields(form, [
      formField("reason", "textarea"),
      formField("agrees_bylaws"),
    ]);

    expect(genericFields.map(({ key }) => key)).toEqual(["reason"]);
    expect(form.querySelector<HTMLElement>("[data-membership-legal-agreements]")?.hidden).toBe(false);
    const bylaws = form.querySelector<HTMLElement>('[data-membership-legal-field="agrees_bylaws"]')!;
    expect(bylaws.hidden).toBe(false);
    expect(bylaws.querySelector<HTMLInputElement>("input")?.required).toBe(true);
    expect(bylaws.querySelector("label")?.textContent).toBe("Configured agrees_bylaws");
    const missingIpr = form.querySelector<HTMLElement>('[data-membership-legal-field="agrees_ipr_policy"]')!;
    expect(missingIpr.hidden).toBe(true);
    expect(missingIpr.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
  });

  it("reports a policy's contract errors and acceptance in its visible header", () => {
    document.body.innerHTML = renderToString(
      <JoinFlow
        documents={[
          {
            key: "agrees_bylaws",
            title: "Bylaws",
            href: "/bylaws/",
            html: "<p>Read these terms.</p>",
          },
        ]}
      />,
    );
    const form = document.querySelector<HTMLFormElement>("form")!;
    const fields = [formField("agrees_bylaws")];
    configureMembershipLegalFields(form, fields);
    const status = document.querySelector<HTMLElement>("[data-flow-status]")!;
    installLiveValidation(form, status);
    const legal = installMembershipLegalValidation(form, fields);
    const card = form.querySelector<HTMLElement>(".membership-legal-card")!;
    const header = card.querySelector<HTMLElement>("[data-membership-legal-status]")!;
    const input = card.querySelector<HTMLInputElement>("input")!;
    expect(header.querySelector(".pk-field--invalid")).toBeNull();

    validateBeforeSubmit(form, status);
    expect(legal.validate()).toBe(false);
    expect(header.querySelector(".pk-field--invalid")).not.toBeNull();
    expect(header.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    input.click();
    expect(header.querySelector(".pk-field--ok")).not.toBeNull();
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(legal.validate()).toBe(true);

    legal.refuse(
      new ApiClientError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Review the terms",
            details: {
              fieldErrors: { "answers.agrees_bylaws": ["Review the updated terms"] },
            },
          },
        },
        400,
      ),
    );
    expect(header.querySelector(".pk-field--invalid")).not.toBeNull();
    expect(card.querySelector("[data-field-error]")?.textContent).toContain("Review the updated terms");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    input.click();
    expect(legal.validate()).toBe(false);
    expect(header.querySelector(".pk-field--invalid")).not.toBeNull();
    legal.dispose();
  });

  it("requires an organization's applicant to name their job title and asks an individual for none", () => {
    const fields = [{ ...formField("job_title"), required: false }, formField("professional_profile", "url")];
    expect(
      filterApplicationFieldsForApplicantKind(fields, "organization").find(({ key }) => key === "job_title"),
    ).toMatchObject({ required: true });
    expect(filterApplicationFieldsForApplicantKind(fields, "individual").map(({ key }) => key)).toEqual([
      "professional_profile",
    ]);
  });

  it("requires descriptions for each applicant kind even when configured as optional", () => {
    const fields = ["about_yourself", "about_organization"].map((key) => ({
      ...formField(key, "textarea"),
      required: false,
    }));
    expect(
      filterApplicationFieldsForApplicantKind(fields, "organization").map(({ key, required }) => ({ key, required })),
    ).toEqual([
      { key: "about_yourself", required: true },
      { key: "about_organization", required: true },
    ]);
    expect(
      filterApplicationFieldsForApplicantKind(fields, "individual").map(({ key, required }) => ({ key, required })),
    ).toEqual([{ key: "about_yourself", required: true }]);
  });

  it("validates description drafts through the same generated request contract as submission", () => {
    const fields = ["about_yourself", "about_organization"].map((key) => ({
      ...formField(key, "textarea"),
      required: false,
    }));
    const payload = {
      applicantEmail: "ada@example-corp.test",
      applicantName: "Ada Lovelace",
      membershipCategory: "A",
      organizationName: "Example Corp",
      joinToken: "a".repeat(32),
      answers: { about_yourself: "   ", about_organization: "\n" },
    };
    const organization = memberApplicationCreateSchemaForCategory(categories[0], fields).safeParse(payload);
    expect(organization.success).toBe(false);
    if (!organization.success)
      expect(organization.error.issues.map(({ path }) => path)).toEqual([
        ["answers", "about_yourself"],
        ["answers", "about_organization"],
      ]);
    const individual = memberApplicationCreateSchemaForCategory(categories[1], fields);
    expect(
      individual.safeParse({
        ...payload,
        membershipCategory: "H6",
        organizationName: undefined,
        answers: { about_yourself: "PKI research." },
      }).success,
    ).toBe(true);
    expect(
      individual.safeParse({
        ...payload,
        membershipCategory: "H6",
        organizationName: undefined,
        answers: { about_yourself: " " },
      }).success,
    ).toBe(false);
    expect(payload.answers).toEqual({ about_yourself: "   ", about_organization: "\n" });
  });

  it("removes organization-only questions and adapts authority wording for an individual", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <div data-membership-legal-agreements hidden>
        <section data-membership-legal-field="warranted_authority">
          <input type="checkbox" name="custom.warranted_authority" data-membership-legal-input />
          <label data-membership-legal-label></label>
        </section>
      </div>
    `;
    const fields = [
      formField("organization_website", "url"),
      formField("about_organization", "textarea"),
      formField("professional_profile", "url"),
      {
        ...formField("warranted_authority"),
        label: "I and my organization (if applicable) confirm that I have authority",
      },
    ];

    expect(filterApplicationFieldsForApplicantKind(fields, "individual").map(({ key }) => key)).toEqual([
      "professional_profile",
      "warranted_authority",
    ]);
    const genericFields = configureMembershipLegalFields(form, fields, "individual");
    expect(genericFields.map(({ key }) => key)).toEqual(["professional_profile"]);
    expect(form.querySelector("label")?.textContent).toBe(
      "I confirm that I am submitting this application for myself and agree to be bound by these terms",
    );
  });

  it("renders an informational summary of eligible individual categories", () => {
    const container = document.createElement("div");
    renderMembershipCategorySummary(container, filterCategoriesForApplicantKind(categories, "individual"));
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("H6 — Independent consultant");
    expect(container.textContent).not.toContain("Certification authority");
    // The list keeps its bullet without the browser's 40px indent, so the
    // summary lines up with the label above it.
    expect(container.querySelector("ul")?.className).toBe("pk-answer-list");
  });

  it("says so in words when no individual category is available", () => {
    const container = document.createElement("div");
    renderMembershipCategorySummary(container, []);
    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toBe("No eligible individual categories are currently available.");
  });
});
