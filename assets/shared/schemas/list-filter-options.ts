import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/** Distinct column values use the same bounded query and page contracts as rows. */
export const listFilterOptionsQuerySchema = listQuerySchema(["value"] as const);
export const listFilterOptionSchema = z.object({ value: z.string(), label: z.string() });
export const listFilterOptionsResponseSchema = paginatedResponseSchema("options", listFilterOptionSchema);
