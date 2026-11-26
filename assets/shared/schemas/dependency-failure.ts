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

/**
 * A refusal a client may repeat automatically: a GET that changed nothing before the dependency failed.
 * HEAD is excluded because its refusal has no body to carry the outcome.
 */
export function isRepeatableDependencyFailure(method: string, code: string, details: unknown): boolean {
  if (method.toUpperCase() !== "GET" || code !== DEPENDENCY_ERROR_CODE) return false;
  const parsed = dependencyFailureSchema.safeParse(details);
  return parsed.success && parsed.data.outcome === "unchanged";
}
