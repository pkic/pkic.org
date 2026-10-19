import { updateLiveTimerGraphics } from "../../../../../../../shared/live-timer-policy";
import type { LiveAuxOutput } from "../../../../../../../shared/live-room-outputs";
import type { LivePollPresentation } from "../../../../../../../shared/schemas/live-session-poll";
import {
  type LivePanelists,
  type LivePreviewPatch,
  type LiveRoomClientMessage,
  type LiveCheckInOnAir,
  type LiveStage,
  type LiveTickerConfig,
  type LiveTimerGraphic,
} from "../../../../../../../shared/schemas/live-session-room";
import type { LiveScheduleConfig } from "../../../../../../../shared/schemas/live-session-schedule";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";
import { liveCompositionInput, previewLiveStage, takeLiveStage } from "./live-stage-preview";

type Send = (message: LiveRoomClientMessage) => boolean;

/** One graphic an operator can put on an output. */
export type LiveLayer =
  /** `motion`: how it goes on or off; the operators' choice on Preview, unless a caller names one. */
  | { kind: "lowerThird"; key: string; motion?: LiveStage["lowerThirdMotion"] }
  | { kind: "question"; id: string }
  | { kind: "poll"; id: string; presentation: LivePollPresentation }
  | { kind: "ticker"; config: LiveTickerConfig }
  | { kind: "schedule"; config: LiveScheduleConfig }
  | { kind: "panelists"; panelists: LivePanelists }
  | { kind: "timer"; graphic: LiveTimerGraphic }
  | { kind: "checkIn"; checkIn: LiveCheckInOnAir };

/** Everything the output controls read and send, assembled once by the control room. */
export interface LiveTargets {
  /** The room as Preview, Program and the auxiliary outputs have it; Preview is shared by every operator. */
  state: LiveRoomState;
  /** Whether this session is the one its physical room has on air. */
  programActive: boolean;
  disabled: boolean;
  /** Sends a command to the room, which first makes this session the room's program when it changes what is on air. */
  sendProgram: Send;
}

const sameConfig = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Whether a composition shows this graphic. */
export function liveLayerShown(stage: LiveStage, layer: LiveLayer): boolean {
  switch (layer.kind) {
    case "lowerThird":
      return stage.lowerThird?.key === layer.key;
    case "question":
      return stage.question?.id === layer.id;
    case "poll":
      return stage.poll?.id === layer.id;
    case "ticker":
      return (
        stage.ticker !== null &&
        sameConfig({ style: stage.ticker.style, messages: stage.ticker.messages }, layer.config)
      );
    case "schedule":
      return stage.schedule !== null && sameConfig(stage.schedule.config, layer.config);
    case "panelists":
      return stage.panelists?.layout === layer.panelists.layout;
    case "timer":
      return stage.timerGraphics.some((graphic) => sameConfig(graphic, layer.graphic));
    case "checkIn":
      return (
        sameConfig(stage.checkIn?.selection ?? null, layer.checkIn.selection) &&
        stage.checkIn?.theme === layer.checkIn.theme &&
        sameConfig(stage.checkIn?.text, layer.checkIn.text)
      );
  }
}

/** The command that shows the graphic on a composition, or takes it off when it is already there. */
export function liveLayerToggle(
  stage: LiveStage,
  layer: LiveLayer,
  shown = liveLayerShown(stage, layer),
): LiveRoomClientMessage {
  switch (layer.kind) {
    case "lowerThird":
      return {
        type: "stage.lowerThird",
        creditKey: shown ? null : layer.key,
        ...(layer.motion ? { motion: layer.motion } : {}),
      };
    case "question":
      return { type: "stage.question", questionId: shown ? null : layer.id };
    case "poll":
      // The chart the operator chose travels with the poll, so the whole composition goes at once.
      return { ...takeLiveStage(stage), pollId: shown ? null : layer.id, pollPresentation: layer.presentation };
    case "ticker":
      return { type: "stage.ticker", ticker: shown ? null : layer.config };
    case "schedule":
      return { type: "stage.schedule", schedule: shown ? null : layer.config };
    case "panelists":
      return { type: "stage.panelists", panelists: shown ? null : layer.panelists };
    case "timer":
      return { type: "stage.timer", timer: layer.graphic, visible: !shown };
    case "checkIn":
      // Like a poll, the code goes with the whole composition: the room resolves and signs it.
      return {
        ...takeLiveStage(stage),
        checkIn: shown ? null : layer.checkIn.selection,
        checkInTheme: layer.checkIn.theme,
        checkInText: layer.checkIn.text,
      };
  }
}

/** The complete composition an auxiliary output takes when one graphic is toggled on it. */
export function liveAuxToggle(state: LiveRoomState, output: LiveAuxOutput, layer: LiveLayer): LiveRoomClientMessage {
  const current = state.outputs[output];
  const next = previewLiveStage(
    state,
    current,
    liveLayerToggle(current, layer),
    layer.kind === "checkIn" ? layer.checkIn : null,
  );
  return { type: "aux.set", output, composition: liveCompositionInput(next) };
}

/** The change to the shared Preview that shows the graphic there, or takes it off: only its own layer. */
export function livePreviewToggle(state: LiveRoomState, layer: LiveLayer): LiveRoomClientMessage {
  const shown = liveLayerShown(state.preview, layer);
  const composition: LivePreviewPatch = (() => {
    switch (layer.kind) {
      case "lowerThird":
        return { creditKey: shown ? null : layer.key, ...(layer.motion ? { lowerThirdMotion: layer.motion } : {}) };
      case "question":
        return { questionId: shown ? null : layer.id };
      case "poll":
        return { pollId: shown ? null : layer.id, pollPresentation: layer.presentation };
      case "ticker":
        return { ticker: shown ? null : layer.config };
      case "schedule":
        return { schedule: shown ? null : layer.config };
      case "panelists":
        return { panelists: shown ? null : layer.panelists };
      case "timer":
        return { timerGraphics: updateLiveTimerGraphics(state.preview.timerGraphics, layer.graphic, !shown) };
      case "checkIn":
        // The selection travels; the room resolves and signs the code it shows.
        return {
          checkIn: shown ? null : layer.checkIn.selection,
          checkInTheme: layer.checkIn.theme,
          checkInText: layer.checkIn.text,
        };
    }
  })();
  return { type: "preview.set", composition };
}

/** Where a graphic is now: Preview, Program and each auxiliary output. */
export function liveLayerTargets(targets: LiveTargets, layer: LiveLayer) {
  const { state, programActive } = targets;
  return {
    preview: liveLayerShown(state.preview, layer),
    program: programActive && liveLayerShown(state.stage, layer),
    aux: (output: LiveAuxOutput) => programActive && liveLayerShown(state.outputs[output], layer),
  };
}

/** Sends the toggle for one destination of a graphic. */
export function sendLayerToggle(
  targets: LiveTargets,
  layer: LiveLayer,
  destination: "preview" | "program" | LiveAuxOutput,
) {
  const { state } = targets;
  // A lower third goes on and off every output the way the operators chose on Preview.
  if (layer.kind === "lowerThird" && !layer.motion) layer = { ...layer, motion: state.preview.lowerThirdMotion };
  if (destination === "preview") return targets.sendProgram(livePreviewToggle(state, layer));
  if (destination === "program")
    // Program shows another session while this one is not on air, so the first press always puts the graphic on.
    return targets.sendProgram(liveLayerToggle(state.stage, layer, targets.programActive ? undefined : false));
  return targets.sendProgram(liveAuxToggle(state, destination, layer));
}
