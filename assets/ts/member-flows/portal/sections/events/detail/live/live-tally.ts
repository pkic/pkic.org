import { liveOutputTone } from "../../../../../../../shared/live-room-outputs";
import type { LiveRoomOutput } from "../../../../../../../shared/schemas/live-room-output-setup";

/**
 * The attributes that color an element in an output's tally color: the
 * output by its key, and for one the room lists, the tone of its place in
 * the list, so a room's own screens each read by color alone.
 */
export function liveTallyAttributes(outputs: readonly LiveRoomOutput[], output: string | undefined) {
  if (output === undefined) return {};
  const tone = liveOutputTone(outputs, output);
  return { "data-tally": output, "data-tally-tone": tone === null ? undefined : String(tone) };
}
