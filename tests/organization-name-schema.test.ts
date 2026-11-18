import { describe, expect, it } from "vitest";
import { organizationNameSchema } from "../assets/shared/schemas/api-common";

describe("an organization name", () => {
  it.each(["Acme", "Société Générale", "PKI Consortium, Inc.", "株式会社サンプル", "R&D (EMEA) 2"])(
    "accepts %s",
    (name) => {
      expect(organizationNameSchema.parse(` ${name} `)).toBe(name);
    },
  );

  it("stores the composed form of a name typed with combining marks", () => {
    expect(organizationNameSchema.parse("Socie\u0301te\u0301")).toBe("Soci\u00e9t\u00e9");
  });

  it.each([
    ["a bidi override", "Acme\u202eevil"],
    ["a zero-width space", "Ac\u200bme"],
    ["a byte order mark", "Acme\ufeff Corp"],
    ["a control character", "Acme\u0007 Corp"],
    ["a line break", "Acme\nCorp"],
  ])("refuses %s", (_kind, name) => {
    expect(organizationNameSchema.safeParse(name).error?.issues[0]?.message).toBe(
      "Remove hidden or control characters from the organization name.",
    );
  });
});
