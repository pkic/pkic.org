import { liveWelcomedSpeakers } from "../../../../../../../shared/live-room-credits";
import { LiveGraphicRow } from "./LiveGraphicRow";
import type { LiveTargets } from "./live-output-targets";

/** The speaker welcome: a full-frame card greeting the session's speakers, read from their profiles and the agenda. */
export function LiveSpeakerWelcomeControls({ targets }: { targets: LiveTargets }) {
  const speakers = liveWelcomedSpeakers(targets.state.session.credits);
  const detail =
    speakers.length === 0
      ? "No speakers on this session"
      : speakers.length <= 2
        ? speakers.map((speaker) => speaker.name).join(" and ")
        : `${speakers.length} speakers`;
  return (
    <LiveGraphicRow
      name="Speaker welcome"
      detail={detail}
      outputs={{ targets, subject: "speaker welcome", layer: { kind: "speakerWelcome" } }}
    />
  );
}
