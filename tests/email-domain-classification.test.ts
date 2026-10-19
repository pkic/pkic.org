import { describe, expect, it } from "vitest";
import {
  mailboxKind,
  isDisposableDomain,
  isFreeMailDomain,
  organizationDomainCandidates,
  registrableDomain,
  workEmailDomain,
} from "../functions/_lib/email-domains/classification";
import { DISPOSABLE_EMAIL_DOMAINS } from "../functions/_lib/email-domains/generated/disposable-email-domains";
import { FREE_EMAIL_DOMAINS } from "../functions/_lib/email-domains/generated/free-email-domains";
import provenance from "../functions/_lib/email-domains/generated/provenance.json";
import { PUBLIC_SUFFIX_RULES } from "../functions/_lib/email-domains/generated/public-suffix-rules";
import { EMAIL_DOMAIN_OVERRIDES } from "../functions/_lib/email-domains/overrides";
import { parsePublicSuffixRules, ruleAncestors, spansRegistrants } from "../functions/_lib/email-domains/public-suffix";

const rules = parsePublicSuffixRules(PUBLIC_SUFFIX_RULES.split("\n"));
const ancestors = ruleAncestors(rules);

describe("the registrable domain an address speaks for", () => {
  it.each([
    ["alice@mail.ibm.com", "ibm.com"],
    ["alice@us.mail.ibm.com", "ibm.com"],
    ["bob@shop.example.co.uk", "example.co.uk"],
    ["example.co.uk", "example.co.uk"],
    ["@Example.COM.", "example.com"],
    // The private section counts: a github.io site is its owner's own domain.
    ["owner.github.io", "owner.github.io"],
    ["docs.owner.github.io", "owner.github.io"],
    // Wildcard `*.kawasaki.jp` with the exception `!city.kawasaki.jp`.
    ["a.b.kawasaki.jp", "a.b.kawasaki.jp"],
    ["mail.city.kawasaki.jp", "city.kawasaki.jp"],
    // An international name resolves in punycode.
    ["info@mail.bücher.de", "xn--bcher-kva.de"],
    // A top-level domain the list does not know is still one.
    ["dee@acme-pki.example", "acme-pki.example"],
  ])("%s → %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each(["co.uk", "github.io", "b.kawasaki.jp", "com", "person@192.168.0.1", "not a domain", ""])(
    "has none for %s",
    (input) => {
      expect(registrableDomain(input)).toBeNull();
    },
  );
});

describe("free, ISP and disposable mail", () => {
  it.each([
    "ziggo.nl",
    "kpnmail.nl",
    "xs4all.nl",
    "planet.nl",
    "orange.fr",
    "t-online.de",
    "telenet.be",
    "shaw.ca",
    "gmail.com",
    // Local additions the upstream list misses.
    "hey.com",
    "sympatico.ca",
  ])("treats %s as free mail", (domain) => {
    expect(isFreeMailDomain(`person@${domain}`)).toBe(true);
    expect(mailboxKind(domain)).toBe("free");
    expect(workEmailDomain(`person@${domain}`)).toBeNull();
  });

  it("treats a host below a free provider as that provider", () => {
    expect(mailboxKind("person@mail.yahoo.co.uk")).toBe("free");
    expect(organizationDomainCandidates("person@mail.yahoo.co.uk")).toEqual([]);
  });

  it("refuses disposable providers, below them too, and never calls them free", () => {
    for (const email of ["a@mailinator.com", "a@inbox.mailinator.com", "a@tempmail.com"]) {
      expect(isDisposableDomain(email)).toBe(true);
      expect(isFreeMailDomain(email)).toBe(false);
      expect(mailboxKind(email)).toBe("disposable");
    }
  });

  it("keeps an organization's own domain a work domain, including a local removal", () => {
    expect(mailboxKind("alice@mail.ibm.com")).toBe("work");
    expect(mailboxKind("student@nus.edu.sg")).toBe("work");
    // A listed name does not reach a different registrant: `za.com` is a public suffix.
    expect(mailboxKind("info@company.za.com")).toBe("work");
  });
});

describe("the domains a claim can hold for an address", () => {
  it("runs from the host down to the registrable domain", () => {
    expect(organizationDomainCandidates("a@x.mail.ibm.com")).toEqual(["x.mail.ibm.com", "mail.ibm.com", "ibm.com"]);
    expect(organizationDomainCandidates("a@shop.example.co.uk")).toEqual(["shop.example.co.uk", "example.co.uk"]);
    expect(organizationDomainCandidates("a@ibm.com")).toEqual(["ibm.com"]);
    expect(organizationDomainCandidates("a@gmail.com")).toEqual([]);
  });
});

describe("the vendored lists", () => {
  const free = FREE_EMAIL_DOMAINS.split("\n");
  const disposable = DISPOSABLE_EMAIL_DOMAINS.split("\n");

  it("never list a public suffix or a parent of one, so a parent match stays within one registrant", () => {
    const overrides = [...EMAIL_DOMAIN_OVERRIDES.free.add, ...EMAIL_DOMAIN_OVERRIDES.disposable.add];
    expect(
      [...free, ...disposable, ...overrides].filter((domain) => spansRegistrants(domain, rules, ancestors)),
    ).toEqual([]);
  });

  it("keep disposable providers off the free list", () => {
    const disposableSet = new Set(disposable);
    expect(free.filter((domain) => disposableSet.has(domain))).toEqual([]);
  });

  it("match the counts their provenance records", () => {
    expect(free).toHaveLength(provenance.free.entries);
    expect(disposable).toHaveLength(provenance.disposable.entries);
    expect(PUBLIC_SUFFIX_RULES.split("\n")).toHaveLength(provenance.publicSuffix.rules);
  });

  it("carry only overrides that still change something", () => {
    const freeSet = new Set(free);
    const disposableSet = new Set(disposable);
    expect(EMAIL_DOMAIN_OVERRIDES.free.add.filter((domain) => freeSet.has(domain))).toEqual([]);
    expect(EMAIL_DOMAIN_OVERRIDES.free.remove.filter((domain) => !freeSet.has(domain))).toEqual([]);
    expect(EMAIL_DOMAIN_OVERRIDES.disposable.add.filter((domain) => disposableSet.has(domain))).toEqual([]);
    expect(EMAIL_DOMAIN_OVERRIDES.disposable.remove.filter((domain) => !disposableSet.has(domain))).toEqual([]);
  });
});
