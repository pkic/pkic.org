import { z } from "zod";
import { utcInstantSchema } from "./api-common";

/** A person's display name as the live room shows it. */
export const livePersonNameSchema = z.string().trim().min(1).max(200);

/** Who changed a shared control and when; shown beside it so parallel operators see each other. */
export const liveChangeSchema = z.object({ operatorName: livePersonNameSchema, at: utcInstantSchema }).strict();
export type LiveChange = z.infer<typeof liveChangeSchema>;
