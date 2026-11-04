import { act } from "preact/test-utils";
import { expect } from "vitest";

/** Open nested menu choices by their visible labels, returning the final choice without activating it. */
export async function menuPath(root: ParentNode, trigger: string, path: readonly string[]): Promise<HTMLElement> {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${trigger}"]`);
  expect(button, trigger).not.toBeNull();
  if (button!.getAttribute("aria-expanded") === "true") await act(() => button!.click());
  await act(() => button!.click());
  let item: HTMLElement | undefined;
  for (let index = 0; index < path.length; index++) {
    item = [
      ...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'),
    ]
      .reverse()
      .find((entry) => entry.textContent?.replace(/\s*›$/, "").trim() === path[index]);
    expect(item, path[index]).toBeDefined();
    if (index < path.length - 1) await act(() => item!.click());
  }
  return item!;
}
