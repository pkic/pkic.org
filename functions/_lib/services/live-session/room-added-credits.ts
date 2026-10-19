import {
  LIVE_ADDED_CREDITS_MAX,
  addedLiveCreditKey,
  addedLivePersonKey,
  liveCreditAlreadyListed,
  isAddedLiveCreditKey,
} from "../../../../assets/shared/live-room-credits";
import { LIVE_AUX_OUTPUTS } from "../../../../assets/shared/live-room-outputs";
import type {
  LiveAddedCreditInput,
  LiveCredit,
  LiveRoomServerMessage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { DatabaseLike } from "../../types";
import { readLiveCandidate } from "./live-credit-identities";
import type { LiveControlOutcome } from "./room-controls";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

/**
 * People operators add to one session's lower thirds: one identity of
 * someone from the event's people, named and pictured as their profile has
 * them with that identity's title and organization, or a name typed in for
 * someone without an account. They live in the room's own storage for the session,
 * shared by every operator and never sent to attendees; Program shows one
 * only while an operator puts it on air.
 */
export class LiveRoomAddedCredits {
  constructor(
    private readonly db: DatabaseLike,
    private readonly store: LiveRoomStore,
  ) {}

  async add(operator: Operator, input: LiveAddedCreditInput, at: string): Promise<LiveControlOutcome> {
    const current = this.store.addedCredits();
    if (current.length >= LIVE_ADDED_CREDITS_MAX)
      return {
        code: "LIVE_ADDED_CREDITS_FULL",
        message: `This session already has ${LIVE_ADDED_CREDITS_MAX} added people. Remove one first.`,
      };
    // The same person in the same capacity is listed once; a speaker credited on the session already has a row.
    if (input.userId) {
      const listed = new Set(
        [...current, ...(this.store.session()?.session.credits ?? [])].map((credit) => credit.key),
      );
      if (liveCreditAlreadyListed(listed, { userId: input.userId, identityId: input.identityId }))
        return { code: "LIVE_PERSON_ALREADY_ADDED", message: "This person is already in this session's lower thirds." };
    }
    const person = input.userId ? await readLiveCandidate(this.db, input.userId, input.identityId) : null;
    if (input.userId && !person)
      return {
        code: "LIVE_PERSON_NOT_FOUND",
        message: "That person or identity is no longer available. Search again.",
      };
    const credit: LiveCredit = {
      key: input.userId ? addedLivePersonKey(input.userId, input.identityId) : addedLiveCreditKey(crypto.randomUUID()),
      name: person?.name ?? input.name,
      moderator: false,
      photoUrl: person?.photoUrl ?? null,
      identity: person?.identity ?? null,
      roleLabel: null,
    };
    const next = [...current, credit];
    this.store.saveAddedCredits(next);
    this.store.recordStaffAction(
      operator.userId,
      "live_session.credit.added",
      { creditKey: credit.key, userId: input.userId, identityId: input.identityId },
      at,
    );
    return { messages: [{ type: "credits.added.changed", addedCredits: next }] };
  }

  /**
   * Removes an added person. Someone on Program or a room output comes off
   * air first, so no output keeps a person the desk no longer lists; Preview
   * and the lineup let go of them here.
   */
  remove(operator: Operator, creditKey: string, at: string): LiveControlOutcome {
    if (!isAddedLiveCreditKey(creditKey)) return { messages: [] };
    const current = this.store.addedCredits();
    if (!current.some((credit) => credit.key === creditKey)) return { messages: [] };
    const outputs = this.store.outputs();
    if (
      this.store.stage().lowerThird?.key === creditKey ||
      LIVE_AUX_OUTPUTS.some((output) => outputs[output].lowerThird?.key === creditKey)
    )
      return { code: "LIVE_CREDIT_ON_AIR", message: "Take this lower third off air before removing the person." };
    const next = current.filter((credit) => credit.key !== creditKey);
    this.store.saveAddedCredits(next);
    const messages: LiveRoomServerMessage[] = [{ type: "credits.added.changed", addedCredits: next }];
    const preview = this.store.preview();
    if (preview.lowerThird?.key === creditKey) {
      const composition = { ...preview, lowerThird: null, lowerThirdChange: { operatorName: operator.name, at } };
      this.store.savePreview(composition);
      messages.push({ type: "preview.changed", composition });
    }
    const queue = this.store.queue();
    if (queue["lower-third"].includes(creditKey)) {
      const lineup = {
        ...queue,
        "lower-third": queue["lower-third"].filter((key) => key !== creditKey),
        change: { operatorName: operator.name, at },
      };
      this.store.saveQueue(lineup);
      messages.push({ type: "queue.changed", queue: lineup });
    }
    this.store.recordStaffAction(operator.userId, "live_session.credit.removed", { creditKey }, at);
    return { messages };
  }
}
