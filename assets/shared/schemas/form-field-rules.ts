import { z } from "zod";
import { httpUrlSchema } from "./urls";

const attendanceTypeSchema = z.enum(["in_person", "virtual", "on_demand"]);
const visualizationSchema = z.enum(["auto", "bar", "pie", "wordcloud", "list"]);
const formFieldFormatSchema = z.enum([
  "iso_country",
  "phone",
  "professional_profile",
  "date_range",
  "integer",
  "email",
  "date",
]);
const formFieldWidgetSchema = z.enum(["tags", "checkboxes", "rating_stars", "nps"]);
const boundedLengthSchema = z.number().int().min(0).max(100_000);
const boundedItemCountSchema = z.number().int().min(0).max(200);
const boundedNumberSchema = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);
const attendanceOptionSchema = z.string().trim().min(1).max(64);

const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^www\./, ""))
  .pipe(
    z
      .string()
      .min(1)
      .max(253)
      .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  );

/**
 * Accepts only an anchored, deliberately small regex subset with tightly
 * bounded backtracking: literals/escapes/classes followed by `?` or a bounded
 * `{min,max}` quantifier. Groups, alternation, lookarounds, backrefs, wildcards,
 * and unbounded `*`/`+` quantifiers are rejected.
 */
export function isSafeFormFieldPattern(pattern: string): boolean {
  if (pattern.length < 2 || pattern.length > 200 || pattern[0] !== "^" || pattern.at(-1) !== "$") return false;
  const body = pattern.slice(1, -1);
  if (!body) return false;

  let index = 0;
  let variableQuantifiers = 0;
  while (index < body.length) {
    const current = body[index];
    if (current === "\\") {
      if (index + 1 >= body.length || /[1-9]/.test(body[index + 1])) return false;
      index += 2;
    } else if (current === "[") {
      let classIndex = index + 1;
      if (body[classIndex] === "^") classIndex += 1;
      const contentStart = classIndex;
      for (; classIndex < body.length && body[classIndex] !== "]"; classIndex += 1) {
        if (body[classIndex] === "\\") classIndex += 1;
        if (classIndex >= body.length || body[classIndex] === "[") return false;
      }
      if (classIndex >= body.length || classIndex === contentStart) return false;
      index = classIndex + 1;
    } else {
      if (".^$*+?{}()|]".includes(current)) return false;
      index += 1;
    }

    if (body[index] === "?") {
      variableQuantifiers += 1;
      index += 1;
    } else if (body[index] === "{") {
      const match = /^\{(\d{1,3})(?:,(\d{1,3}))?\}/.exec(body.slice(index));
      if (!match) return false;
      const minimum = Number(match[1]);
      const maximum = Number(match[2] ?? match[1]);
      if (minimum > maximum || maximum > 200) return false;
      if (minimum !== maximum) variableQuantifiers += 1;
      index += match[0].length;
    }
    if (variableQuantifiers > 2) return false;
  }

  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const safeFormFieldPatternSchema = z
  .string()
  .trim()
  .max(200)
  .refine(isSafeFormFieldPattern, "Pattern must use the supported safe, bounded regular-expression subset");

const showWhenSchema = z
  .object({
    dayAttendanceIn: z.array(attendanceOptionSchema).max(20).optional(),
    eventAttendanceTypeIn: z.array(attendanceTypeSchema).max(3).optional(),
  })
  .strict();

const formFieldRulesShape = {
  placeholder: z.string().trim().max(500).optional(),
  helpText: z.string().trim().max(2000).optional(),
  uiWidget: formFieldWidgetSchema.optional(),
  format: formFieldFormatSchema.optional(),
  pattern: safeFormFieldPatternSchema.optional(),
  patternMessage: z.string().trim().min(1).max(500).optional(),
  minLength: boundedLengthSchema.optional(),
  maxLength: boundedLengthSchema.optional(),
  min: boundedNumberSchema.optional(),
  max: boundedNumberSchema.optional(),
  step: z.number().finite().positive().max(1_000_000_000_000).optional(),
  minItems: boundedItemCountSchema.optional(),
  maxItems: boundedItemCountSchema.optional(),
  allowCustom: z.boolean().optional(),
  allowedDomains: z.array(domainNameSchema).max(50).optional(),
  requireTrue: z.boolean().optional(),
  adminVisualization: visualizationSchema.optional(),
  visualization: visualizationSchema.optional(),
  showWhen: showWhenSchema.optional(),
};

export const formFieldRulesSchema = z
  .object(formFieldRulesShape)
  .strict()
  .superRefine((rules, ctx) => {
    for (const [minimumKey, maximumKey] of [
      ["minLength", "maxLength"],
      ["minItems", "maxItems"],
      ["min", "max"],
    ] as const) {
      const minimum = rules[minimumKey];
      const maximum = rules[maximumKey];
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        ctx.addIssue({ code: "custom", path: [maximumKey], message: `${maximumKey} must not be below ${minimumKey}` });
      }
    }
    if (rules.patternMessage && !rules.pattern) {
      ctx.addIssue({ code: "custom", path: ["patternMessage"], message: "patternMessage requires pattern" });
    }
  });

export type FormFieldRules = z.infer<typeof formFieldRulesSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tolerantly reads known, individually valid rule keys from legacy D1 JSON. */
export function parseFormFieldRules(value: unknown): FormFieldRules {
  if (!isRecord(value)) return {};
  const candidate: Record<string, unknown> = {};
  for (const key of Object.keys(formFieldRulesShape) as Array<keyof typeof formFieldRulesShape>) {
    if (key === "showWhen" || key === "allowedDomains" || value[key] === undefined) continue;
    const parsed = formFieldRulesShape[key].safeParse(value[key]);
    if (parsed.success) candidate[key] = parsed.data;
  }

  if (Array.isArray(value.allowedDomains)) {
    const domains = value.allowedDomains
      .flatMap((entry) => {
        const parsed = domainNameSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, 50);
    if (domains.length > 0) candidate.allowedDomains = domains;
  }

  if (isRecord(value.showWhen)) {
    const dayAttendanceIn = Array.isArray(value.showWhen.dayAttendanceIn)
      ? value.showWhen.dayAttendanceIn.flatMap((entry) => {
          const parsed = attendanceOptionSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : undefined;
    const eventAttendanceTypeIn = Array.isArray(value.showWhen.eventAttendanceTypeIn)
      ? value.showWhen.eventAttendanceTypeIn.flatMap((entry) => {
          const parsed = attendanceTypeSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : undefined;
    const parsed = showWhenSchema.safeParse({
      dayAttendanceIn: dayAttendanceIn?.slice(0, 20),
      eventAttendanceTypeIn: eventAttendanceTypeIn?.slice(0, 3),
    });
    if (parsed.success && (parsed.data.dayAttendanceIn?.length || parsed.data.eventAttendanceTypeIn?.length)) {
      candidate.showWhen = parsed.data;
    }
  }

  const parsed = formFieldRulesSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  delete candidate.patternMessage;
  for (const [minimumKey, maximumKey] of [
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
    ["min", "max"],
  ] as const) {
    if (
      typeof candidate[minimumKey] === "number" &&
      typeof candidate[maximumKey] === "number" &&
      candidate[minimumKey] > candidate[maximumKey]
    ) {
      delete candidate[maximumKey];
    }
  }
  return formFieldRulesSchema.parse(candidate);
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
    const parsedUrl = httpUrlSchema.safeParse(value);
    if (!parsedUrl.success) return false;
    const url = new URL(parsedUrl.data);
    const host = url.hostname.toLowerCase();
    const domains = allowedDomains?.length ? allowedDomains : PROFESSIONAL_PROFILE_DOMAINS;
    return domains.some((domain) => {
      const parsed = domainNameSchema.safeParse(domain);
      return parsed.success && (host === parsed.data || host.endsWith(`.${parsed.data}`));
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
  z.string().trim().min(1).max(500),
  z.object({ value: z.string().trim().min(1).max(500), label: z.string().trim().min(1).max(500).optional() }).strict(),
]);
export const formFieldOptionsSchema = z.array(formFieldOptionSchema).max(200);
export interface FormFieldOption {
  value: string;
  label: string;
}

/** Canonical tolerant reader for the two supported persisted option shapes. */
export function parseFormFieldOptions(value: unknown): FormFieldOption[] {
  if (!Array.isArray(value)) return [];
  const options: FormFieldOption[] = [];
  for (const entry of value.slice(0, 200)) {
    const parsed = formFieldOptionSchema.safeParse(entry);
    if (!parsed.success) continue;
    if (typeof parsed.data === "string") options.push({ value: parsed.data, label: parsed.data });
    else options.push({ value: parsed.data.value, label: parsed.data.label ?? parsed.data.value });
  }
  return options;
}

export function formFieldOptionValues(value: unknown): string[] {
  return parseFormFieldOptions(value).map((option) => option.value);
}
