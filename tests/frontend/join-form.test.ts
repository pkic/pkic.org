// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  isIndividualCategory,
  readLegalAndInterestAnswers,
  buildApplicationPayload,
  applyCategoryUI,
} from "../../assets/ts/member-flows/join-form";
import { requiresUniversityEmail } from "../../assets/shared/schemas/membership-categories";
import { isPersonalEmailAddress } from "../../assets/shared/constants/email-domains";

function buildForm(overrides: Partial<Record<string, string>> = {}): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="firstName" value="${overrides.firstName ?? "Ada"}" />
    <input name="lastName" value="${overrides.lastName ?? "Lovelace"}" />
    <input name="email" value="${overrides.email ?? "ada@example-corp.test"}" />
    <input id="organizationName" name="organizationName" value="${overrides.organizationName ?? "Example Corp"}" />
    <input id="warrantAuthority" type="checkbox" checked />
    <input type="checkbox" data-legal-agreement="Bylaws" checked />
    <input type="checkbox" data-legal-agreement="Code of Conduct" checked />
    <input type="radio" name="contribution" value="active" checked />
    <input id="contribute" type="checkbox" checked />
    <input id="sponsoring" type="checkbox" />
    <input name="custom.reason" value="Because PKI." />
  `;
  document.body.append(form);
  return form;
}

describe("join-form helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("classifies individual categories", () => {
    expect(isIndividualCategory("H5")).toBe(true);
    expect(isIndividualCategory("H6")).toBe(true);
    expect(isIndividualCategory("H7")).toBe(true);
    expect(isIndividualCategory("A")).toBe(false);
    expect(isIndividualCategory("H8")).toBe(false);
  });

  it("requires a university email only for H5", () => {
    expect(requiresUniversityEmail("H5")).toBe(true);
    expect(requiresUniversityEmail("H6")).toBe(false);
  });

  it("flags common personal email providers", () => {
    expect(isPersonalEmailAddress("someone@gmail.com")).toBe(true);
    expect(isPersonalEmailAddress("someone@outlook.com")).toBe(true);
    expect(isPersonalEmailAddress("someone@example-corp.test")).toBe(false);
    expect(isPersonalEmailAddress("not-an-email")).toBe(false);
  });

  it("reads legal agreements and interest checkboxes", () => {
    const form = buildForm();
    const answers = readLegalAndInterestAnswers(form);
    expect(answers.legalAgreements).toEqual(["Bylaws", "Code of Conduct"]);
    expect(answers.warrantedAuthority).toBe(true);
    expect(answers.contributionType).toBe("active");
    expect(answers.wantsToPresent).toBe(true);
    expect(answers.interestedInSponsoring).toBe(false);
  });

  it("builds the application payload for an organization category", () => {
    const form = buildForm();
    const payload = buildApplicationPayload(form, "A");
    expect(payload.applicantName).toBe("Ada Lovelace");
    expect(payload.applicantEmail).toBe("ada@example-corp.test");
    expect(payload.membershipCategory).toBe("A");
    expect(payload.organizationName).toBe("Example Corp");
    expect(payload.answers.reason).toBe("Because PKI.");
    expect(payload.answers.warrantedAuthority).toBe(true);
  });

  it("omits organizationName for individual categories", () => {
    const form = buildForm({ organizationName: "" });
    const payload = buildApplicationPayload(form, "H5");
    expect(payload.organizationName).toBeUndefined();
  });

  it("toggles the organization field for individual categories", () => {
    const form = buildForm();
    applyCategoryUI(form, "H6");
    const orgField = form.querySelector<HTMLInputElement>("#organizationName");
    expect(orgField?.required).toBe(false);
    expect(orgField?.disabled).toBe(true);
    expect(orgField?.value).toBe("");

    applyCategoryUI(form, "A");
    expect(orgField?.required).toBe(true);
    expect(orgField?.disabled).toBe(false);
  });
});
