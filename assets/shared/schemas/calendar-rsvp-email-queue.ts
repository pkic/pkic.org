import { z } from "zod";

/** Queue transport carries only a reference to a private MIME payload. */
export const queuedRsvpEmailSchema = z.object({ version: z.literal(1), id: z.uuid() });
export type QueuedRsvpEmail = z.infer<typeof queuedRsvpEmailSchema>;
