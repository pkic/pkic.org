import { DEPENDENCY_ERROR_CODE, dependencyFailureSchema } from "../../assets/shared/schemas/dependency-failure";
import { AppError } from "./errors";
import type { z } from "zod";

export type DependencyOperation =
  | "prepare"
  | "first"
  | "all"
  | "run"
  | "batch"
  | "exec"
  | "get"
  | "put"
  | "head"
  | "delete"
  | "list"
  | "createMultipartUpload";

const TRANSIENT_REASONS = [
  ["overloaded", /overloaded/i],
  ["connection_lost", /network connection lost/i],
  ["replica_disconnected", /disconnected from primary/i],
  ["transient_issue", /transient issue/i],
  ["timeout", /exceeded timeout|timed? ?out/i],
  ["code_updated", /code was updated/i],
  ["reset", /object to be reset/i],
  ["service_unavailable", /service unavailable/i],
  ["internal_error", /internal error/i],
  ["http_5xx", /\b(?:500|502|503|504)\b/],
] as const;

/** Match provider availability errors narrowly; SQL, permission and missing-object errors remain distinct. */
export function dependencyFailure(
  error: unknown,
  provider?: "D1" | "R2",
  operation?: DependencyOperation,
): AppError | null {
  if (!(error instanceof Error) || error instanceof AppError) return null;
  const message = error.message;
  const d1 =
    provider === "D1" || /(?:D1[_ ](?:ERROR|DB)|D1 DB storage|Replica disconnected from primary)/i.test(message);
  const r2 =
    provider === "R2" || /^(?:R2|(?:get|put|head|delete|list): (?:Internal Error|Service Unavailable))/i.test(message);
  const r2ServiceCode = r2 ? /\((10001|10043|10058)\)$/.exec(message)?.[1] : undefined;
  const reason = TRANSIENT_REASONS.find(([, pattern]) => pattern.test(message))?.[0];
  if ((!d1 && !r2) || (!reason && !r2ServiceCode)) return null;
  const details: z.infer<typeof dependencyFailureSchema> = {
    capability: d1 ? "data" : "files",
    reference: crypto.randomUUID(),
    outcome: "unknown",
  };
  // Provider messages can include SQL, bound values, or object keys. Every diagnostic is bounded.
  console.error("DEPENDENCY_UNAVAILABLE", {
    reference: details.reference,
    dependency: d1 ? "D1" : "R2",
    operation: operation ?? "unknown",
    reason: reason ?? "provider_service_error",
    ...(r2ServiceCode ? { providerCode: r2ServiceCode } : {}),
  });
  return new AppError(
    503,
    DEPENDENCY_ERROR_CODE,
    `${d1 ? "Online data" : "File storage"} is temporarily unavailable. Your existing view can remain open. If you were saving a change, check whether it completed before trying again.`,
    details,
  );
}
