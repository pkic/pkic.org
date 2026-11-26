import type {
  LiveModerationReason,
  LiveParticipationBlock,
  LiveParticipationRestriction,
} from "../../../../assets/shared/live-moderation-policy";
import type { LiveRoomOpening } from "../../../../assets/shared/schemas/live-room-opening";

export interface LiveOccurrenceParticipation {
  opening: LiveRoomOpening;
  restriction: LiveParticipationRestriction | null;
}

/** An organizer's event block or lift, already in D1, and when it was decided, so an older notice can't undo it. */
export interface LiveEventBlockDecision {
  blocked: boolean;
  at: number;
}

export type LiveOccurrenceModerationChange =
  | { kind: "lift" }
  /** An event block decided in D1 by another room; this room takes it at once rather than at its next read. */
  | { kind: "event"; decision: LiveEventBlockDecision }
  | {
      kind: "block";
      block: Exclude<LiveParticipationBlock, "event">;
      reason: LiveModerationReason;
      actor: { userId: string; name: string };
      at: string;
    };

export interface LiveOccurrenceModeration {
  read(userId: string): Promise<LiveOccurrenceParticipation>;
  change(userId: string, change: LiveOccurrenceModerationChange): Promise<LiveOccurrenceParticipation>;
}
