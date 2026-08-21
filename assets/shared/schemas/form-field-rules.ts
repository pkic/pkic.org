import { z } from "zod";

const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);
const visualizationSchema = z.enum(["auto", "bar", "pie", "wordcloud", "list"]);

export const formFieldRulesSchema = z.object({
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  uiWidget: z.string().optional(),
  format: z.string().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional(),
  minLength: z.number().finite().optional(),
  maxLength: z.number().finite().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().optional(),
  minItems: z.number().finite().optional(),
  maxItems: z.number().finite().optional(),
  allowCustom: z.boolean().optional(),
  allowedDomains: z.array(z.string()).optional(),
  requireTrue: z.boolean().optional(),
  adminVisualization: visualizationSchema.optional(),
  visualization: visualizationSchema.optional(),
  showWhen: z
    .object({
      dayAttendanceIn: z.array(z.string()).optional(),
      eventAttendanceTypeIn: z.array(attendanceTypeSchema).optional(),
    })
    .optional(),
});

export type FormFieldRules = z.infer<typeof formFieldRulesSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerantly reads known rule keys from D1 JSON while dropping unknown keys and invalid values. */
export function parseFormFieldRules(value: unknown): FormFieldRules {
  if (!isRecord(value)) return {};
  const rules: FormFieldRules = {};
  const stringKeys = ["placeholder", "helpText", "uiWidget", "format", "pattern", "patternMessage"] as const;
  const numberKeys = ["minLength", "maxLength", "min", "max", "step", "minItems", "maxItems"] as const;
  const booleanKeys = ["allowCustom", "requireTrue"] as const;
  for (const key of stringKeys) if (typeof value[key] === "string") rules[key] = value[key];
  for (const key of numberKeys)
    if (typeof value[key] === "number" && Number.isFinite(value[key])) rules[key] = value[key];
  for (const key of booleanKeys) if (typeof value[key] === "boolean") rules[key] = value[key];
  for (const key of ["adminVisualization", "visualization"] as const) {
    const parsed = visualizationSchema.safeParse(value[key]);
    if (parsed.success) rules[key] = parsed.data;
  }
  if (Array.isArray(value.allowedDomains)) {
    rules.allowedDomains = value.allowedDomains.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  }
  if (isRecord(value.showWhen)) {
    const dayAttendanceIn = Array.isArray(value.showWhen.dayAttendanceIn)
      ? value.showWhen.dayAttendanceIn.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : undefined;
    const eventAttendanceTypeIn = Array.isArray(value.showWhen.eventAttendanceTypeIn)
      ? value.showWhen.eventAttendanceTypeIn.flatMap((entry) => {
          const parsed = attendanceTypeSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : undefined;
    if (dayAttendanceIn?.length || eventAttendanceTypeIn?.length) {
      rules.showWhen = { dayAttendanceIn, eventAttendanceTypeIn };
    }
  }
  if (rules.showWhen && !rules.showWhen.dayAttendanceIn?.length && !rules.showWhen.eventAttendanceTypeIn?.length) {
    return { ...rules, showWhen: undefined };
  }
  return rules;
}

export const PROFESSIONAL_PROFILE_DOMAINS = [
  "linkedin.com",
  "xing.com",
  "x.com",
  "twitter.com",
  "github.com",
  "gitlab.com",
] as const;

export function isAllowedProfileUrl(value: string, allowedDomains?: readonly string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    const domains = allowedDomains?.length ? allowedDomains : PROFESSIONAL_PROFILE_DOMAINS;
    return domains.some((domain) => {
      const normalized = domain.toLowerCase().replace(/^www\./, "");
      return host === normalized || host === `www.${normalized}` || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

export interface FormFieldVisibilityContext {
  dayAttendanceTypes?: readonly string[];
  eventAttendanceType?: "in_person" | "virtual" | "on_demand";
}

export function isFormFieldVisible(rules: FormFieldRules, context: FormFieldVisibilityContext): boolean {
  if (!rules.showWhen) return true;
  const dayModes = new Set(context.dayAttendanceTypes ?? []);
  if (rules.showWhen.dayAttendanceIn?.length) {
    if (!rules.showWhen.dayAttendanceIn.some((mode) => dayModes.has(mode))) return false;
  }
  if (rules.showWhen.eventAttendanceTypeIn?.length) {
    if (!context.eventAttendanceType || !rules.showWhen.eventAttendanceTypeIn.includes(context.eventAttendanceType)) {
      return false;
    }
  }
  return true;
}

export const formFieldOptionSchema = z.union([
  z.string(),
  z.object({ value: z.string(), label: z.string().optional() }),
]);
export const formFieldOptionsSchema = z.array(formFieldOptionSchema);
export interface FormFieldOption {
  value: string;
  label: string;
}

/** Canonical tolerant reader for the two supported persisted option shapes. */
export function parseFormFieldOptions(value: unknown): FormFieldOption[] {
  if (!Array.isArray(value)) return [];
  const options: FormFieldOption[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      options.push({ value: entry, label: entry });
    } else if (entry && typeof entry === "object" && typeof (entry as { value?: unknown }).value === "string") {
      const option = entry as { value: string; label?: unknown };
      const label = typeof option.label === "string" && option.label.trim() ? option.label.trim() : option.value;
      options.push({ value: option.value, label });
    }
  }
  return options;
}

export function formFieldOptionValues(value: unknown): string[] {
  return parseFormFieldOptions(value).map((option) => option.value);
}
