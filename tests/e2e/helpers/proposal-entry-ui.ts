import { expect, type Page } from "@playwright/test";
import { eventFormsResponseSchema } from "../../../assets/shared/schemas/forms";
import { PROPOSAL_EVENT_SLUG } from "./proposals";

/** Field announces its canonical required suffix as part of the label. */
export function fieldLabel(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`^${escaped}\s*(?:\*\s*)?(?:\(required\))?$`);
}

export async function acceptVisibleTerms(page: Page, selector: string): Promise<void> {
  const terms = page.locator(selector).getByRole("checkbox");
  for (let index = 0; index < (await terms.count()); index += 1) await terms.nth(index).check();
}

export async function answerRequiredProposalFields(page: Page): Promise<void> {
  const response = await page.request.get(`/api/v1/events/${PROPOSAL_EVENT_SLUG}/forms/placements/proposal_submission`);
  expect(response.status(), await response.text()).toBe(200);
  const placement = eventFormsResponseSchema.parse(await response.json());
  for (const field of placement.form?.fields ?? []) {
    if (!field.required) continue;
    const control = page.getByLabel(fieldLabel(field.label));
    const option = field.options?.find((item) => item.active);
    if (field.fieldType === "select" && option) await control.selectOption(option.value);
    else if (field.fieldType === "multi_select" && option)
      await page.getByRole("checkbox", { name: option.label, exact: true }).check();
    else if (field.fieldType === "boolean") await control.check();
    else if (field.fieldType === "number") await control.fill("1");
    else if (field.fieldType === "date") await control.fill("2026-12-01");
    else if (field.fieldType === "email") await control.fill("fixture@example.test");
    else if (field.fieldType === "url") await control.fill("https://example.test/fixture");
    else await control.fill("Purpose-created browser fixture.");
  }
}
