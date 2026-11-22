import { describe, expect, it } from "vitest";
import { jobTitleSchema, jobTitleTextSchema } from "../assets/shared/schemas/api-common";
import { organizationIdentityJobTitleSchema } from "../assets/shared/schemas/identity-job-title";
import { identityProfileUpdateSchema } from "../assets/shared/schemas/own-identity-profile";

const message = (value: string) => jobTitleSchema.safeParse(value).error?.issues[0]?.message;

describe("a job title", () => {
  it.each([
    "CTO",
    "Head of PKI (EMEA)",
    "Senior Engineer, R&D",
    "C++ Developer",
    "ISO 27001 Lead Auditor",
    "Directeur Général",
    "Geschäftsführer",
    "Jefe de Ingeniería, Søren's team",
    "Ingénieure sécurité – IAM",
    "Vice President / Product",
    "Ph.D. Researcher",
    "主任工程师",
  ])("accepts %s", (title) => {
    expect(jobTitleSchema.parse(` ${title} `)).toBe(title);
  });

  it.each([
    ["CEO at acme.com", "Enter only your job title, without web addresses or phone numbers."],
    ["CEO https://acme.example", "Enter only your job title, without web addresses or phone numbers."],
    ["Sales www.acme", "Enter only your job title, without web addresses or phone numbers."],
    ["Sales lead, call +31 20 123 4567", "Enter only your job title, without web addresses or phone numbers."],
    ["Sales lead 0201234567", "Enter only your job title, without web addresses or phone numbers."],
    ["Sales lead sales@acme.example", "Use only letters, numbers and simple punctuation in your job title."],
    ["Best PKI deals!", "Use only letters, numbers and simple punctuation in your job title."],
    ["CEO 🚀", "Use only letters, numbers and simple punctuation in your job title."],
    ["CEO\nBuy now", "Use only letters, numbers and simple punctuation in your job title."],
    ["Save 50% today", "Use only letters, numbers and simple punctuation in your job title."],
    ["A".repeat(101), "Keep your job title to 100 characters or fewer."],
  ])("refuses %j", (title, expected) => {
    expect(message(title)).toBe(expected);
  });

  it.each([
    ["one long word", "a".repeat(100_000)],
    ["a long domain-like run", `${"a-".repeat(50_000)}.`],
    ["a long run of digits", "1 ".repeat(50_000)],
  ])("refuses an overlong title (%s) quickly, at the length rule", (_shape, title) => {
    const started = performance.now();
    expect(message(title)).toBe("Keep your job title to 100 characters or fewer.");
    expect(jobTitleSchema.safeParse(title).error?.issues).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("finds a web address in linear time within the length limit", () => {
    const started = performance.now();
    for (let index = 0; index < 1_000; index += 1) jobTitleTextSchema.safeParse("a".repeat(100));
    expect(performance.now() - started).toBeLessThan(250);
    expect(message("Lead at sub.acme.example")).toBe(
      "Enter only your job title, without web addresses or phone numbers.",
    );
  });

  it("holds every place a title is written to the same rule, while an edit may still clear it", () => {
    expect(organizationIdentityJobTitleSchema).toBe(jobTitleSchema);
    expect(jobTitleTextSchema.parse("")).toBe("");
    expect(identityProfileUpdateSchema.safeParse({ jobTitle: "CEO at acme.com" }).success).toBe(false);
    expect(identityProfileUpdateSchema.parse({ jobTitle: "" })).toEqual({ jobTitle: "" });
  });
});
