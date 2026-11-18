import { updateLiveTimerGraphics } from "../../../../../../../shared/live-timer-policy";
import { liveRoomOutputs, liveStudioOutputs, type LiveAuxOutput } from "../../../../../../../shared/live-room-outputs";
import { liveOutputComposition } from "../../../../../../../shared/schemas/live-session-stage";
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
import type {
  LiveChatFeedConfig,
  LiveTopQuestionsConfig,
} from "../../../../../../../shared/schemas/live-session-on-screen";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";
import type { LiveProgramLayer } from "../../../../../../../shared/live-overlay-stacking";
import { liveLayerUnseen } from "./live-layer-unseen";
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
  | { kind: "checkIn"; checkIn: LiveCheckInOnAir }
  | { kind: "topQuestions"; config: LiveTopQuestionsConfig }
  | { kind: "chatFeed"; config: LiveChatFeedConfig }
  | { kind: "reactions" };

/** Everything the output controls read and send, assembled once by the control room. */
export interface LiveTargets {
  /** The room as Preview, Program and the auxiliary outputs have it; Preview is shared by every operator. */
  state: LiveRoomState;
  /** Whether this session is the one its physical room has on air. */
  programActive: boolean;
  disabled: boolean;
  /** Sends a command to the room, which first makes this session the room's program when it changes what is on air. */
  sendProgram: Send;
  /** Sends several commands in order as one change; without it each goes out on its own. */
  sendPrograms?: (messages: readonly LiveRoomClientMessage[]) => boolean;
}

/** Sends commands in order as one change, so a broadcast in progress cannot refuse the later ones. */
export const sendLivePrograms = (targets: LiveTargets, messages: readonly LiveRoomClientMessage[]): boolean =>
  targets.sendPrograms
    ? targets.sendPrograms(messages)
    : messages.map((message) => targets.sendProgram(message)).every(Boolean);

const sameConfig = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Whether a composition shows this graphic. An output has one news ticker,
 * Up next, panel, top questions and chat, so it shows that graphic whatever
 * its settings there: a row never says off while its graphic is on screen,
 * whether a scene, another operator or this one put it on.
 */
export function liveLayerShown(stage: LiveStage, layer: LiveLayer): boolean {
  switch (layer.kind) {
    case "lowerThird":
      return stage.lowerThird?.key === layer.key;
    case "question":
      return stage.question?.id === layer.id;
    case "poll":
      return stage.poll?.id === layer.id;
    case "ticker":
      return stage.ticker !== null;
    case "schedule":
      return stage.schedule !== null;
    case "panelists":
      return stage.panelists !== null;
    case "timer":
      // An output shows each timer once; it shows this one whatever its settings there.
      return stage.timerGraphics.some((graphic) => graphic.timerId === layer.graphic.timerId);
    case "checkIn":
      return (
        sameConfig(stage.checkIn?.selection ?? null, layer.checkIn.selection) &&
        stage.checkIn?.theme === layer.checkIn.theme &&
        sameConfig(stage.checkIn?.text, layer.checkIn.text)
      );
    case "topQuestions":
      return stage.topQuestions !== null;
    case "chatFeed":
      return stage.chatFeed !== null;
    case "reactions":
      return stage.reactions;
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
    // The room fills a list from its own questions and chat, so the whole composition goes at once.
    case "topQuestions":
      return { ...takeLiveStage(stage), topQuestions: shown ? null : layer.config };
    case "chatFeed":
      return { ...takeLiveStage(stage), chatFeed: shown ? null : layer.config };
    case "reactions":
      return { ...takeLiveStage(stage), reactions: !shown };
  }
}

/** The complete composition an auxiliary output takes when one graphic is toggled on it. */
export function liveAuxToggle(
  state: LiveRoomState,
  output: LiveAuxOutput,
  layer: LiveLayer,
  shown?: boolean,
): LiveRoomClientMessage {
  const current = liveOutputComposition(state.outputs, output);
  const next = previewLiveStage(
    state,
    current,
    liveLayerToggle(current, layer, shown),
    layer.kind === "checkIn" ? layer.checkIn : null,
  );
  return { type: "aux.set", output, composition: liveCompositionInput(next) };
}

/** The change to the shared Preview that shows the graphic there, or takes it off: only its own layer. */
export function livePreviewToggle(
  state: LiveRoomState,
  layer: LiveLayer,
  shown = liveLayerShown(state.preview, layer),
): LiveRoomClientMessage {
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
      case "topQuestions":
        return { topQuestions: shown ? null : layer.config };
      case "chatFeed":
        return { chatFeed: shown ? null : layer.config };
      case "reactions":
        return { reactions: !shown };
    }
  })();
  return { type: "preview.set", composition };
}

/** The scene element a graphic draws as, which a scene places. */
export const liveLayerElement = (layer: LiveLayer): LiveProgramLayer =>
  layer.kind === "chatFeed" ? "chat" : layer.kind;

/** Where a graphic is now: Preview, Program and each auxiliary output. */
export function liveLayerTargets(targets: LiveTargets, layer: LiveLayer) {
  const { state, programActive } = targets;
  const preview = liveLayerShown(state.preview, layer);
  const program = programActive && liveLayerShown(state.stage, layer);
  const drawn = liveLayerElement(layer);
  return {
    preview,
    program,
    /** Why Preview holds it but would not show it: a board over it, or a scene without it. */
    previewUnseen: preview ? liveLayerUnseen(state, state.preview, drawn) : null,
    /** Why it is on air but nobody sees it, in Program's scene, the one a source draws unless it names another. */
    programUnseen: program ? liveLayerUnseen(state, state.stage, drawn) : null,
    aux: (output: LiveAuxOutput) =>
      programActive && liveLayerShown(liveOutputComposition(state.outputs, output), layer),
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

/** Every output the room holds a composition for, or lists: a graphic replaced anywhere is replaced on each. */
function heldOutputs(state: LiveRoomState): LiveAuxOutput[] {
  return [...new Set([...Object.keys(state.outputs), ...liveStudioOutputs(liveRoomOutputs(state.session))])];
}

/**
 * Saving a graphic's settings: the commands that put it, as it is now, on
 * every destination that shows it, so what is on screen changes with the
 * save. A destination that does not show it is left alone.
 */
export function liveLayerReplacements(targets: LiveTargets, layer: LiveLayer): LiveRoomClientMessage[] {
  const { state } = targets;
  const where = liveLayerTargets(targets, layer);
  return [
    ...(where.preview ? [livePreviewToggle(state, layer, false)] : []),
    ...(where.program ? [liveLayerToggle(state.stage, layer, false)] : []),
    ...heldOutputs(state)
      .filter((output) => where.aux(output))
      .map((output) => liveAuxToggle(state, output, layer, false)),
  ];
}
