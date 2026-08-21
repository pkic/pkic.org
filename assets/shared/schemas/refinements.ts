import type { RefinementCtx } from "zod";

interface DuplicateStringIssueOptions<T> {
  value: (item: T) => string;
  path: (index: number) => PropertyKey[];
  label: string;
}

/** Adds one issue for each duplicate after the first occurrence. */
export function addDuplicateStringIssues<T>(
  items: readonly T[],
  ctx: RefinementCtx,
  options: DuplicateStringIssueOptions<T>,
): void {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const value = options.value(item);
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `${options.label} '${value}' is duplicated`,
        path: options.path(index),
      });
    } else {
      seen.add(value);
    }
  }
}
