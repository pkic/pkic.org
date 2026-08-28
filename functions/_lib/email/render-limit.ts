import { AppError } from "../errors";

/** Shared hard ceiling for every rendered email artifact and pre-render expansion. */
export const EMAIL_TEMPLATE_RENDER_MAX_CHARS = 2_000_000;

export function throwEmailTemplateRenderLimitExceeded(): never {
  throw new AppError(422, "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED", "Email template exceeds the safe rendering limit");
}

export function assertEmailTemplateRenderLength(length: number, maxChars = EMAIL_TEMPLATE_RENDER_MAX_CHARS): void {
  if (length > maxChars) throwEmailTemplateRenderLimitExceeded();
}
