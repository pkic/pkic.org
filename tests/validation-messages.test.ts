import { describe, expect, it } from "vitest";
import { z } from "zod";
import { termKeySchema, termVersionSchema, trimmedString } from "../assets/shared/schemas/api-common";

const message = (schema: z.ZodType, value: unknown) => schema.safeParse(value).error?.issues[0]?.message;

describe("plain-language contract messages", () => {
  it.each([
    ["an empty required text", trimmedString(1, 80), "", "This field is required."],
    ["too short a text", trimmedString(3, 80), "ab", "Enter at least 3 characters."],
    ["too long a text", trimmedString(1, 3), "abcd", "Use at most 3 characters."],
    ["a missing value", z.object({ name: z.string() }), {}, "This field is required."],
    ["an invalid email", z.email(), "nobody", "Enter a valid email address."],
    ["a value outside the options", z.enum(["a", "b"]), "c", "Choose one of the options."],
    ["a pattern mismatch", z.string().regex(/^[a-z]+$/), "A1", "Use only the characters this field allows."],
    ["a number below an inclusive minimum", z.number().min(1), 0, "Enter 1 or more."],
    ["a number not above an exclusive minimum", z.number().positive(), 0, "Enter more than 0."],
    ["a number above an inclusive maximum", z.number().max(10), 11, "Enter 10 or less."],
    ["a number not below an exclusive maximum", z.number().lt(10), 10, "Enter less than 10."],
  ])("explains %s in words, not schema terms", (_case, schema, value, expected) => {
    expect(message(schema, value)).toBe(expected);
  });

  it("keeps a message written on the schema", () => {
    expect(message(trimmedString(1, 80, "Give the role a name."), "")).toBe("Give the role a name.");
    expect(message(termKeySchema, "Code of Conduct")).toMatch(/^Use 2 to 128 lowercase letters/);
  });
});

describe("term version guidance", () => {
  it.each(["-v1", "v 1", "", "v".repeat(65)])("explains the allowed format for %s", (value) => {
    expect(message(termVersionSchema, value)).toBe(
      "Use 1 to 64 letters, numbers, dots, hyphens or underscores, starting with a letter or number, such as v1.",
    );
  });

  it.each(["v1", "2026-11-03", "Release_1.0", "v".repeat(64)])("accepts %s", (value) => {
    expect(termVersionSchema.parse(` ${value} `)).toBe(value);
  });
});
