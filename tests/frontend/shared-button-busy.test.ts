import { afterEach, describe, expect, it, vi } from "vitest";
import { clearButtonBusy, isButtonBusy, setButtonBusy } from "../../assets/ts/shared/form/button-busy";
import { withLoadingButton } from "../../assets/ts/shared/form/submit";

let form: HTMLFormElement | null = null;

afterEach(() => {
  form?.remove();
  form = null;
});

function submitForm(): { button: HTMLButtonElement; submits: () => number } {
  form = document.createElement("form");
  form.innerHTML = '<input name="email"><button type="submit" class="pk-btn pk-btn--primary">Send</button>';
  document.body.append(form);
  let count = 0;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    count += 1;
  });
  return { button: form.querySelector("button")!, submits: () => count };
}

describe("busy buttons on imperative pages", () => {
  it("writes the design system Button's loading markup and keeps the control focusable", () => {
    const { button } = submitForm();
    setButtonBusy(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    const spinner = button.firstElementChild;
    expect(spinner?.className).toBe("pk-btn__spinner");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    // The label is untouched, so the control keeps its accessible name.
    expect(button.textContent).toBe("Send");
  });

  it("blocks a second submission while busy and restores the control afterwards", () => {
    const { button, submits } = submitForm();
    setButtonBusy(button);
    setButtonBusy(button);
    expect(button.querySelectorAll(".pk-btn__spinner")).toHaveLength(1);

    button.click();
    expect(submits()).toBe(0);

    clearButtonBusy(button);
    expect(isButtonBusy(button)).toBe(false);
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.querySelector(".pk-btn__spinner")).toBeNull();
    button.click();
    expect(submits()).toBe(1);
  });

  it("clears the busy state even when the wrapped action fails", async () => {
    const { button } = submitForm();
    const action = vi.fn(() => {
      expect(isButtonBusy(button)).toBe(true);
      return Promise.reject(new Error("refused"));
    });

    await expect(withLoadingButton(button, action)).rejects.toThrow("refused");
    expect(action).toHaveBeenCalledOnce();
    expect(isButtonBusy(button)).toBe(false);
  });
});
