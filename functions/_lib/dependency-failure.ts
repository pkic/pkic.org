import { DEPENDENCY_ERROR_CODE, dependencyFailureSchema } from "../../assets/shared/schemas/dependency-failure";
import { AppError } from "./errors";
import type { z } from "zod";

/** Match provider availability errors narrowly; SQL, permission and missing-object errors remain distinct. */
export function dependencyFailure(error: unknown, provider?: "D1" | "R2"): AppError | null {
  if (!(error instanceof Error) || error instanceof AppError) return null;
  const message = error.message;
  const d1 =
    provider === "D1" || /(?:D1[_ ](?:ERROR|DB)|D1 DB storage|Replica disconnected from primary)/i.test(message);
  const r2 =
    provider === "R2" || /^(?:R2|(?:get|put|head|delete|list): (?:Internal Error|Service Unavailable))/i.test(message);
  const r2ServiceCode = /\((10001|10043|10058)\)$/.test(message);
  const transient =
    /(?:overloaded|network connection lost|disconnected from primary|transient issue|exceeded timeout|timed? ?out|object to be reset|code was updated|service unavailable|internal error|\b(?:500|502|503|504)\b)/i.test(
      message,
    );
  if ((!d1 && !r2) || (!transient && !(r2 && r2ServiceCode))) return null;
  const details: z.infer<typeof dependencyFailureSchema> = {
    capability: d1 ? "data" : "files",
    reference: crypto.randomUUID(),
    outcome: "unknown",
  };
  // Provider messages can include SQL or object keys. Log only a reference and bounded classification.
  console.error("DEPENDENCY_UNAVAILABLE", { reference: details.reference, dependency: d1 ? "D1" : "R2" });
  return new AppError(
    503,
    DEPENDENCY_ERROR_CODE,
    `${d1 ? "Online data" : "File storage"} is temporarily unavailable. Your existing view can remain open. If you were saving a change, check whether it completed before trying again.`,
    details,
  );
}
