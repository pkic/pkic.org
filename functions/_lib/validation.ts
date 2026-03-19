import { z } from "zod";
import { AppError } from "./errors";
import {
  attendanceTypeSchema,
  consentItemSchema,
  normalizedEmailSchema,
  sourceTypeSchema,
} from "../../assets/shared/schemas/api";

export async function parseJsonBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
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
