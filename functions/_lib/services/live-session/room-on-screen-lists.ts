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
import type { LiveOnAirChat } from "./location-chat-on-air";
import type { LiveRoomStore } from "./room-store";

/**
 * The audience lists an output shows: the open questions with the most
 * votes and the latest attendee chat. The room fills questions from its own
 * storage and chat from its location's chat, never from D1, under the same
 * moderation as everything else on air, and fills them again whenever a vote,
 * a moderation decision or a chat message changes what they hold.
 */
export class LiveRoomOnScreenLists {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The refill due when the next waiting chat message may show. */
  private wake: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly store: LiveRoomStore,
    private readonly chat: LiveOnAirChat,
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

  /**
   * The latest attendee messages a broadcast may show, newest last, each only
   * once its wait is over. The room's moderation is read now, so a message
   * hidden, held, reported or deleted during its wait never shows.
   */
  async chatFeed(config: LiveChatFeedConfig, now = Date.now()): Promise<LiveChatFeedOnAir> {
    const sentBy = config.delaySeconds ? new Date(now - config.delaySeconds * 1000).toISOString() : null;
    return { config, messages: await this.chat.messages(config.count, { sentBy }) };
  }

  /** The room's storage is being erased: no refill may run afterwards and recreate it. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.wake) clearTimeout(this.wake.timer);
    this.timer = null;
    this.wake = null;
  }

  /** Questions or chat changed: the lists fill again once the changes of the next moment are in. */
  due(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.ctx.waitUntil(this.refresh());
    }, LIVE_INTERACTION_BROADCAST_MILLISECONDS);
  }

  /** Fills every composition's lists again and tells viewers about those that changed. */
  async refresh(now = Date.now()): Promise<void> {
    if (!this.store.session()) return;
    const program = await this.refilled(() => this.store.stage(), now);
    if (program) {
      this.store.saveStage(program);
      await this.broadcast.all({ type: "stage.changed", stage: this.store.stage() });
    }
    for (const output of this.store.auxOutputs()) {
      const composition = await this.refilled(() => this.store.aux(output), now);
      if (!composition) continue;
      this.store.saveAux(output, composition);
      await this.broadcast.all({ type: "aux.changed", output, composition: this.store.aux(output) });
    }
    const preview = await this.refilled(() => this.store.preview(), now);
    if (preview) {
      this.store.savePreview(preview);
      await this.broadcast.all({ type: "preview.changed", composition: this.store.preview() });
    }
    await this.wakeForWaitingChat(now);
  }

  /**
   * Refills once the oldest message still waiting may show. The room's alarm
   * refills the lists on its own cadence too, so a room that sleeps in
   * between catches up there.
   */
  private async wakeForWaitingChat(now: number): Promise<void> {
    const outputs = this.store.outputs();
    const delays = [this.store.stage(), this.store.preview(), ...Object.values(outputs)].flatMap((composition) =>
      composition.chatFeed?.config.delaySeconds ? [composition.chatFeed.config.delaySeconds] : [],
    );
    const waits: number[] = [];
    for (const delay of new Set(delays)) {
      const sent = await this.chat.firstSentAfter(new Date(now - delay * 1000).toISOString());
      if (sent) waits.push(Date.parse(sent) + delay * 1000);
    }
    if (!waits.length) return;
    const at = Math.min(...waits) + 1;
    if (this.wake && this.wake.at <= at && this.wake.at > now) return;
    if (this.wake) clearTimeout(this.wake.timer);
    this.wake = {
      at,
      timer: setTimeout(() => {
        this.wake = null;
        this.ctx.waitUntil(this.refresh());
      }, at - now),
    };
  }

  /**
   * The composition with its lists filled again, or null when they hold what they held. The chat is read from
   * the location's chat, so an operator may change the composition meanwhile: the lists go into the
   * composition as it is after the read, and a chat list set up anew in between waits for its own refill.
   */
  private async refilled(read: () => LiveStage, now: number): Promise<LiveStage | null> {
    const asked = read().chatFeed;
    const fed = asked && (await this.chatFeed(asked.config, now));
    const composition = read();
    if (!composition.topQuestions && !composition.chatFeed) return null;
    const topQuestions = composition.topQuestions && this.topQuestions(composition.topQuestions.config);
    const chatFeed =
      composition.chatFeed && JSON.stringify(composition.chatFeed.config) === JSON.stringify(asked?.config)
        ? fed
        : composition.chatFeed;
    const same =
      JSON.stringify(topQuestions) === JSON.stringify(composition.topQuestions) &&
      JSON.stringify(chatFeed) === JSON.stringify(composition.chatFeed);
    return same ? null : { ...composition, topQuestions, chatFeed };
  }
}
