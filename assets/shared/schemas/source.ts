import { z } from "zod";
import { SOURCE_TYPES } from "../constants/source-types";

export const sourceTypeSchema = z.enum(SOURCE_TYPES);
/** Stored registrations also originate from accepted speaker proposals. */
export const registrationSourceTypeSchema = sourceTypeSchema.or(z.literal("proposal"));
export const defaultedSourceTypeSchema = sourceTypeSchema
  .catch("direct")
  .default("direct")
  .meta({
    type: "string",
    enum: [...SOURCE_TYPES],
    default: "direct",
  });
