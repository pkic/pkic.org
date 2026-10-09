import { z } from "zod";

/** A bounded strong validator for comparing every ranged download against the original source. */
export const recordingSourceEtagSchema = z
  .string()
  .max(1024)
  .regex(/^"[^"\s]+"$/)
  .refine(
    (value) => !Array.from(value).some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) === 127),
  );
