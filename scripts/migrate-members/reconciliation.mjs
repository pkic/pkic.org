/**
 * Domain/name-based reconciliation: pairing YAML organizations/
 * representatives with roster CSV emails. No SQL, no filesystem I/O beyond
 * what parsers.mjs already loaded into plain data.
 */

export function normalizeOrgName(name) {
  // Matches functions/_lib/services/sponsorship.ts's normalizeOrgName —
  // this is the same upsert key convention (organizations.normalized_name).
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emailDomain(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

// `.invalid` is reserved by RFC 2606 as never resolvable/deliverable —
// matches the sentinel-email convention `user-merge.ts`'s `mergeUsers`
// already established for anonymized accounts (`merged-<id>@deleted.invalid`).
// Deterministic (keyed on the YAML slug, not a random id) so re-running the
// migration upserts the same placeholder row instead of creating a new one
// each time.
export function sentinelEmailForSlug(slug) {
  return `unmatched-${slug}@members.invalid`;
}

function emailLocalAlnum(email) {
  const at = String(email).lastIndexOf("@");
  const local = at === -1 ? String(email) : String(email).slice(0, at);
  return local
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Short tokens (van, der, von, de, la, ...) are dropped before name/email
// matching — they're common enough across unrelated candidates in the same
// org that counting them as a match produces false positives more often
// than real signal.
const NAME_MATCH_MIN_TOKEN_LENGTH = 4;

function nameTokens(fullName) {
  return String(fullName)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= NAME_MATCH_MIN_TOKEN_LENGTH);
}

/**
 * Pairs YAML `representatives[]` entries with domain-matched roster emails
 * by name, instead of blindly zipping listed order against join-date order
 * (which silently attaches one representative's bio/role to a different
 * person's email whenever the YAML list order and the roster join order
 * don't happen to match).
 *
 * Each representative's name tokens are checked as substrings of each
 * candidate email's local part; confident matches (score > 0) are assigned
 * greedily, highest-scoring first. Anything a name match can't resolve
 * falls back to the original join-order positional pairing, same
 * "best effort, flagged for staff confirmation" behavior as before this
 * matched on names at all.
 *
 * Returns an array parallel to `reps`: the matched candidate's index into
 * `candidates`, or null if every candidate is already claimed.
 */
export function matchRepsToCandidates(reps, candidates) {
  const repTokens = reps.map((r) => nameTokens(r.name));
  const candidateLocals = candidates.map((c) => emailLocalAlnum(c.email));

  const scored = [];
  for (let ri = 0; ri < reps.length; ri += 1) {
    for (let ci = 0; ci < candidates.length; ci += 1) {
      const score = repTokens[ri].reduce((n, token) => n + (candidateLocals[ci].includes(token) ? 1 : 0), 0);
      if (score > 0) scored.push({ ri, ci, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const assignment = new Array(reps.length).fill(null);
  const usedCandidates = new Set();
  for (const { ri, ci } of scored) {
    if (assignment[ri] !== null || usedCandidates.has(ci)) continue;
    assignment[ri] = ci;
    usedCandidates.add(ci);
  }

  let nextCandidate = 0;
  for (let ri = 0; ri < reps.length; ri += 1) {
    if (assignment[ri] !== null) continue;
    while (nextCandidate < candidates.length && usedCandidates.has(nextCandidate)) nextCandidate += 1;
    if (nextCandidate >= candidates.length) continue;
    assignment[ri] = nextCandidate;
    usedCandidates.add(nextCandidate);
    nextCandidate += 1;
  }

  return assignment;
}

export function buildEmailsByDomain(pkicRoster) {
  const byDomain = new Map();
  for (const [email, meta] of pkicRoster.entries()) {
    const domain = emailDomain(email);
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push({ email, joinSortKey: meta.joinSortKey });
    byDomain.set(domain, list);
  }
  for (const list of byDomain.values()) {
    list.sort((a, b) => a.joinSortKey.localeCompare(b.joinSortKey));
  }
  return byDomain;
}

export function candidateEmailsForDomains(domains, emailsByDomain) {
  const seen = new Set();
  const candidates = [];
  for (const domain of domains) {
    const list = emailsByDomain.get(String(domain).trim().toLowerCase()) ?? [];
    for (const entry of list) {
      if (seen.has(entry.email)) continue;
      seen.add(entry.email);
      candidates.push(entry);
    }
  }
  candidates.sort((a, b) => a.joinSortKey.localeCompare(b.joinSortKey));
  return candidates;
}
