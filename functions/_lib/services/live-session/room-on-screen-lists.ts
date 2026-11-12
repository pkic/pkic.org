import { LIVE_AUX_OUTPUTS } from "../../../../assets/shared/live-room-outputs";
import { selectLiveTopQuestions } from "../../../../assets/shared/live-on-screen-lists";
import { LIVE_INTERACTION_BROADCAST_MILLISECONDS } from "../../../../assets/shared/live-session-policy";
import type {
  LiveChatFeedConfig,
  LiveChatFeedOnAir,
  LiveTopQuestionsConfig,
  LiveTopQuestionsOnAir,
} from "../../../../assets/shared/schemas/live-session-on-screen";
import type { LiveStage } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRoomChat } from "./room-chat";
import type { LiveRoomStore } from "./room-store";
import { liveChatOnAirMessages } from "./room-ticker";

/**
 * The audience lists an output shows: the open questions with the most
 * votes and the latest attendee chat. The room fills them from its own
 * storage, never from D1, under the same moderation as everything else on
 * air, and fills them again whenever a vote, a moderation decision or a chat
 * message changes what they hold.
 */
export class LiveRoomOnScreenLists {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly store: LiveRoomStore,
    private readonly chat: LiveRoomChat,
    private readonly broadcast: LiveRoomBroadcast,
  ) {}

  /** The open questions with the most votes; an anonymous author stays anonymous on air. */
  topQuestions(config: LiveTopQuestionsConfig): LiveTopQuestionsOnAir {
    const candidates = this.store.questions().map((row) => ({
      row,
      id: row.id,
      status: row.status,
      votes: row.votes,
      askedAt: row.asked_at,
      withdrawn: row.author_withdrawn === 1,
    }));
    return {
      config,
      questions: selectLiveTopQuestions(candidates, config.count).map(({ row }) => ({
        id: row.id,
        text: row.rewrite_text ?? row.body,
        authorName: row.anonymous === 1 ? null : row.author_name,
        votes: row.votes,
      })),
    };
  }

  /** The latest attendee messages a broadcast may show, newest last. */
  chatFeed(config: LiveChatFeedConfig): LiveChatFeedOnAir {
    return { config, messages: liveChatOnAirMessages(this.chat, config.count) };
  }

  /** Questions or chat changed: the lists fill again once the changes of the next moment are in. */
  due(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.ctx.waitUntil(this.refresh());
    }, LIVE_INTERACTION_BROADCAST_MILLISECONDS);
  }

  /** Fills every composition's lists again and tells viewers about those that changed. */
  async refresh(): Promise<void> {
    if (!this.store.session()) return;
    const program = this.refilled(this.store.stage());
    if (program) {
      this.store.saveStage(program);
      await this.broadcast.all({ type: "stage.changed", stage: this.store.stage() });
    }
    for (const output of LIVE_AUX_OUTPUTS) {
      const composition = this.refilled(this.store.aux(output));
      if (!composition) continue;
      this.store.saveAux(output, composition);
      await this.broadcast.all({ type: "aux.changed", output, composition: this.store.aux(output) });
    }
    const preview = this.refilled(this.store.preview());
    if (preview) {
      this.store.savePreview(preview);
      await this.broadcast.all({ type: "preview.changed", composition: this.store.preview() });
    }
  }

  /** The composition with its lists filled again, or null when they hold what they held. */
  private refilled(composition: LiveStage): LiveStage | null {
    if (!composition.topQuestions && !composition.chatFeed) return null;
    const topQuestions = composition.topQuestions && this.topQuestions(composition.topQuestions.config);
    const chatFeed = composition.chatFeed && this.chatFeed(composition.chatFeed.config);
    const same =
      JSON.stringify(topQuestions) === JSON.stringify(composition.topQuestions) &&
      JSON.stringify(chatFeed) === JSON.stringify(composition.chatFeed);
    return same ? null : { ...composition, topQuestions, chatFeed };
  }
}
