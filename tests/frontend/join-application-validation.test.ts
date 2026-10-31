import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installJoinApplicationValidation } from "../../assets/ts/member-flows/join-application-validation";

function form(): HTMLFormElement {
  document.body.innerHTML = `<form novalidate>
    <div class="pk-field"><input name="applicantName" required /><p data-field-error="applicantName" hidden></p></div>
    <div class="pk-field"><input name="organizationName" /><p data-field-error="organizationName" hidden></p></div>
  </form>`;
  return document.querySelector("form")!;
}

const contract = z.object({
  applicantName: z.string().trim().min(1, "Name is required"),
  organizationName: z.string().optional(),
});

describe("join application validation", () => {
  it("says what the contract says, never the browser's own message", () => {
    const element = form();
    const validation = installJoinApplicationValidation(
      element,
      () => contract,
      () => ({ applicantName: "" }),
    );
    expect(validation.validate()).toBe(false);
    const message = element.querySelector<HTMLElement>('[data-field-error="applicantName"]')!;
    expect(message.textContent).toBe("Name is required");
    expect(message.textContent).not.toContain("Please fill out");
    expect(document.activeElement).toBe(element.querySelector('input[name="applicantName"]'));
  });

  it("clears a message once the answer is corrected", () => {
    const element = form();
    let name = "";
    const validation = installJoinApplicationValidation(
      element,
      () => contract,
      () => ({ applicantName: name }),
    );
    validation.validate();
    name = "Ada Lovelace";
    element.querySelector("input")!.value = name;
    element.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(element.querySelector<HTMLElement>('[data-field-error="applicantName"]')!.hidden).toBe(true);
    expect(element.querySelector(".pk-field")!.classList.contains("pk-field--ok")).toBe(true);
  });
});
