import { Avatar } from "../../../../../../../ui/Avatar";
import { livePresenceLabel, useLivePresence, type LivePresenceMark } from "./live-presence";
import "./LivePresence.css";

/**
 * Other operators on a control: a chip each with their initials in their
 * color, and their first name while they change it. Each chip names its
 * operator for screen readers; it is not a live region, since presence moves
 * many times a second.
 */
export function LivePresenceTag({ marks }: { marks: readonly LivePresenceMark[] }) {
  if (!marks.length) return null;
  return (
    <span class="pk-live-presence">
      {marks.map((mark) => (
        <span
          key={mark.id}
          class="pk-live-presence__chip"
          data-presence-color={mark.color}
          data-flash={mark.changed ? "true" : undefined}
          title={livePresenceLabel(mark)}
        >
          <Avatar name={mark.name} class="pk-live-presence__avatar" />
          {mark.changed ? (
            <span class="pk-live-presence__name" aria-hidden="true">
              {mark.name.split(" ")[0]}
            </span>
          ) : null}
          <span class="pk-sr-only">{livePresenceLabel(mark)}</span>
        </span>
      ))}
    </span>
  );
}

/** Other operators on one item, such as a speaker or a question, whichever of its buttons they are on. */
export function LiveItemPresence({ item }: { item: string }) {
  return <LivePresenceTag marks={useLivePresence().filter((mark) => mark.focus?.item === item)} />;
}

/** Other operators anywhere in a panel, shown in its header. */
export function LivePanelPresence({ panel }: { panel: string }) {
  return <LivePresenceTag marks={useLivePresence().filter((mark) => mark.focus?.panel === panel)} />;
}
