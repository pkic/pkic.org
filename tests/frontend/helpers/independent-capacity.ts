import { act } from "preact/test-utils";
import { vi } from "vitest";
import { INDEPENDENT_CAPACITY_COPY } from "../../../assets/shared/email-first-copy";

/** Answers the independence disclosure the way a speaker taking part as an individual does. */
export async function completeIndependentCapacityDisclosure(root: ParentNode): Promise<void> {
  await vi.waitFor(() => {
    if (!root.querySelector('input[name="organizationConnection"][value="no"]'))
      throw new Error(`no "${INDEPENDENT_CAPACITY_COPY.question}" question`);
  });
  const choose = (name: string, value?: string) =>
    act(() => {
      const control = root.querySelector<HTMLInputElement>(
        value ? `input[name="${name}"][value="${value}"]` : `input[name="${name}"]`,
      )!;
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const write = (name: string, value: string) =>
    act(() => {
      const control = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await choose("organizationConnection", "no");
  await write("formerAffiliations", "None");
  await write("currentPosition", "Independent consultant");
  for (const name of ["noRelatedEngagement", "acceptsAccountability", "acknowledgesPolicies"]) await choose(name);
}
