/**
 * Handing a file to the control a reader would use.
 *
 * Every upload on this site is a visible button beside a hidden `<input
 * type="file">`, and the button is what opens the picker. A spec that reaches
 * past the button and calls `setInputFiles` on the input proves only that the
 * input has a listener — not that anything a reader can see reaches it.
 *
 * Issue #28 is what that costs: the headshot wiring swapped the input for a
 * clone and left the button pointing at an orphan, so no reader could upload
 * a photograph while both headshot specs kept passing. The logo tiles and the
 * speaker's presentation were being driven the same way, and would have hidden
 * the same break.
 *
 * `waitForEvent("filechooser")` closes the gap: the chooser opens only if the
 * click reached a real, attached file input, and the file goes to whichever
 * input opened it. `check-e2e-file-uploads.mjs` keeps it that way.
 */
import type { Locator, Page } from "@playwright/test";

export interface UploadedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Activates `control` and answers the file chooser it opens. */
export async function uploadThroughControl(page: Page, control: Locator, file: UploadedFile): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await control.click();
  await (await chooser).setFiles(file);
}

/** The same, for a control located by its accessible name. */
export async function uploadThroughButton(page: Page, buttonName: string, file: UploadedFile): Promise<void> {
  await uploadThroughControl(page, page.getByRole("button", { name: buttonName }), file);
}
