import { describe, expect, it } from "vitest";
import {
  buildEmailDomainLists,
  parseDomainLines,
  parsePublicSuffixList,
  renderDomainDataModule,
} from "../../scripts/lib/email-domain-lists.mjs";

const PUBLIC_SUFFIX_TEXT = `// ===BEGIN ICANN DOMAINS===
uk
co.uk
// a comment
*.ck
!www.ck
公司.cn
// ===END ICANN DOMAINS===
// ===BEGIN PRIVATE DOMAINS===
za.com
dyndns.example
// ===END PRIVATE DOMAINS===
`;

const NO_MINIMUMS = { free: 0, disposable: 0, publicSuffixRules: 0 };

describe("refreshing the email-domain lists", () => {
  it("reads both Public Suffix List sections, in punycode, with wildcard and exception rules", () => {
    expect(parsePublicSuffixList(PUBLIC_SUFFIX_TEXT)).toEqual({
      rules: ["!www.ck", "*.ck", "co.uk", "dyndns.example", "uk", "xn--55qx5d.cn", "za.com"],
      counts: { icann: 5, private: 2 },
    });
  });

  it("refuses a Public Suffix List that lost a section", () => {
    expect(() => parsePublicSuffixList("// ===BEGIN ICANN DOMAINS===\ncom\n")).toThrow(/lost a section/);
  });

  it("normalizes, drops disposable mail from the free list, and drops entries that span registrants", () => {
    const lists = buildEmailDomainLists({
      freeEntries: ["Gmail.com", "ziggo.nl", "mailinator.com", "za.com", "co.uk", "not a domain"],
      disposableEntries: parseDomainLines("# comment\nmailinator.com\nyopmail.com\n"),
      publicSuffixText: PUBLIC_SUFFIX_TEXT,
      minimums: NO_MINIMUMS,
    });
    expect(lists.free.domains).toEqual(["gmail.com", "ziggo.nl"]);
    expect(lists.free.dropped).toEqual(["co.uk", "za.com"]);
    expect(lists.free.invalid).toEqual(["not a domain"]);
    expect(lists.disposable.domains).toEqual(["mailinator.com", "yopmail.com"]);
  });

  it("refuses a list that shrank below its expected size", () => {
    expect(() =>
      buildEmailDomainLists({
        freeEntries: ["gmail.com"],
        disposableEntries: ["mailinator.com"],
        publicSuffixText: PUBLIC_SUFFIX_TEXT,
      }),
    ).toThrow(/expected at least/);
  });

  it("renders one string constant the Worker splits on first use", () => {
    const module = renderDomainDataModule({
      constName: "EXAMPLE",
      summary: "Example.",
      entries: ["a.example", "b.example"],
      source: { repository: "owner/repo", commit: "abc", license: "MIT" },
    });
    expect(module).toContain('export const EXAMPLE =\n  "a.example\\nb.example";\n');
    expect(module).toContain("License: MIT.");
  });
});
