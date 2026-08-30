// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ORGANIZATION_EMAIL_POLICY_MESSAGE,
  applyJoinApplicantKindUI,
  applyJoinEmailPolicy,
  buildApplicationPayload,
  applyCategoryUI,
  filterCategoriesForApplicantKind,
  renderMembershipCategorySummary,
  renderMembershipCategories,
} from "../../assets/ts/member-flows/join-form";
import type { MemberApplicationFormResponse } from "../../assets/shared/schemas/member-applications";

type Category = MemberApplicationFormResponse["categories"][number];

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

  it("renders an informational summary of eligible individual categories", () => {
    const container = document.createElement("div");
    renderMembershipCategorySummary(container, filterCategoriesForApplicantKind(categories, "individual"));
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("H6 — Independent consultant");
    expect(container.textContent).not.toContain("Certification authority");
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
    applyJoinApplicantKindUI(form, "organization");

    email.value = "person@gmail.com";
    expect(applyJoinEmailPolicy(form, "organization")).toBe(false);
    expect(email.validationMessage).toBe(ORGANIZATION_EMAIL_POLICY_MESSAGE);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.classList.contains("is-invalid")).toBe(true);
    expect(error.textContent).toBe(ORGANIZATION_EMAIL_POLICY_MESSAGE);

    email.value = "person@organization.example";
    expect(applyJoinEmailPolicy(form, "organization")).toBe(true);
    expect(email.validationMessage).toBe("");
    expect(email.hasAttribute("aria-invalid")).toBe(false);
    expect(email.classList.contains("is-invalid")).toBe(false);
    expect(error.textContent).toBe("");

    email.value = "person@gmail.com";
    expect(applyJoinEmailPolicy(form, "individual")).toBe(true);
  });
});
