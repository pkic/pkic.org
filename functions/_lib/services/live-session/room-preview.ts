import type { LivePreviewPatch, LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { liveCompositionInput } from "../../../../assets/shared/live-room-preview";
import { composeLiveStage, type ResolvedComposition } from "./room-composition";
import type { LiveControlOutcome, LiveRoomControls } from "./room-controls";
import type { LivePollStore } from "./room-poll-store";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

/**
 * The operators' one shared Preview (PVW). It is stored, validated and
 * broadcast exactly like Program and the auxiliary outputs, but reaches
 * operators only: attendees, speakers and overlays never see it.
 */
export class LiveRoomPreview {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly polls: LivePollStore,
    private readonly controls: LiveRoomControls,
  ) {}

  /**
   * Applies one operator's change to Preview as a whole validated composition.
   * Layers the change left out keep their content and who last changed them.
   */
  set(
    operator: Operator,
    session: LiveRoomSession,
    patch: LivePreviewPatch,
    input: ResolvedComposition,
    at: string,
  ): LiveControlOutcome {
    const current = this.store.preview();
    const stage = composeLiveStage(this.store, this.polls, session, input, { operatorName: operator.name, at });
    if ("code" in stage) return stage;
    const composition = {
      ...stage,
      questionChange: "questionId" in patch ? stage.questionChange : current.questionChange,
      lowerThirdChange: "creditKey" in patch ? stage.lowerThirdChange : current.lowerThirdChange,
      pollChange: "pollId" in patch || "pollPresentation" in patch ? stage.pollChange : current.pollChange,
    };
    this.store.savePreview(composition);
    this.store.recordStaffAction(operator.userId, "live_session.preview.set", patch, at);
    return { messages: [{ type: "preview.changed", composition }] };
  }

  /**
   * Take: Program becomes what Preview shows, timer included, in one write.
   * Preview keeps its contents, as on a broadcast switcher.
   */
  take(operator: Operator, session: LiveRoomSession, resolved: ResolvedComposition, at: string): LiveControlOutcome {
    return this.controls.setStage(operator, session, resolved, at, true);
  }

  /** Preview's sources, for the room to resolve against the approved agenda before a Take. */
  sources() {
    return liveCompositionInput(this.store.preview());
  }
}
