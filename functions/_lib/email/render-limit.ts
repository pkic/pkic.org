import { AppError } from "../errors";

/** Shared hard ceiling for every rendered email artifact and pre-render expansion. */
export const EMAIL_TEMPLATE_RENDER_MAX_CHARS = 2_000_000;

export function throwEmailTemplateRenderLimitExceeded(): never {
  throw new AppError(422, "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED", "Email template exceeds the safe rendering limit");
}

export function assertEmailTemplateRenderLength(length: number, maxChars = EMAIL_TEMPLATE_RENDER_MAX_CHARS): void {
  if (length > maxChars) throwEmailTemplateRenderLimitExceeded();
}

export const EMAIL_TEMPLATE_RENDER_MAX_EXPANSIONS = 1_000;
export const EMAIL_TEMPLATE_RENDER_MAX_WORK_CHARS = 8_000_000;
export const EMAIL_SUBJECT_RENDER_MAX_CHARS = 8_192;
const EMAIL_TEMPLATE_RENDER_MAX_DEPTH = 32;

export interface TemplateRenderBudget {
  markdown?: boolean;
  maxChars: number;
  maxExpansions: number;
  maxWorkChars: number;
  expansions: number;
  workChars: number;
}

export function createTemplateRenderBudget(
  maxChars = EMAIL_TEMPLATE_RENDER_MAX_CHARS,
  maxExpansions = EMAIL_TEMPLATE_RENDER_MAX_EXPANSIONS,
  maxWorkChars = EMAIL_TEMPLATE_RENDER_MAX_WORK_CHARS,
): TemplateRenderBudget {
  return { maxChars, maxExpansions, maxWorkChars, expansions: 0, workChars: 0 };
}

export function assertTemplateRenderLength(length: number, budget: TemplateRenderBudget): void {
  assertEmailTemplateRenderLength(length, budget.maxChars);
}

export function assertTemplateRenderDepth(depth: number): void {
  if (depth > EMAIL_TEMPLATE_RENDER_MAX_DEPTH) throwEmailTemplateRenderLimitExceeded();
}

export function consumeTemplateExpansions(budget: TemplateRenderBudget, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || budget.expansions + count > budget.maxExpansions) {
    throwEmailTemplateRenderLimitExceeded();
  }
  budget.expansions += count;
}

export function consumeTemplateWork(budget: TemplateRenderBudget, characters: number): void {
  if (!Number.isSafeInteger(characters) || characters < 0 || budget.workChars + characters > budget.maxWorkChars) {
    throwEmailTemplateRenderLimitExceeded();
  }
  budget.workChars += characters;
}
