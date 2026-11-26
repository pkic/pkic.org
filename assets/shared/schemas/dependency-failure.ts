import { z } from "zod";

export const DEPENDENCY_ERROR_CODE = "DEPENDENCY_UNAVAILABLE";
/**
 * `unchanged`: the request had attempted no database or file write when the dependency failed,
 * so repeating a read cannot repeat a change. `unknown`: a write may have completed.
 */
export const dependencyFailureOutcomeSchema = z.enum(["unknown", "unchanged"]);
export type DependencyFailureOutcome = z.infer<typeof dependencyFailureOutcomeSchema>;
export const dependencyFailureSchema = z.object({
  capability: z.enum(["data", "files"]),
  reference: z.uuid(),
  outcome: dependencyFailureOutcomeSchema,
});

/** A refusal a client may repeat automatically: a read that changed nothing before the dependency failed. */
export function isRepeatableDependencyFailure(method: string, code: string, details: unknown): boolean {
  if (!["GET", "HEAD"].includes(method.toUpperCase()) || code !== DEPENDENCY_ERROR_CODE) return false;
  const parsed = dependencyFailureSchema.safeParse(details);
  return parsed.success && parsed.data.outcome === "unchanged";
}
