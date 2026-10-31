// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { proposalCreateSchema } from "../../assets/shared/schemas/proposal-management";
import { identityProfileUpdateSchema } from "../../assets/shared/schemas/own-identity-profile";
import { mountMarkdownField } from "../../assets/ts/components/markdown-editor/mount-markdown-field";
import { installLiveValidation, validateBeforeSubmit } from "../../assets/ts/shared/form/validation";

let form: HTMLFormElement;
async function waitForCanvas() {
  await vi.waitFor(() => expect(form.querySelector('[role="textbox"]')).not.toBeNull());
}
afterEach(async () => {
  const host = form?.querySelector("div");
  if (host) await act(() => render(null, host));
  form?.remove();
});

it("keeps a public form's Markdown value, label, help, and submitted field across editing modes", async () => {
  form = document.createElement("form");
  form.innerHTML = `<div class="pk-field"><label for="bio">Biography</label><textarea id="bio" name="biography" aria-describedby="bio-help">**Initial** biography</textarea><p id="bio-help" class="pk-field__help">Describe your work.</p></div>`;
  document.body.append(form);
  await act(async () => {
    await mountMarkdownField(form.querySelector("textarea"), "Biography", identityProfileUpdateSchema.shape.biography);
  });
  await waitForCanvas();
  expect(form.querySelector('[role="textbox"]')?.getAttribute("aria-describedby")).toContain("bio-help");
  expect(new FormData(form).getAll("biography")).toEqual(["**Initial** biography"]);
  await act(async () => {
    form.querySelector<HTMLButtonElement>('[aria-label="Markdown source"]')!.click();
  });
  const source = form.querySelector("textarea")!;
  await act(async () => {
    source.value = "A **revised** biography about forms and organizations.";
    source.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(new FormData(form).getAll("biography")).toEqual([source.value]);
  await act(async () => {
    form.querySelector<HTMLButtonElement>('[aria-label="Visual editor"]')!.click();
  });
  expect(form.querySelector('[role="textbox"] strong')?.textContent).toBe("revised");
  expect(new FormData(form).getAll("biography")).toEqual([source.value]);
});

it("blocks an incomplete abstract through the request contract before advancing a public wizard", async () => {
  form = document.createElement("form");
  form.innerHTML = `<div class="pk-field"><label for="abstract">Abstract</label><textarea id="abstract" name="abstract" required>Too short</textarea></div>`;
  document.body.append(form);
  let controller: Awaited<ReturnType<typeof mountMarkdownField>>;
  await act(async () => {
    controller = await mountMarkdownField(
      form.querySelector("textarea"),
      "Abstract",
      proposalCreateSchema.shape.proposal.shape.abstract,
    );
  });
  await waitForCanvas();
  await act(async () => {
    expect(controller?.validate()).toBe(false);
  });
  expect(form.querySelector('[role="textbox"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("80");
});

it("keeps the contract's invalid state on a Markdown field while the page's DOM validator runs", async () => {
  form = document.createElement("form");
  form.innerHTML = `<div class="pk-field"><label for="abstract">Abstract</label><textarea id="abstract" name="abstract" required></textarea><p class="pk-field__message" data-field-error="proposal.abstract" hidden></p></div>`;
  document.body.append(form);
  let controller: Awaited<ReturnType<typeof mountMarkdownField>>;
  await act(async () => {
    controller = await mountMarkdownField(
      form.querySelector("textarea"),
      "Abstract",
      proposalCreateSchema.shape.proposal.shape.abstract,
    );
  });
  await waitForCanvas();
  installLiveValidation(form, document.createElement("p"));
  const canvas = form.querySelector<HTMLElement>('[role="textbox"]')!;
  const write = (text: string) =>
    act(async () => {
      // ProseMirror reads the edit back from the DOM, as it does a person's typing.
      canvas.querySelector("p")!.textContent = text;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  await write("Too short");
  await act(async () => {
    expect(controller?.validate()).toBe(false);
  });
  await write("Still too short to review");
  const field = form.querySelector(".pk-field")!;
  expect(field.classList.contains("pk-field--invalid")).toBe(true);
  expect(field.classList.contains("pk-field--ok")).toBe(false);
  expect(canvas.getAttribute("aria-invalid")).toBe("true");
  const message = form.querySelector<HTMLElement>('.pk-field__message[role="alert"]')!;
  expect(message.textContent).toBe("Write at least 80 characters, so reviewers can assess your session.");
  expect(canvas.getAttribute("aria-describedby")).toContain(message.id);
  // Submitting the page's other fields leaves the contract's verdict standing.
  expect(validateBeforeSubmit(form, document.createElement("p"))).toBe(true);
  expect(field.classList.contains("pk-field--invalid")).toBe(true);
});
