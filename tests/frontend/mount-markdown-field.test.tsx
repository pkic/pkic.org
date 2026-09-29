// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { proposalCreateSchema, speakerProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { mountMarkdownField } from "../../assets/ts/components/markdown-editor/mount-markdown-field";

let form: HTMLFormElement;
afterEach(() => {
  const host = form?.querySelector("div");
  if (host) void act(() => render(null, host));
  form?.remove();
});

it("keeps a public form's Markdown value, label, help, and submitted field across editing modes", async () => {
  form = document.createElement("form");
  form.innerHTML = `<div class="pk-field"><label for="bio">Biography</label><textarea id="bio" name="biography" aria-describedby="bio-help">**Initial** biography</textarea><p id="bio-help" class="pk-field__help">Describe your work.</p></div>`;
  document.body.append(form);
  await act(async () => {
    await mountMarkdownField(form.querySelector("textarea"), "Biography", speakerProfilePatchSchema.shape.biography);
  });
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
  await act(async () => {
    expect(controller?.validate()).toBe(false);
  });
  expect(form.querySelector('[role="textbox"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("80");
});
