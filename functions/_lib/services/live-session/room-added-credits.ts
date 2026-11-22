import {
  LIVE_ADDED_CREDITS_MAX,
  addedLiveCreditKey,
  addedLivePersonKey,
  liveCreditAlreadyListed,
  isAddedLiveCreditKey,
  isTypedLiveCreditKey,
} from "../../../../assets/shared/live-room-credits";
import type {
  LiveAddedCreditInput,
  LiveCredit,
  LiveRoomServerMessage,
  LiveRoomSession,
  LiveTypedCreditInput,
} from "../../../../assets/shared/schemas/live-session-room";
import type { DatabaseLike } from "../../types";
import { readLiveCandidate } from "./live-credit-identities";
import { LIVE_CREDIT_NOT_FOUND } from "./room-composition";
import type { LiveControlOutcome } from "./room-controls";
import { refreshLiveCreditCopies } from "./room-credit-refresh";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

/**
 * People operators add to one session's lower thirds: one identity of
 * someone from the event's people, named and pictured as their profile has
 * them with that identity's title and organization, or a name and a line
 * under it typed in for someone without an account, which operators can
 * edit later. They live in the room's own storage for the session,
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
      additionalIdentities: [],
      roleLabel: null,
      // Only someone without an account carries a typed line; an identity is the one source for everyone else.
      titleLine: input.userId ? null : input.titleLine,
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
   * Changes the name and line an operator typed for someone without an
   * account. Every operator sees the change, and so does every output that
   * shows their lower third now: a typo is put right while they are on air.
   * A person from the event's people reads as their identity has them and
   * is not edited here.
   */
  update(
    operator: Operator,
    session: LiveRoomSession,
    creditKey: string,
    input: LiveTypedCreditInput,
    at: string,
  ): LiveControlOutcome {
    if (!isTypedLiveCreditKey(creditKey))
      return {
        code: "LIVE_CREDIT_NOT_EDITABLE",
        message: "Only a person added without an account can be edited here.",
      };
    const current = this.store.addedCredits();
    const credit = current.find((entry) => entry.key === creditKey);
    if (!credit) return LIVE_CREDIT_NOT_FOUND;
    if (credit.name === input.name && credit.titleLine === input.titleLine) return { messages: [] };
    const next = current.map((entry) =>
      entry.key === creditKey ? { ...entry, name: input.name, titleLine: input.titleLine } : entry,
    );
    this.store.saveAddedCredits(next);
    this.store.recordStaffAction(operator.userId, "live_session.credit.updated", { creditKey }, at);
    return {
      messages: [
        { type: "credits.added.changed", addedCredits: next },
        ...refreshLiveCreditCopies(this.store, session),
      ],
    };
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
      Object.values(outputs).some((composition) => composition.lowerThird?.key === creditKey)
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
