/**
 * A draft that starts from the record each time the editor is opened.
 *
 * An editor that seeds its draft from the record on every render of that
 * record throws away what somebody is typing the moment anything reloads it —
 * a background refresh, a sibling save, a poll. An editor that seeds it only
 * once, at mount, does the opposite: reopened later it shows a draft from
 * before the record changed.
 *
 * Both are the same mistake about when a draft begins. It begins when the
 * reader takes the edit command, so that is the only moment this reseeds:
 * the transition from closed to open. While the editor is open the draft is
 * the person's, and nothing else writes to it.
 */
import { useState } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";

export function useEditorDraft<T>(editing: boolean, seed: () => T): [T, Dispatch<StateUpdater<T>>] {
  const [draft, setDraft] = useState<T>(seed);
  /*
   * Adjusted while rendering rather than from an effect, so the fields never
   * paint once with the previous draft before correcting themselves. The
   * previous value is state, not a ref, because a render that is thrown away
   * must not leave the hook believing the editor already opened.
   */
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setDraft(seed());
  }
  return [draft, setDraft];
}
