// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyJoinApplicantKindUI,
  buildApplicationPayload,
  applyCategoryUI,
  filterCategoriesForApplicantKind,
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
      <label data-join-email-label for="joinEmail"></label>
      <input id="joinEmail" name="email" disabled />
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

  it("renders mutually exclusive organization and individual start states", () => {
    const form = buildJoinStartForm();
    const details = form.querySelector<HTMLElement>("[data-join-path-details]")!;
    const organizationPolicy = form.querySelector<HTMLElement>("[data-join-organization-policy]")!;
    const individualPolicy = form.querySelector<HTMLElement>("[data-join-individual-policy]")!;
    const email = form.querySelector<HTMLInputElement>("#joinEmail")!;
    const label = form.querySelector<HTMLElement>("[data-join-email-label]")!;

    applyJoinApplicantKindUI(form, null);
    expect(details.hidden).toBe(true);
    expect(email.disabled).toBe(true);

    applyJoinApplicantKindUI(form, "organization");
    expect(details.hidden).toBe(false);
    expect(organizationPolicy.hidden).toBe(false);
    expect(individualPolicy.hidden).toBe(true);
    expect(email.disabled).toBe(false);
    expect(label.textContent).toBe("Work or organization email address");

    applyJoinApplicantKindUI(form, "individual");
    expect(organizationPolicy.hidden).toBe(true);
    expect(individualPolicy.hidden).toBe(false);
    expect(label.textContent).toBe("Personal email address");
  });
});
