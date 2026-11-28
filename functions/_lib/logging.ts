import { ZodError } from "zod";

export function logInfo(message: string, data?: unknown): void {
  console.log(JSON.stringify({ level: "info", message, data: data ?? null }));
}

export function logError(message: string, data?: unknown): void {
  console.error(JSON.stringify({ level: "error", message, data: data ?? null }));
}

/**
 * Which fields a failed parse rejected and why, without the values: a
 * validation error that crosses a Durable Object boundary arrives as a bare
 * "ZodError", so the side that parsed logs this before it rethrows.
 */
export function validationFaultFields(error: unknown): Array<{ field: string; code: string }> | null {
  if (!(error instanceof ZodError)) return null;
  return error.issues.slice(0, 20).map((issue) => ({ field: issue.path.join("."), code: issue.code }));
}
