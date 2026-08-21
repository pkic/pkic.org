import { z } from "zod";

/** Same-origin redirect target; rejects scheme-relative and backslash-normalized URLs. */
export const relativeRedirectPathSchema = z
  .string()
  .trim()
  .max(500)
  .refine((path) => path.startsWith("/"), "Must be a relative path starting with /")
  .refine((path) => !path.includes("//"), "Must not contain //")
  .refine((path) => !path.includes("\\"), "Must not contain backslashes");
