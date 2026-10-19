// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installStepNavigation } from "../../assets/ts/shared/form/step-navigation";

afterEach(() => {
  document.body.innerHTML = "";
});
it("activates identity work only after required terms allow the next step", () => {
  document.body.innerHTML =
    '<section><form><div data-step="1"><input type="checkbox" name="consents" required></div><div data-step="2" hidden></div><button data-step-next type="button">Next</button><button data-step-back type="button">Back</button><button type="submit">Submit</button><p role="status"></p></form></section>';
  const root = document.querySelector("section")!;
  root.scrollIntoView = vi.fn();
  const activated = vi.fn();
  installStepNavigation(root, root.querySelector("form")!, root.querySelector("p")!, undefined, activated);
  expect(activated.mock.calls).toEqual([[1]]);
  root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
  expect(activated.mock.calls).toEqual([[1]]);
  root.querySelector<HTMLInputElement>("input")!.checked = true;
  root.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
  expect(activated.mock.calls).toEqual([[1], [2]]);
  expect(root.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>("[data-step-back]")!.click();
  expect(activated.mock.calls).toEqual([[1], [2], [1]]);
});
