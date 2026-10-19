import {
  LIVE_POLL_POLICY,
  LIVE_ROOM_POLICY,
  takeLiveAllowance,
  type LiveReactionId,
} from "../../../../assets/shared/live-session-policy";
import { nowIso } from "../../utils/time";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRefusal } from "./room-controls";
import type { LiveRoomPolls } from "./room-polls";
import type { LiveRoomStore } from "./room-store";

type Handled = LiveRefusal | void;
const TOO_FAST = { code: "LIVE_ROOM_RATE_LIMITED", message: "Please wait a moment before trying again." };

/** Per-room reaction limits and batched reaction/poll broadcasts. */
export class LiveRoomEngagement {
  /** Per-person sliding windows; a room woken from hibernation starts them afresh. */
  private readonly allowances = new Map<string, number[]>();
  private burst: Partial<Record<LiveReactionId, number>> = {};
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly talliesDue = new Set<string>();
  private tallyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly store: LiveRoomStore,
    private readonly polls: LiveRoomPolls,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly changed: () => Promise<void>,
  ) {}

  clear(): void {
    this.allowances.clear();
    this.talliesDue.clear();
  }

  private allowedReaction(userId: string): boolean {
    const history = this.allowances.get(userId) ?? [];
    this.allowances.set(userId, history);
    return takeLiveAllowance(history, Date.now(), LIVE_ROOM_POLICY.reactionsPerPerson);
  }

  /** The voter sees their ballot at once; everyone's tallies follow on the room's tally cadence. */
  async votePoll(userId: string, pollId: string, answer: unknown, socket: WebSocket): Promise<Handled> {
    const refusal = this.polls.vote(userId, pollId, answer);
    if (refusal) return refusal;
    await this.broadcast.poll(pollId, socket);
    this.talliesDue.add(pollId);
    this.tallyTimer ??= setTimeout(
      () => this.ctx.waitUntil(this.flushTallies()),
      LIVE_POLL_POLICY.tallyBroadcastMilliseconds,
    );
    await this.changed();
  }

  private async flushTallies(): Promise<void> {
    const due = [...this.talliesDue];
    this.talliesDue.clear();
    this.tallyTimer = null;
    for (const pollId of due) await this.broadcast.poll(pollId);
  }

  react(userId: string, reaction: LiveReactionId): Handled {
    if (!this.allowedReaction(userId)) return TOO_FAST;
    this.store.addReaction(reaction);
    this.burst[reaction] = (this.burst[reaction] ?? 0) + 1;
    this.burstTimer ??= setTimeout(
      () => this.ctx.waitUntil(this.flushBurst()),
      LIVE_ROOM_POLICY.reactionBurstMilliseconds,
    );
    void this.changed();
  }

  private async flushBurst(): Promise<void> {
    const counts = this.burst;
    this.burst = {};
    this.burstTimer = null;
    if (Object.keys(counts).length) await this.broadcast.all({ type: "reaction.burst", counts, at: nowIso() });
  }
}
