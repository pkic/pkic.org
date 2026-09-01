// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ORGANIZATION_EMAIL_POLICY_MESSAGE,
  applyJoinApplicantKindUI,
  applyJoinEmailPolicy,
  buildApplicationPayload,
  applyCategoryUI,
  configureMembershipLegalFields,
  filterCategoriesForApplicantKind,
  renderMembershipCategorySummary,
  renderMembershipCategories,
} from "../../assets/ts/member-flows/join-form";
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
    isVoting: true,
    revision: 0,
    updatedAt: "2026-08-27T00:00:00.000Z",
  },
  {
    code: "H6",
    label: "Independent consultant",
    description: "An individual category.",
    displayOrder: 60,
    isIndividual: true,
    isVoting: false,
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

function buildJoinStartForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <div data-join-path-details hidden>
      <div data-join-organization-policy hidden></div>
      <div data-join-individual-policy hidden></div>
      <div data-join-individual-categories hidden></div>
      <label data-join-email-label for="joinEmail"></label>
      <input id="joinEmail" name="email" type="email" disabled />
      <div data-field-error="email"></div>
      <div data-join-email-help></div>
    </div>
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
    expect(container.querySelectorAll('input[name="category"]')).toHaveLength(1);
    expect(container.textContent).toContain("Independent consultant");
    expect(container.textContent).not.toContain("Certification authority");
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

  it("renders mutually exclusive organization and individual start states", () => {
    const form = buildJoinStartForm();
    const details = form.querySelector<HTMLElement>("[data-join-path-details]")!;
    const organizationPolicy = form.querySelector<HTMLElement>("[data-join-organization-policy]")!;
    const individualPolicy = form.querySelector<HTMLElement>("[data-join-individual-policy]")!;
    const individualCategories = form.querySelector<HTMLElement>("[data-join-individual-categories]")!;
    const email = form.querySelector<HTMLInputElement>("#joinEmail")!;
    const label = form.querySelector<HTMLElement>("[data-join-email-label]")!;

    applyJoinApplicantKindUI(form, null);
    expect(details.hidden).toBe(true);
    expect(email.disabled).toBe(true);

    applyJoinApplicantKindUI(form, "organization");
    expect(details.hidden).toBe(false);
    expect(organizationPolicy.hidden).toBe(false);
    expect(individualPolicy.hidden).toBe(true);
    expect(individualCategories.hidden).toBe(true);
    expect(email.disabled).toBe(false);
    expect(label.textContent).toBe("Your official work or organization email address");
    expect(email.placeholder).toBe("you@organization.example");

    applyJoinApplicantKindUI(form, "individual");
    expect(organizationPolicy.hidden).toBe(true);
    expect(individualPolicy.hidden).toBe(false);
    expect(individualCategories.hidden).toBe(false);
    expect(label.textContent).toBe("Your personal or university email address");
    expect(email.placeholder).toBe("you@example.com");
  });

  it("links a personal organization email error to the email field and clears it when corrected", () => {
    const form = buildJoinStartForm();
    const email = form.querySelector<HTMLInputElement>("#joinEmail")!;
    const error = form.querySelector<HTMLElement>('[data-field-error="email"]')!;
    const details = form.querySelector<HTMLElement>("[data-join-path-details]")!;
    applyJoinApplicantKindUI(form, "organization");

    email.value = "person@gmail.com";
    expect(applyJoinEmailPolicy(form, "organization")).toBe(false);
    expect(email.validationMessage).toBe(ORGANIZATION_EMAIL_POLICY_MESSAGE);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    // The invalid state is drawn from a modifier on the field group, which is
    // where the design system reads its state tokens from. A class on the
    // input alone styles nothing.
    expect(details.classList.contains("pk-field--invalid")).toBe(true);
    expect(error.textContent).toBe(ORGANIZATION_EMAIL_POLICY_MESSAGE);

    email.value = "person@organization.example";
    expect(applyJoinEmailPolicy(form, "organization")).toBe(true);
    expect(email.validationMessage).toBe("");
    expect(email.hasAttribute("aria-invalid")).toBe(false);
    expect(details.classList.contains("pk-field--invalid")).toBe(false);
    expect(error.textContent).toBe("");

    email.value = "person@gmail.com";
    expect(applyJoinEmailPolicy(form, "individual")).toBe(true);
  });
});
