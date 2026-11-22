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

export type LiveOccurrenceModerationChange =
  | { kind: "lift" }
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
