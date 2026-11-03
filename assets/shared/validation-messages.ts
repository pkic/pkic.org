/**
 * Plain-language defaults for contract refusals, in both runtimes.
 *
 * A message written on a schema always wins: this replaces only Zod's built-in
 * English locale, which speaks in schema terms ("Too small: expected string to
 * have >=1 characters", "must match pattern /^[a-z0-9]…/"). A person reading a
 * field message should learn what to enter, never how the contract is written.
 */
import { z } from "zod";
import englishLocale from "zod/v4/locales/en.js";

type Issue = Parameters<NonNullable<z.core.$ZodConfig["localeError"]>>[0];

const english = englishLocale().localeError!;

const FORMAT_MESSAGES: Record<string, string> = {
  email: "Enter a valid email address.",
  url: "Enter a valid web address.",
  datetime: "Enter a valid date and time.",
  date: "Enter a valid date.",
  time: "Enter a valid time.",
  uuid: "Choose one from the list.",
  regex: "Use only the characters this field allows.",
};

export function plainValidationMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null ? "This field is required." : undefined;
    case "too_small": {
      const minimum = Number(issue.minimum);
      if (issue.origin === "string")
        return minimum <= 1 ? "This field is required." : `Enter at least ${minimum} characters.`;
      if (issue.origin === "array" || issue.origin === "set")
        return minimum <= 1 ? "Choose at least one." : `Choose at least ${minimum}.`;
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint")
        return issue.inclusive === false ? `Enter more than ${minimum}.` : `Enter ${minimum} or more.`;
      return undefined;
    }
    case "too_big": {
      const maximum = Number(issue.maximum);
      if (issue.origin === "string") return `Use at most ${maximum} characters.`;
      if (issue.origin === "array" || issue.origin === "set") return `Choose at most ${maximum}.`;
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint")
        return issue.inclusive === false ? `Enter less than ${maximum}.` : `Enter ${maximum} or less.`;
      return undefined;
    }
    case "invalid_format":
      return FORMAT_MESSAGES[issue.format] ?? "Check the format of this value.";
    case "invalid_value":
      return "Choose one of the options.";
    default:
      return undefined;
  }
}

z.config({ localeError: (issue) => plainValidationMessage(issue) ?? english(issue) });
