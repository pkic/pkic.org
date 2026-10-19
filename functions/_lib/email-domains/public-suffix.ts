/**
 * The Public Suffix List algorithm (https://publicsuffix.org/list/), over the
 * rules vendored in `generated/public-suffix-rules.ts`.
 *
 * Both the ICANN and the private sections apply: a host below `github.io` or
 * `blogspot.com` is someone's own site, exactly as one below `co.uk` is. Rules
 * are ASCII (IDN labels are stored in punycode), so a host is converted with
 * {@link asciiHost} before it is looked up.
 *
 * This module has no imports so the refresh script can run it under Node's
 * type stripping to validate a downloaded list before writing it.
 */

export interface PublicSuffixRules {
  /** Plain rules such as `co.uk`. */
  readonly exact: ReadonlySet<string>;
  /** The base of each wildcard rule: `*.ck` is stored as `ck`. */
  readonly wildcard: ReadonlySet<string>;
  /** Each exception rule without its `!`: `!www.ck` is stored as `www.ck`. */
  readonly exception: ReadonlySet<string>;
}

/** Parses one ASCII rule per entry, as the refresh script writes them. */
export function parsePublicSuffixRules(rules: Iterable<string>): PublicSuffixRules {
  const exact = new Set<string>();
  const wildcard = new Set<string>();
  const exception = new Set<string>();
  for (const raw of rules) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule.startsWith("!")) exception.add(rule.slice(1));
    else if (rule.startsWith("*.")) wildcard.add(rule.slice(2));
    else exact.add(rule);
  }
  return { exact, wildcard, exception };
}

const ASCII_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The lower-case ASCII form of a host name, or null when it is not one.
 * International names are converted to punycode through the WHATWG URL
 * parser, which both the Worker and Node provide.
 */
export function asciiHost(value: string): string | null {
  let host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (/[^a-z0-9.-]/.test(host)) {
    try {
      host = new URL(`http://${host}`).hostname;
    } catch {
      return null;
    }
  }
  // A top-level label always has a letter, which also keeps IPv4 addresses out.
  return ASCII_HOST.test(host) && /[a-z][^.]*$/.test(host) ? host : null;
}

/** The public suffix of an ASCII host: the longest matching rule, an exception rule prevailing. */
export function publicSuffixOf(host: string, rules: PublicSuffixRules): string {
  const labels = host.split(".");
  for (let start = 0; start < labels.length; start += 1) {
    const suffix = labels.slice(start).join(".");
    if (rules.exception.has(suffix)) return labels.slice(start + 1).join(".");
  }
  for (let start = 0; start < labels.length; start += 1) {
    const suffix = labels.slice(start).join(".");
    if (rules.exact.has(suffix)) return suffix;
    if (start + 1 < labels.length && rules.wildcard.has(labels.slice(start + 1).join("."))) return suffix;
  }
  // The default rule `*`: an unlisted top-level domain is itself a public suffix.
  return labels[labels.length - 1]!;
}

/** The public suffix plus one label (`mail.ibm.com` → `ibm.com`); null for a public suffix itself. */
export function registrableDomainOf(host: string, rules: PublicSuffixRules): string | null {
  const suffix = publicSuffixOf(host, rules);
  if (host === suffix) return null;
  const labels = host.slice(0, host.length - suffix.length - 1).split(".");
  return `${labels[labels.length - 1]}.${suffix}`;
}

/**
 * Whether a listed mail domain could cover more than one registrant: it is a
 * public suffix itself (`za.com`), or a parent of one (`dyndns.org` above
 * `*.dyndns.org`-style rules). The lists drop such entries, so matching a
 * host's parents against a list never crosses a registrable-domain boundary.
 * `ancestors` is {@link ruleAncestors} of the same rules, computed once.
 */
export function spansRegistrants(domain: string, rules: PublicSuffixRules, ancestors: ReadonlySet<string>): boolean {
  return registrableDomainOf(domain, rules) === null || ancestors.has(domain);
}

/** Every strict parent domain of a rule (`ck` for `*.ck`, `jp` and `kawasaki.jp` for `!city.kawasaki.jp`). */
export function ruleAncestors(rules: PublicSuffixRules): Set<string> {
  const ancestors = new Set<string>();
  for (const set of [rules.exact, rules.wildcard, rules.exception])
    for (const rule of set) {
      const labels = rule.split(".");
      for (let start = 1; start < labels.length; start += 1) ancestors.add(labels.slice(start).join("."));
    }
  // A wildcard's base is itself a parent of every suffix the wildcard matches.
  for (const base of rules.wildcard) ancestors.add(base);
  return ancestors;
}
