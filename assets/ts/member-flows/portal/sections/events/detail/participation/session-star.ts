import type { z } from "zod";
import {
  sessionParticipationResponseSchema,
  type sessionParticipationRequestSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { putJson } from "../../../../../../shared/api-client";

/** The one star command: it puts a session on My agenda, or takes it off, and never reserves a seat. */
export function setSessionStar(slug: string, occurrenceId: string, starred: boolean) {
  const body: z.input<typeof sessionParticipationRequestSchema> = { action: starred ? "save" : "unsave" };
  return putJson(
    `/api/v1/events/${encodeURIComponent(slug)}/agenda/${encodeURIComponent(occurrenceId)}/participation`,
    body,
    sessionParticipationResponseSchema,
  );
}
