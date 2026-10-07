import { z } from "zod";
import { agendaSnapshotSchema } from "./event-agenda";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize historical staffing names in memory; original approval and replay bytes stay untouched. */
export const storedAgendaSnapshotSchema = z
  .unknown()
  .transform((value, context) => {
    const rename = (input: unknown, previous: string, current: string, path: (string | number)[]): unknown => {
      if (!record(input)) return input;
      const result = { ...input };
      if (Object.hasOwn(result, previous)) {
        if (Object.hasOwn(result, current)) {
          context.addIssue({ code: "custom", path, message: `Choose only one of ${previous} or ${current}` });
          return result;
        }
        result[current] = result[previous];
        delete result[previous];
      }
      return result;
    };
    const result = rename(value, "blocks", "shifts", []);
    if (!record(result)) return result;
    const references = (input: unknown, path: (string | number)[]) =>
      Array.isArray(input) ? input.map((entry, index) => rename(entry, "blockId", "shiftId", [...path, index])) : input;
    for (const field of ["staffingRequirements", "assignments"])
      if (Object.hasOwn(result, field)) result[field] = references(result[field], [field]);
    if (record(result.staffingReport)) {
      const report = { ...result.staffingReport };
      result.staffingReport = report;
      for (const field of ["coverage", "uncovered", "boundaryChanges"])
        if (Object.hasOwn(report, field)) report[field] = references(report[field], ["staffingReport", field]);
    }
    return result;
  })
  .pipe(agendaSnapshotSchema);
