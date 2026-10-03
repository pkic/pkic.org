import { z } from "zod";
import { publicMemberSummarySchema } from "./members-directory";

/** Public identities needed to resolve earlier query-based profile links. */
export const memberProfilePathsSchema = z.record(z.string(), publicMemberSummarySchema.pick({ id: true, slug: true }));
