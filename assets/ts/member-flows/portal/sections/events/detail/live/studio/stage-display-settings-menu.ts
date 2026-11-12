import { formatNumber } from "../../../../../../../../shared/format-number";
import type { LiveRoomClientMessage } from "../../../../../../../../shared/schemas/live-session-room";
import {
  LIVE_STAGE_NEAR_END_CHOICES,
  type LiveStageDisplaySettings,
} from "../../../../../../../../shared/schemas/live-stage-display-settings";
import type { MenuItem } from "../../../../../../../ui/Menu";

/**
 * The stage display's settings for this session, in the speaker message
 * panel's menu: switches that stay open while toggled, and the end cue's
 * timing as a choice. Each change applies at once.
 */
export function stageDisplaySettingsMenu(
  settings: LiveStageDisplaySettings,
  send: (message: LiveRoomClientMessage) => boolean,
  disabled: boolean,
): MenuItem[] {
  const change = (patch: Partial<LiveStageDisplaySettings>) =>
    send({ type: "stage.display.settings", settings: { ...settings, ...patch } });
  return [
    {
      id: "stage-reactions",
      label: "Reactions on the stage display",
      checked: settings.reactions,
      multiple: true,
      keepOpen: true,
      disabled,
      onSelect: () => change({ reactions: !settings.reactions }),
    },
    {
      id: "stage-end-cue",
      label: "End cue",
      disabled,
      children: LIVE_STAGE_NEAR_END_CHOICES.map((seconds) => ({
        id: `stage-end-cue-${seconds}`,
        label: seconds ? `${formatNumber(seconds / 60)} minutes before the end` : "Off",
        checked: settings.nearEndSeconds === seconds,
        disabled,
        onSelect: () => change({ nearEndSeconds: seconds }),
      })),
    },
    {
      id: "stage-questions",
      label: "End cue asks for questions",
      checked: settings.endsWithQuestions,
      multiple: true,
      keepOpen: true,
      disabled: disabled || settings.nearEndSeconds === 0,
      onSelect: () => change({ endsWithQuestions: !settings.endsWithQuestions }),
    },
  ];
}
