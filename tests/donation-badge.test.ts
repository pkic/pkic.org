import { describe, it, expect } from "vitest";
import { renderDonationBadgeSvg } from "../functions/_lib/services/og-badge";

describe("donation badge rendering", () => {
  it("includes the donor name and amount on the badge", () => {
    const svg = renderDonationBadgeSvg({
      firstName: "Paul",
      lastName: "van Brouwershaven",
      formattedAmount: "€100.00",
    });

    expect(svg).toContain("Paul van Brouwershaven");
    expect(svg).toContain("€100.00");
    expect(svg).not.toContain("A supporter");
  });
});