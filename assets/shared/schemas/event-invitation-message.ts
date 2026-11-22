import { z } from "zod";
import { trimmedString } from "./api-common";

/** Bounds an organizer's invitation wording so a card, a dialog and an email can all carry it. */
export const EVENT_INVITATION_HEADLINE_MAX = 120;
export const EVENT_INVITATION_MESSAGE_MAX = 2000;

/**
 * The event's own invitation wording, stored under `invitationMessage` in the event
 * settings: a plain-text headline and a short Markdown message. The portal's
 * invitation card and dialog and the invitation email all read it; with
 * neither part set they fall back to a neutral line from the event's name.
 */
export const eventInvitationMessageSchema = z
  .object({
    headline: trimmedString(3, EVENT_INVITATION_HEADLINE_MAX).nullable(),
    message: trimmedString(1, EVENT_INVITATION_MESSAGE_MAX).nullable(),
  })
  .strict();
export type EventInvitationMessage = z.infer<typeof eventInvitationMessageSchema>;

/** The stored invitation wording, or null when the event has none or it no longer validates. */
export function readEventInvitationMessage(settings: unknown): EventInvitationMessage | null {
  if (!settings || typeof settings !== "object") return null;
  const parsed = eventInvitationMessageSchema.safeParse((settings as Record<string, unknown>).invitationMessage);
  if (!parsed.success || (!parsed.data.headline && !parsed.data.message)) return null;
  return parsed.data;
}
