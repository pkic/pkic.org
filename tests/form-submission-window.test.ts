/**
 * The submission window: the rule itself, the refusal it produces, and the
 * contract that refuses an impossible window before it can be stored.
 *
 * Issue #38: a form may carry an optional time range within which it accepts
 * submissions. The instants are stored and transported as UTC and localized
 * only where they are shown, per the repository's time rules.
 */
import { describe, expect, it } from "vitest";
import { deriveFormSubmissionWindowState, isFormSubmissionWindowOpen } from "../assets/shared/form-submission-window";
import { formPlacementCreateSchema, formPlacementPolicyUpdateSchema } from "../assets/shared/schemas/forms";
import { groupFormPlacementUpdateSchema } from "../assets/shared/schemas/group-forms";
import { requireOpenFormSubmissionWindow } from "../functions/_lib/services/forms/submission-window";

const OPENS = "2026-06-01T09:00:00.000Z";
const CLOSES = "2026-07-01T17:00:00.000Z";

describe("form submission window state", () => {
  it("is open when neither bound is set", () => {
    expect(deriveFormSubmissionWindowState({ opensAt: null, closesAt: null }, OPENS)).toBe("open");
  });

  it("is scheduled before the opening instant and open from it", () => {
    const window = { opensAt: OPENS, closesAt: null };
    expect(deriveFormSubmissionWindowState(window, "2026-06-01T08:59:59.999Z")).toBe("scheduled");
    // The opening instant is inside the window, so a submitter who arrives on
    // the stroke of nine is not turned away.
    expect(deriveFormSubmissionWindowState(window, OPENS)).toBe("open");
  });

  it("is open until the closing instant and closed from it", () => {
    const window = { opensAt: null, closesAt: CLOSES };
    expect(deriveFormSubmissionWindowState(window, "2026-07-01T16:59:59.999Z")).toBe("open");
    // The closing instant is outside it, so one window can close exactly where
    // the next opens without an instant belonging to both.
    expect(deriveFormSubmissionWindowState(window, CLOSES)).toBe("closed");
    expect(deriveFormSubmissionWindowState(window, "2026-07-01T17:00:00.001Z")).toBe("closed");
  });

  it("reads closed rather than scheduled when a window is closed before it opens", () => {
    // Data the contract refuses can still reach a read through a repair or an
    // import; a form nobody can answer must not read as one about to open.
    expect(deriveFormSubmissionWindowState({ opensAt: CLOSES, closesAt: OPENS }, OPENS)).toBe("closed");
  });

  it("answers the submit question as one word", () => {
    expect(isFormSubmissionWindowOpen({ opensAt: OPENS, closesAt: CLOSES }, "2026-06-15T00:00:00.000Z")).toBe(true);
    expect(isFormSubmissionWindowOpen({ opensAt: OPENS, closesAt: CLOSES }, "2026-08-15T00:00:00.000Z")).toBe(false);
  });
});

describe("form submission window refusal", () => {
  it("says nothing when the window is open", () => {
    expect(() =>
      requireOpenFormSubmissionWindow({ opensAt: OPENS, closesAt: CLOSES }, "2026-06-15T00:00:00.000Z"),
    ).not.toThrow();
  });

  it("names the day a form opens", () => {
    expect(() =>
      requireOpenFormSubmissionWindow({ opensAt: OPENS, closesAt: CLOSES }, "2026-05-01T00:00:00.000Z"),
    ).toThrowError(expect.objectContaining({ status: 409, code: "FORM_NOT_OPEN_YET" }));
  });

  it("names the day a form closed, and repeats the window for a viewer's own clock", () => {
    let caught: unknown;
    try {
      requireOpenFormSubmissionWindow({ opensAt: OPENS, closesAt: CLOSES }, "2026-08-01T00:00:00.000Z");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 409,
      code: "FORM_CLOSED",
      // The service states the instant in UTC; localizing it belongs to the
      // presentation boundary, which reads the window back out of `details`.
      message: `This form closed on ${CLOSES}`,
      details: { state: "closed", opensAt: OPENS, closesAt: CLOSES },
    });
  });
});

describe("form submission window contract", () => {
  const base = { contextType: "group", contextRef: "a-group", audience: "Members", active: true } as const;

  it("accepts an absent window, an open end, and an ordered pair", () => {
    expect(formPlacementCreateSchema.safeParse({ ...base }).success).toBe(true);
    expect(formPlacementCreateSchema.safeParse({ ...base, opensAt: OPENS, closesAt: null }).success).toBe(true);
    expect(formPlacementCreateSchema.safeParse({ ...base, opensAt: OPENS, closesAt: CLOSES }).success).toBe(true);
  });

  it("refuses a window that closes before it opens, on the closing field", () => {
    const refused = formPlacementCreateSchema.safeParse({ ...base, opensAt: CLOSES, closesAt: OPENS });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues).toContainEqual(
      expect.objectContaining({ path: ["closesAt"], message: "Closing time must be after opening time" }),
    );
  });

  it("refuses a window with no duration at all", () => {
    expect(formPlacementCreateSchema.safeParse({ ...base, opensAt: OPENS, closesAt: OPENS }).success).toBe(false);
  });

  it("refuses the same order on the update contracts a settings form parses", () => {
    // The editor sends a partial policy patch, so the same rule has to hold
    // there rather than only on creation.
    expect(formPlacementPolicyUpdateSchema.safeParse({ opensAt: CLOSES, closesAt: OPENS }).success).toBe(false);
    expect(groupFormPlacementUpdateSchema.safeParse({ opensAt: CLOSES, closesAt: OPENS }).success).toBe(false);
    expect(groupFormPlacementUpdateSchema.safeParse({ opensAt: OPENS, closesAt: CLOSES }).success).toBe(true);
  });

  it("refuses an instant that is not UTC with millisecond precision", () => {
    // A `datetime-local` value that never reached the codec must not be stored
    // as though it were an instant.
    expect(groupFormPlacementUpdateSchema.safeParse({ opensAt: "2026-06-01T09:00" }).success).toBe(false);
    expect(groupFormPlacementUpdateSchema.safeParse({ opensAt: "2026-06-01T09:00:00+02:00" }).success).toBe(false);
  });
});
