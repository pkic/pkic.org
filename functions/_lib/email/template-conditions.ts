/** The condition grammar used by both rendering and authored-reference validation. */
export type TemplateCondition =
  | { kind: "and" | "or"; variables: string[] }
  | { kind: "comparison"; operator: string; variable: string; literal: string }
  | { kind: "value"; variable: string };

export function parseTemplateCondition(condition: string): TemplateCondition {
  if (condition.startsWith("and ") || condition.startsWith("or ")) {
    const [kind, ...variables] = condition.split(/\s+/).filter(Boolean);
    return { kind: kind === "and" ? "and" : "or", variables };
  }
  const comparison = /^(eq|ne|gt|gte|lt|lte)\s+(\w+)\s+"([^"]*)"$/.exec(condition);
  return comparison
    ? { kind: "comparison", operator: comparison[1]!, variable: comparison[2]!, literal: comparison[3]! }
    : { kind: "value", variable: condition };
}

export function conditionVariableNames(condition: TemplateCondition): string[] {
  return "variables" in condition ? condition.variables : [condition.variable];
}

export function isTruthy(value: unknown): boolean {
  return Boolean(value) && value !== "false" && value !== "0" && value !== "";
}

export function evaluateIfCondition(condition: string, data: Record<string, unknown>): boolean {
  const parsed = parseTemplateCondition(condition);
  if ("variables" in parsed) {
    return parsed.kind === "and"
      ? parsed.variables.every((name) => isTruthy(data[name]))
      : parsed.variables.some((name) => isTruthy(data[name]));
  }
  if (parsed.kind === "value") return isTruthy(data[parsed.variable]);
  const value = String(data[parsed.variable] ?? "");
  const number = parseFloat(value),
    literalNumber = parseFloat(parsed.literal);
  switch (parsed.operator) {
    case "eq":
      return value === parsed.literal;
    case "ne":
      return value !== parsed.literal;
    case "gt":
      return !isNaN(number) && !isNaN(literalNumber) && number > literalNumber;
    case "gte":
      return !isNaN(number) && !isNaN(literalNumber) && number >= literalNumber;
    case "lt":
      return !isNaN(number) && !isNaN(literalNumber) && number < literalNumber;
    case "lte":
      return !isNaN(number) && !isNaN(literalNumber) && number <= literalNumber;
    default:
      return false;
  }
}
