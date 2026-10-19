// @vitest-environment jsdom
/**
 * Attendance across a person's current groups as one bar: the whole stated
 * once, each group named only when pointed at (and to a screen reader).
 */
import { render } from "preact";
import { describe, expect, it } from "vitest";

import type { UserGroupParticipation } from "../../assets/shared/schemas/user-participation";
import { GroupAttendanceBar } from "../../assets/ts/member-flows/portal/sections/system-users/GroupAttendanceBar";

function seat(name: string, attended: number, held: number, leftAt: string | null = null): UserGroupParticipation {
  return {
    group: {
      id: `group-${name}`,
      slug: name.toLowerCase(),
      name,
      type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
    },
    identityId: "identity-1",
    title: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    leftAt,
    attended,
    held,
    lastAttendedAt: null,
  };
}

function mount(seats: UserGroupParticipation[]): HTMLElement {
  const container = document.createElement("div");
  render(<GroupAttendanceBar seats={seats} />, container);
  return container;
}

describe("GroupAttendanceBar", () => {
  it("states the whole once and names each current group only in its tooltip", () => {
    const container = mount([
      seat("PQC", 11, 12),
      seat("Code Signing", 9, 16),
      seat("Old", 3, 3, "2025-01-01T00:00:00.000Z"),
    ]);

    expect(container.querySelector("p:not(.pk-sr-only)")?.textContent).toBe("20 of 28 meetings attended");
    const parts = [...container.querySelectorAll("rect")];
    expect(parts.map((part) => part.querySelector("title")?.textContent)).toEqual([
      "PQC: 11 of 12",
      "Code Signing: 9 of 16",
    ]);
    expect(parts.map((part) => part.getAttribute("width"))).toEqual(["11", "9"]);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 28 1");
    expect([...container.querySelectorAll("ul.pk-sr-only li")].map((item) => item.textContent)).toEqual([
      "PQC: 11 of 12",
      "Code Signing: 9 of 16",
    ]);
  });

  it("renders nothing until a current group has met", () => {
    expect(mount([seat("New", 0, 0), seat("Old", 2, 4, "2025-01-01T00:00:00.000Z")]).innerHTML).toBe("");
  });
});
