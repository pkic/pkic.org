import { withoutLiveTimerGraphic } from "../../../../assets/shared/live-timer-policy";
import {
  LIVE_AUX_OUTPUTS,
  type LiveAuxOutput,
  type LiveSpeakerMessageTone,
} from "../../../../assets/shared/live-room-outputs";
import type {
  LiveAuxComposition,
  LiveRoomServerMessage,
  LiveRoomSession,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LiveControlOutcome } from "./room-controls";
import { composeLiveStage, type ResolvedComposition } from "./room-composition";
import type { LivePollStore } from "./room-poll-store";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

/**
 * The room's auxiliary outputs (projector, stage preview, stage display) and the
 * message to the speaker. Questions and polls that change or leave the room
 * change on the operators' shared Preview too. Each output is one composition, last writer wins,
 * validated exactly like Program before its single write.
 */
export class LiveRoomOutputs {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly polls: LivePollStore,
  ) {}

  setAux(
    operator: Operator,
    session: LiveRoomSession,
    output: LiveAuxOutput,
    input: ResolvedComposition,
    at: string,
  ): LiveControlOutcome {
    const stage = composeLiveStage(this.store, this.polls, session, input, { operatorName: operator.name, at });
    if ("code" in stage) return stage;
    const previous = this.store.aux(output);
    const composition = stage;
    this.store.saveAux(output, composition);
    this.store.recordStaffAction(operator.userId, "live_session.aux.set", { output, ...input }, at);
    return {
      messages: [{ type: "aux.changed", output, composition }],
      polls: [previous.poll?.id, input.pollId].filter((id): id is string => Boolean(id)),
    };
  }

  setSpeakerMessage(
    operator: Operator,
    text: string | null,
    tone: LiveSpeakerMessageTone,
    flash: boolean,
    at: string,
  ): LiveControlOutcome {
    const speakerMessage = text === null ? null : { text, tone, flash, change: { operatorName: operator.name, at } };
    this.store.saveSpeakerMessage(speakerMessage);
    this.store.recordStaffAction(operator.userId, "live_session.speaker_message", { text, tone, flash }, at);
    return { messages: [{ type: "speaker.message.changed", speakerMessage }] };
  }

  /** A rewritten question already on an auxiliary output or Preview shows its new text there too. */
  refreshQuestion(questionId: string): LiveRoomServerMessage[] {
    const row = this.store.question(questionId);
    if (!row) return [];
    return this.each((composition) =>
      composition.question?.id === questionId
        ? { ...composition, question: { ...composition.question, text: row.rewrite_text ?? row.body } }
        : null,
    );
  }

  /** Takes a question, poll or timer that left the room off every auxiliary output and Preview. */
  withdraw(
    operator: Operator,
    view: "question" | "poll" | "timer",
    itemId: string,
    at: string,
  ): LiveRoomServerMessage[] {
    const change = { operatorName: operator.name, at };
    return this.each((composition) => {
      if (view === "question" && composition.question?.id === itemId)
        return { ...composition, question: null, questionChange: change };
      if (view === "poll" && composition.poll?.id === itemId) return { ...composition, poll: null, pollChange: change };
      if (view === "timer" && composition.timerGraphics.some((graphic) => graphic.timerId === itemId))
        return {
          ...composition,
          timerGraphics: withoutLiveTimerGraphic(composition.timerGraphics, itemId),
        };
      return null;
    });
  }

  /** Applies one change to every auxiliary output and to the shared Preview, which hold the same kind of composition. */
  private each(update: (composition: LiveAuxComposition) => LiveAuxComposition | null): LiveRoomServerMessage[] {
    const messages: LiveRoomServerMessage[] = [];
    for (const output of LIVE_AUX_OUTPUTS) {
      const next = update(this.store.aux(output));
      if (!next) continue;
      this.store.saveAux(output, next);
      messages.push({ type: "aux.changed", output, composition: next });
    }
    const preview = update(this.store.preview());
    if (preview) {
      this.store.savePreview(preview);
      messages.push({ type: "preview.changed", composition: preview });
    }
    return messages;
  }
}
