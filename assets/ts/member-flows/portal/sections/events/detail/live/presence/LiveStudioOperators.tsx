import { livePresenceColor } from "../../../../../../../../shared/live-room-presence";
import { formatNumber } from "../../../../../../../../shared/format-number";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { Avatar } from "../../../../../../../ui/Avatar";
import { STUDIO_PANEL_LABELS, STUDIO_PANEL_TYPES, type StudioPanelType } from "../studio/studio-layout";
import { useLivePresence } from "./live-presence";
import "./LivePresence.css";
import "./LiveStudioOperators.css";

const panelLabel = (panel: string | undefined) =>
  panel && (STUDIO_PANEL_TYPES as readonly string[]).includes(panel)
    ? STUDIO_PANEL_LABELS[panel as StudioPanelType]
    : null;

/**
 * Who else operates this room right now, remote or onsite: an avatar each in
 * their presence color, with their name and the panel they are working in.
 */
export function LiveStudioOperators({ state }: { state: LiveRoomState }) {
  const marks = useLivePresence();
  const others = state.operators.filter((operator) => operator.name !== state.viewer.name);
  if (!others.length) return null;
  return (
    <ul class="pk-studio-operators" aria-label="Operating now">
      {others.map((operator) => {
        const panel = panelLabel(marks.find((mark) => mark.name === operator.name)?.focus?.panel);
        const description = [
          operator.name,
          operator.connections > 1 ? ` (${formatNumber(operator.connections)} control rooms)` : "",
          panel ? `, in ${panel}` : "",
        ].join("");
        return (
          <li
            key={operator.name}
            class="pk-studio-operators__person"
            data-presence-color={livePresenceColor(operator.name)}
            title={description}
          >
            <Avatar name={operator.name} />
            <span class="pk-sr-only">{description}</span>
          </li>
        );
      })}
    </ul>
  );
}
