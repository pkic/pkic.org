/** Stream reactions on the room's socket: what a viewer sends, and the bursts every view receives. */
import { z } from "zod";
import { LIVE_REACTION_IDS } from "../live-session-policy";
import { utcInstantSchema } from "./api-common";

export const liveReactionSchema = z.enum(LIVE_REACTION_IDS);
/** A count per reaction; reactions without any are left out. */
export const liveReactionCountsSchema = z.partialRecord(liveReactionSchema, z.number().int().positive());

export const liveReactionSendSchema = z
  .object({ type: z.literal("reaction.send"), reaction: liveReactionSchema })
  .strict();

/**
 * The reactions since the last burst, counted in people. `counts` holds the
 * people whose first reaction in the window arrived in this burst; `people`
 * the distinct people within the window, for each reaction in this burst.
 */
export const liveReactionBurstSchema = z
  .object({
    type: z.literal("reaction.burst"),
    counts: liveReactionCountsSchema,
    people: liveReactionCountsSchema,
    at: utcInstantSchema,
  })
  .strict();
