import { OutputTargetControl } from "./OutputTargetControl";
import { liveLayerTargets, sendLayerToggle, type LiveLayer, type LiveTargets } from "./live-output-targets";
import { livePresenceItem, useLivePresence } from "./presence/live-presence";
import { LivePresenceTag } from "./presence/LivePresenceTag";

/**
 * The output control for one graphic of this room: where it is now, a toggle
 * per destination, and which other operators are on it. An integrated control
 * leaves the operators' chips to the card it sits on.
 */
export function LiveLayerTargets({
  targets,
  layer,
  subject,
  integrated = false,
  short = false,
  disabled = false,
}: {
  targets: LiveTargets;
  layer: LiveLayer;
  subject: string;
  integrated?: boolean;
  /** PVW and PGM in place of the full names, for a dense row. */
  short?: boolean;
  /** Held for a reason of this graphic's own, such as a ticker that does not validate yet. */
  disabled?: boolean;
}) {
  const where = liveLayerTargets(targets, layer);
  const item = livePresenceItem(layer);
  const marks = useLivePresence().filter((mark) => mark.focus?.item === item);
  return (
    <>
      {integrated ? null : <LivePresenceTag marks={marks} />}
      <OutputTargetControl
        subject={subject}
        integrated={integrated}
        short={short}
        presenceItem={item}
        presence={marks.map((mark) => ({ target: mark.focus?.target ?? null, color: mark.color }))}
        preview={where.preview}
        program={where.program}
        aux={where.aux}
        disabled={targets.disabled || disabled}
        onToggle={(destination) => sendLayerToggle(targets, layer, destination)}
      />
    </>
  );
}
