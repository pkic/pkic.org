import { describe, expect, it } from "vitest";
import { proposalSessionTypeSchema } from "../assets/shared/schemas/proposal-management";
import { proposalSessionTypeLabel, sessionTypeName } from "../assets/shared/proposal-session-types";
import { agendaSessionFormatOptions, configuredAgendaSessionFormat } from "../assets/shared/event-agenda-format";

describe("event-defined session type names", () => {
  it("changes the display name without changing the saved CFP and agenda identifier", () => {
    const type = proposalSessionTypeSchema.parse({
      label: "talk",
      name: "Technical presentation",
      requiresPresentation: true,
    });
    expect(proposalSessionTypeLabel("talk", [type])).toBe("Technical presentation");
    expect(agendaSessionFormatOptions([type])).toEqual([{ id: "talk", label: "Technical presentation" }]);
    expect(configuredAgendaSessionFormat([type.label], "TALK")).toBe("talk");
  });
  it("keeps legacy and retired types readable without a hardcoded vocabulary", () => {
    const legacy = proposalSessionTypeSchema.parse({ label: "lightning_talk", requiresPresentation: true });
    expect(sessionTypeName(legacy)).toBe("Lightning talk");
    expect(proposalSessionTypeLabel("custom_technical_demo")).toBe("Custom technical demo");
    expect(agendaSessionFormatOptions(["lightning_talk"])).toEqual([{ id: "lightning_talk", label: "Lightning talk" }]);
  });
  it("rejects empty and oversized configured display names", () => {
    const type = { label: "talk", requiresPresentation: true };
    expect(proposalSessionTypeSchema.safeParse({ ...type, name: " " }).success).toBe(false);
    expect(proposalSessionTypeSchema.safeParse({ ...type, name: "x".repeat(101) }).success).toBe(false);
  });
});
