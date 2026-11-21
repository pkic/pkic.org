import { describe, expect, it } from "vitest";
import { parseFormFieldOptions } from "../../assets/shared/schemas/form-field-rules";
import { buildFormAnswerRows, formatFormAnswerValue } from "../../assets/ts/components/forms/form-answers";
import { field } from "./helpers/form-response-fixtures";

describe("form answer rows", () => {
  it("resolves stored option values to their labels and keeps unlisted keys", () => {
    expect(formatFormAnswerValue("high", field())).toEqual(["High"]);
    expect(formatFormAnswerValue(["high", "unknown"], field())).toEqual(["High", "unknown"]);
    // An absent answer is a dash rather than the string "undefined".
    expect(formatFormAnswerValue(undefined, field())).toEqual(["-"]);
    expect(formatFormAnswerValue([], field())).toEqual(["-"]);
  });

  it("uses the canonical option labels and date-range wording in every answer view", () => {
    const dietary = field({
      options: parseFormFieldOptions(["gluten_free", "nut_allergy", { value: "custom_value", label: "Custom label" }]),
    });
    expect(formatFormAnswerValue(["gluten_free", "nut_allergy", "custom_value"], dietary)).toEqual([
      "Gluten free",
      "Nut allergy",
      "Custom label",
    ]);
    expect(formatFormAnswerValue({ start: "2026-12-01", end: "2026-12-03" })).toEqual(["2026-12-01 to 2026-12-03"]);
    expect(formatFormAnswerValue({ start: "", end: "2026-12-03" })).toEqual(["-"]);
  });

  it("reads a stored country code as the country's name", () => {
    const country = field({ validation: { format: "iso_country" } });
    expect(formatFormAnswerValue("NL", country)).toEqual(["Netherlands"]);
    expect(formatFormAnswerValue("zz", country)).toEqual(["zz"]);
  });

  it("keeps answers to fields the definition no longer lists", () => {
    const rows = buildFormAnswerRows({ priority: "high", retired_question: "kept" }, [field()]);
    expect(rows.map((row) => row.key)).toEqual(["priority", "retired_question"]);
    // The label falls back to the key rather than the row disappearing.
    expect(rows[1].label).toBe("retired_question");
  });
});
