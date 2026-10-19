import { z } from "zod";
import { agendaContentFieldsSchema } from "./event-agenda-content";
import { agendaHistoricalMetadataReviewSchema } from "./event-agenda-historical-review";
import { transferOccurrenceSchema } from "./event-agenda-transfer";

/** Accepted source content retains both the latest mapping and its earliest authored evidence. */
export const agendaContentSourceSnapshotSchema = agendaContentFieldsSchema.extend({
  retainedSourceEvidence: transferOccurrenceSchema.shape.retainedSourceEvidence,
  historicalMetadataEvidence: z.array(agendaHistoricalMetadataReviewSchema).max(100).optional(),
  originalHistoricalMetadataEvidence: z.array(agendaHistoricalMetadataReviewSchema).max(100).optional(),
});
export type AgendaContentSourceSnapshot = z.infer<typeof agendaContentSourceSnapshotSchema>;
