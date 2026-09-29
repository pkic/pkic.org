import { act } from "preact/test-utils";

/** Enter editing through the record's named actions menu. */
export async function beginRecordEdit(root: ParentNode, label: string, editLabel = "Edit settings"): Promise<void> {
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`No record actions named ${label}`);
  await act(async () => trigger.click());
  const edit = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === editLabel,
  );
  if (!edit) throw new Error(`No ${editLabel} action in ${label}`);
  await act(async () => edit.click());
}
