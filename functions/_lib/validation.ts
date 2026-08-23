import { z } from "zod";
import { AppError } from "./errors";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "./http-body";
import { attendanceTypeSchema, consentItemSchema } from "../../assets/shared/schemas/registration";
import { normalizedEmailSchema } from "../../assets/shared/schemas/api-common";
import { sourceTypeSchema } from "../../assets/shared/schemas/source";

type JsonRequestLike = Request | { raw?: Request };

export async function parseJsonBody<T>(
  request: JsonRequestLike,
  schema: z.ZodSchema<T>,
  maxBytes = JSON_REQUEST_MAX_BYTES,
): Promise<T> {
  let body: unknown;
  try {
    if (request instanceof Request) {
      body = await readBoundedJsonBody(request, maxBytes);
    } else if (request.raw) {
      body = await readBoundedJsonBody(request.raw, maxBytes);
    } else {
      throw new Error("Missing JSON reader");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
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
