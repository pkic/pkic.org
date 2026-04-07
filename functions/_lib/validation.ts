import { z } from "zod";
import { AppError } from "./errors";
import {
  attendanceTypeSchema,
  consentItemSchema,
  normalizedEmailSchema,
  sourceTypeSchema,
} from "../../assets/shared/schemas/api";

type JsonRequestLike = Request | { raw?: Request; json?: () => Promise<unknown> };

export async function parseJsonBody<T>(request: JsonRequestLike, schema: z.ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    if (request instanceof Request) {
      body = await request.json();
    } else if (request.raw) {
      body = await request.raw.json();
    } else if (request.json) {
      body = await request.json();
    } else {
      throw new Error("Missing JSON reader");
    }
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
  }

  return parsed.data;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = normalizedEmailSchema;
export { attendanceTypeSchema, sourceTypeSchema, consentItemSchema };
