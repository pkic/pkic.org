import { z } from "zod";
import { SOURCE_TYPES } from "../constants/source-types";

export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const defaultedSourceTypeSchema = sourceTypeSchema
  .catch("direct")
  .default("direct")
  .meta({
    type: "string",
    enum: [...SOURCE_TYPES],
    default: "direct",
  });
