import type { z } from "zod";
import { INDEPENDENT_CAPACITY_REVIEW_COPY } from "../../../../../../../shared/email-first-copy";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { sessionHistoryCorrectionSchema } from "../../../../../../../shared/schemas/event-session-history";
import {
  UNVERIFIED_INDEPENDENT_APPEARANCE_CODE,
  unverifiedIndependentAppearanceDetailsSchema,
} from "../../../../../../../shared/schemas/independent-capacity";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ApiClientError, postJson } from "../../../../../../shared/api-client";

/**
 * Saves a session archive correction. When it approves an individual
 * appearance for an independent speaker nobody has verified yet, the editor is
 * warned and must approve those speakers explicitly; backing out saves nothing
 * and resolves null.
 */
export async function saveSessionHistoryCorrection(
  eventSlug: string,
  occurrenceId: string,
  body: z.output<typeof sessionHistoryCorrectionSchema>,
): Promise<AgendaSnapshot | null> {
  const url = `/api/v1/events/${encodeURIComponent(eventSlug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/history`;
  try {
    return await postJson(url, body, agendaSnapshotSchema);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== UNVERIFIED_INDEPENDENT_APPEARANCE_CODE) throw error;
    const details = unverifiedIndependentAppearanceDetailsSchema.safeParse(error.details);
    if (!details.success) throw error;
    const approved = await confirmAction({
      title: INDEPENDENT_CAPACITY_REVIEW_COPY.appearanceWarningTitle,
      body: error.message,
      confirmLabel: INDEPENDENT_CAPACITY_REVIEW_COPY.appearanceApprove,
    });
    if (!approved) return null;
    return postJson(
      url,
      {
        ...body,
        acknowledgedUnverifiedIndependent: [
          ...body.acknowledgedUnverifiedIndependent,
          ...details.data.speakers.map((speaker) => speaker.userId),
        ],
      },
      agendaSnapshotSchema,
    );
  }
}
