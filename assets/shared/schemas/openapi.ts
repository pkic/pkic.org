import type { ZodType } from "zod";

export function requiredJsonBody<T extends ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true } as const;
}

export function optionalJsonBody<T extends ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: false } as const;
}

export function jsonResponse<T extends ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } } as const;
}
