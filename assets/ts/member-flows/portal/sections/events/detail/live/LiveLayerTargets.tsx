import { LiveScreenTags, liveScreens } from "./LiveRowMenu";
import { LiveTallyBands } from "./LiveTallyBands";
import { OutputTargetControl } from "./OutputTargetControl";
import { useLiveTogglePending } from "./live-toggle-pending";
import {
  liveLayerTargets,
  liveOutputsDisabled,
  sendLayerToggle,
  type LiveLayer,
  type LiveTargets,
} from "./live-output-targets";
import { livePresenceItem, useLivePresence } from "./presence/live-presence";
import { LivePresenceTag } from "./presence/LivePresenceTag";

/**
 * The output control for one graphic of this room: Preview and Program,
 * their tally edge on its row, the codes of the room's screens it was put
 * on, and which other operators are on it. The screens' switches are in the
 * row's menu (LiveRowMenu). An integrated control
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
  const screens = liveScreens(targets, layer);
  const toggle = useLiveTogglePending(where);
  const item = livePresenceItem(layer);
  const marks = useLivePresence().filter((mark) => mark.focus?.item === item);
  return (
    <>
      {integrated ? null : <LivePresenceTag marks={marks} />}
      <LiveScreenTags screens={screens} />
      {/* The row this control sits in carries the Program and Preview edge. */}
      <LiveTallyBands where={where} />
      <OutputTargetControl
        subject={subject}
        integrated={integrated}
        presenceItem={item}
        presence={marks.map((mark) => ({ target: mark.focus?.target ?? null, color: mark.color }))}
        preview={where.preview}
        program={where.program}
        previewUnseen={where.previewUnseen}
        programUnseen={where.programUnseen}
        disabled={liveOutputsDisabled(targets) || disabled}
        studioOnly={targets.canProduce === false}
        pending={toggle.pending}
        onToggle={(destination) => toggle.press(destination, () => sendLayerToggle(targets, layer, destination))}
      />
    </>
  );
}
