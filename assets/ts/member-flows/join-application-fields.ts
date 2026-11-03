/** Category choices and questions for the server-authorized membership application path. */
import { renderCustomFields } from "../shared/widgets/custom-fields";
import { formatCurrencyAmount } from "../../shared/format-currency";
import { filterApplicationFieldsForApplicantKind } from "../../shared/schemas/membership-application-form";
import type { MemberApplicationFormResponse } from "../../shared/schemas/member-applications";
import type { MemberJoinApplicantKind as JoinApplicantKind } from "../../shared/schemas/member-join";
type MembershipCategory = MemberApplicationFormResponse["categories"][number];
type MembershipApplicationField = NonNullable<MemberApplicationFormResponse["form"]>["fields"][number];
import "../ui/Content.css";
import "../ui/Field.css";

/** The category catalog is server-provided; this only mirrors its selected presentation state. */
export function applyCategoryUI(form: HTMLFormElement, category: MembershipCategory | undefined): void {
  const orgField = form.querySelector<HTMLInputElement>("#organizationName");
  const orgFieldContainer = form.querySelector<HTMLElement>("[data-organization-name-field]");
  if (!orgField || !orgFieldContainer) return;
  const individual = category?.isIndividual ?? false;
  orgField.required = !individual;
  orgField.disabled = individual;
  orgFieldContainer.hidden = individual;
  if (individual) orgField.value = "";
}

export function filterCategoriesForApplicantKind(
  categories: MembershipCategory[],
  applicantKind: JoinApplicantKind,
): MembershipCategory[] {
  return categories.filter((category) => category.isIndividual === (applicantKind === "individual"));
}

export function membershipCategoryFeeText(category: MembershipCategory): string | null {
  if (!category.fee) return null;
  return `Required fee: ${formatCurrencyAmount(category.fee.amount, category.fee.currency)}. Payment is due within ${category.fee.deadlineDays} days after the payment step opens.`;
}

function membershipLegalLabel(key: string, configuredLabel: string, applicantKind: JoinApplicantKind): string {
  if (applicantKind !== "individual") return configuredLabel;
  if (key === "warranted_authority") {
    return "I confirm that I am submitting this application for myself and agree to be bound by these terms";
  }
  return configuredLabel.replace(/^I and my organization \(if applicable\)/, "I");
}
export function renderMembershipCategorySummary(container: HTMLElement, categories: MembershipCategory[]): void {
  if (categories.length === 0) {
    container.textContent = "No eligible individual categories are currently available.";
    return;
  }

  const list = document.createElement("ul");
  // The bullet without the browser's 40px indent, so the summary lines up
  // with the label above it instead of hanging off to the right.
  list.className = "pk-answer-list";
  for (const category of categories) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${category.code} — ${category.label}`;
    item.append(title);
    if (category.description) {
      // A block element rather than a span carrying a display utility: the
      // description is its own line, which is what a div already means.
      const description = document.createElement("div");
      description.className = "pk-small";
      description.textContent = category.description;
      item.append(description);
    }
    const fee = membershipCategoryFeeText(category);
    if (fee) {
      const feeSummary = document.createElement("div");
      feeSummary.className = "pk-small pk-strong";
      feeSummary.textContent = fee;
      item.append(feeSummary);
    }
    list.append(item);
  }
  container.replaceChildren(list);
}

/**
 * Binds D1 form-field policy to the server-rendered canonical legal documents
 * and removes those fields from the generic custom-question renderer.
 */
export function configureMembershipLegalFields(
  form: HTMLFormElement,
  fields: MembershipApplicationField[],
  applicantKind: JoinApplicantKind = "organization",
): MembershipApplicationField[] {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const configuredKeys = new Set<string>();
  const entries = form.querySelectorAll<HTMLElement>("[data-membership-legal-field]");

  for (const entry of Array.from(entries)) {
    const key = entry.dataset.membershipLegalField;
    const field = key ? fieldsByKey.get(key) : undefined;
    const input = entry.querySelector<HTMLInputElement>("[data-membership-legal-input]");
    const label = entry.querySelector<HTMLElement>("[data-membership-legal-label]");
    const configured = Boolean(key && field?.fieldType === "boolean" && input && label);
    entry.hidden = !configured;
    if (input) input.disabled = !configured;
    if (!configured || !key || !field || !input || !label) continue;

    input.required = field.required;
    label.textContent = membershipLegalLabel(key, field.label, applicantKind);
    configuredKeys.add(key);
  }

  const agreements = form.querySelector<HTMLElement>("[data-membership-legal-agreements]");
  if (agreements) agreements.hidden = configuredKeys.size === 0;

  return filterApplicationFieldsForApplicantKind(
    fields.filter((field) => !configuredKeys.has(field.key)),
    applicantKind,
  );
}

/** Start with active participation without replacing an applicant's saved choice. */
export function renderMembershipApplicationQuestions(
  container: HTMLElement,
  fields: MembershipApplicationField[],
  answers: Record<string, unknown> = {},
): void {
  const contribution = fields.find((field) => field.key === "contribution_type");
  const defaults =
    contribution?.fieldType === "select" &&
    contribution.options?.some((option) => option.value === "active" && option.active)
      ? { contribution_type: "active" }
      : {};
  renderCustomFields(container, fields).setValues({ ...defaults, ...answers });
}

export function renderMembershipCategories(container: HTMLElement, categories: MembershipCategory[]): void {
  // The gap between the options belongs to the list, not to each option: one
  // decision here instead of one `mb-2` per radio that can disagree.
  container.className = "pk-stack pk-stack--snug";
  container.replaceChildren(
    ...categories.map((category) => {
      // All three parts of the check, or the browser draws its own control:
      // the block on the label, the input class, and the label class.
      const wrapper = document.createElement("label");
      wrapper.className = "pk-check";
      const id = `membership-category-${category.code.toLowerCase()}`;
      const input = document.createElement("input");
      input.className = "pk-check__input";
      input.type = "radio";
      input.id = id;
      input.name = "membershipCategory";
      input.value = category.code;
      input.required = true;
      input.dataset.individual = String(category.isIndividual);
      const label = document.createElement("span");
      label.className = "pk-check__label";
      const title = document.createElement("strong");
      title.textContent = `${category.code} — ${category.label}`;
      label.append(title);
      if (category.description) {
        const description = document.createElement("span");
        description.className = "pk-check__hint";
        description.textContent = category.description;
        label.append(description);
      }
      const fee = membershipCategoryFeeText(category);
      if (fee) {
        const feeSummary = document.createElement("span");
        feeSummary.className = "pk-check__hint pk-strong";
        feeSummary.textContent = fee;
        label.append(feeSummary);
      }
      wrapper.htmlFor = id;
      wrapper.append(input, label);
      return wrapper;
    }),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
