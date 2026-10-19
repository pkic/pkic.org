import { LIVE_AUX_OUTPUTS } from "../../../../assets/shared/live-room-outputs";
import type {
  LiveCredit,
  LiveRoomServerMessage,
  LiveRoomSession,
} from "../../../../assets/shared/schemas/live-session-room";
import { findLiveRoomCredit } from "./room-composition";
import type { LiveRoomStore } from "./room-store";

const same = (left: LiveCredit, right: LiveCredit) => JSON.stringify(left) === JSON.stringify(right);

/**
 * A lower third on an output keeps a copy of its person, so the output can
 * draw it alone. The person's identity is the one source of their title and
 * organization: whenever the room reads its session again, every copy on
 * Program, Preview and the room's outputs is brought in line with the
 * credit as it is now, and the change reaches whoever shows it.
 */
export function refreshLiveCreditCopies(store: LiveRoomStore, session: LiveRoomSession): LiveRoomServerMessage[] {
  const current = (credit: LiveCredit | null) => {
    if (!credit) return null;
    const now = findLiveRoomCredit(store, session, credit.key);
    return now && !same(now, credit) ? now : null;
  };
  const messages: LiveRoomServerMessage[] = [];
  const stage = store.stage();
  const onStage = current(stage.lowerThird);
  if (onStage) {
    const next = { ...stage, lowerThird: onStage };
    store.saveStage(next);
    messages.push({ type: "stage.changed", stage: next });
  }
  const preview = store.preview();
  const inPreview = current(preview.lowerThird);
  if (inPreview) {
    const next = { ...preview, lowerThird: inPreview };
    store.savePreview(next);
    messages.push({ type: "preview.changed", composition: next });
  }
  for (const output of LIVE_AUX_OUTPUTS) {
    const composition = store.aux(output);
    const onOutput = current(composition.lowerThird);
    if (!onOutput) continue;
    const next = { ...composition, lowerThird: onOutput };
    store.saveAux(output, next);
    messages.push({ type: "aux.changed", output, composition: next });
  }
  return messages;
}
