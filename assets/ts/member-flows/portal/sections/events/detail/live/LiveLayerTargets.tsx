import { LiveTallyBands } from "./LiveTallyBands";
import { OutputTargetControl } from "./OutputTargetControl";
import { liveLayerTargets, sendLayerToggle, type LiveLayer, type LiveTargets } from "./live-output-targets";
import { livePresenceItem, useLivePresence } from "./presence/live-presence";
import { LivePresenceTag } from "./presence/LivePresenceTag";

/**
 * The output control for one graphic of this room: Preview and Program,
 * their tally edge on its row, and which other operators are on it. The
 * room's screens are in the row's menu (LiveRowMenu). An integrated control
 * leaves the operators' chips to the card it sits on.
 */
export function LiveLayerTargets({
  targets,
  layer,
  subject,
  integrated = false,
  disabled = false,
}: {
  targets: LiveTargets;
  layer: LiveLayer;
  subject: string;
  integrated?: boolean;
  /** Held for a reason of this graphic's own, such as a ticker that does not validate yet. */
  disabled?: boolean;
}) {
  const where = liveLayerTargets(targets, layer);
  const item = livePresenceItem(layer);
  const marks = useLivePresence().filter((mark) => mark.focus?.item === item);
  return (
    <>
      {integrated ? null : <LivePresenceTag marks={marks} />}
      {/* The row this control sits in carries the Program and Preview edge. */}
      <LiveTallyBands where={where} />
      <OutputTargetControl
        subject={subject}
        integrated={integrated}
        presenceItem={item}
        presence={marks.map((mark) => ({ target: mark.focus?.target ?? null, color: mark.color }))}
        preview={where.preview}
        program={where.program}
        disabled={targets.disabled || disabled}
        onToggle={(destination) => sendLayerToggle(targets, layer, destination)}
      />
    </>
  );
}
