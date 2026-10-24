import { vi } from "vitest";
import { act } from "preact/test-utils";

/** Enter editing through the record's named actions menu. */
export async function beginRecordEdit(root: ParentNode, label: string, editLabel = "Edit settings"): Promise<void> {
  const trigger = await vi.waitFor(() => {
    const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`No record actions named ${label}`);
    return button;
  });
  await act(async () => trigger.click());
  const edit = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === editLabel,
  );
  if (!edit) throw new Error(`No ${editLabel} action in ${label}`);
  await act(async () => edit.click());
}
