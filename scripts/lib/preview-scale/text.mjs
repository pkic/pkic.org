import { pick } from "./random.mjs";

/**
 * Session titles, abstracts and speaker biographies that read like a PKI and
 * post-quantum conference program. They are combined from short hand-written
 * fragments, never copied from a real submission, and deliberately vary in
 * length and punctuation (colons, quotes, slashes, ampersands, en dashes,
 * question marks) so screens meet the same edge cases production data has.
 */

const SUBJECTS = [
  "ML-KEM", "ML-DSA", "SLH-DSA", "FN-DSA", "hybrid TLS", "composite certificates", "X.509", "OCSP stapling",
  "CRLite", "certificate transparency", "ACME", "short-lived certificates", "S/MIME", "code signing", "HSMs",
  "firmware signing", "eIDAS 2.0", "qualified trust services", "the EUDI wallet", "CNSA 2.0", "FIPS 140-3",
  "crypto-agility", "cryptographic inventories", "CBOMs", "Kyber", "Dilithium", "SPHINCS+", "LMS/XMSS",
  "quantum key distribution", "IoT device identity", "Matter certificates", "smart cards", "PIV credentials",
  "DNSSEC", "SSH certificates", "private PKI", "root store policy", "the CA/Browser Forum", "Web PKI",
  "IKEv2 & IPsec", "5G SIM provisioning", "automotive V2X", "payment HSMs", "EMV", "post-quantum VPNs",
];

const SHORT_TITLES = [
  "PQC now", "Q-Day?", "Keynote", "Hello, ML-KEM", "Ask the CAs", "Roots matter", "The 47-day certificate",
  "Inventory first", "Harvest now, decrypt later", "No more RSA", "Lightning talks", "Crypto-agility, really",
];

const OPENINGS = [
  "Lessons from", "Inside", "Scaling", "Testing", "Rethinking", "A field guide to", "Automating", "Measuring",
  "Planning for", "Securing", "Migrating", "Breaking", "Shipping", "Operating", "Auditing", "Deprecating",
  "What we learned deploying", "Ten myths about", "The hidden cost of", "Why we stopped waiting for",
];

const CONTEXTS = [
  "at a national bank", "across 40,000 endpoints", "in a regulated hospital network", "on constrained devices",
  "in the public sector", "for 1.2 billion devices", "in hardware", "at internet scale", "in the browser",
  "without downtime", "on a budget", "before the deadline", "in a multi-cloud estate", "for a European eID",
  "in the car", "at the edge",
];

const SUBTITLES = [
  "a practitioner's view", "what nobody tells you", "results from a two-year pilot", "a case study",
  "the good, the bad & the ugly", "panel discussion", "from inventory to roll-out", "open questions",
  "what changes in 2027", "lessons for CAs, vendors and relying parties", "beyond the hype",
  "standards, timelines and the reality on the ground", "live demo",
];

const LONG_TAILS = [
  " (and what we would do differently next time, now that {subject} is in scope too)",
  ", with a look at {subject}, procurement, audits, and the people who have to sign off on all of it",
  " — part 2",
  " [updated after the 2026 pilot]",
  ", or: how I learned to stop worrying and love {subject}",
];

/** A session title between two words and the 300-character limit, in several shapes. */
export function inventTitle(random) {
  const roll = random();
  const subject = pick(random, SUBJECTS);
  if (roll < 0.08) return pick(random, SHORT_TITLES);
  if (roll < 0.35) return `${pick(random, OPENINGS)} ${subject}`;
  if (roll < 0.6) return `${pick(random, OPENINGS)} ${subject} ${pick(random, CONTEXTS)}`;
  if (roll < 0.75) return `${subject}: ${pick(random, SUBTITLES)}`;
  if (roll < 0.85) return `“${pick(random, SHORT_TITLES)}” – ${pick(random, OPENINGS).toLowerCase()} ${subject}`;
  if (roll < 0.93) return `${subject} vs. ${pick(random, SUBJECTS)}: which one, when, and why?`;
  return `${pick(random, OPENINGS)} ${subject} and ${pick(random, SUBJECTS)} ${pick(random, CONTEXTS)}: ${pick(random, SUBTITLES)}${pick(random, LONG_TAILS).replace("{subject}", pick(random, SUBJECTS))}`;
}

const ABSTRACT_PARAGRAPHS = [
  "Most organizations still cannot say where their cryptography lives. This talk walks through how we built an inventory of keys, certificates and algorithms across a heterogeneous estate, which tools helped, and where we had to fall back on spreadsheets and interviews.",
  "Hybrid key exchange is now on by default in major browsers, but the long tail of middleboxes, load balancers and embedded TLS stacks is another story. We share handshake failure data, the fixes we shipped, and the vendors still on our watch list.",
  "Post-quantum signatures are large. We measured the impact of larger certificate chains on constrained networks and show which combinations of intermediates, compression and caching keep handshakes within a single round trip.",
  "Regulators have published migration timelines, but few of them agree. We compare the guidance, map it to a realistic budget cycle, and propose a sequence that keeps auditors and engineers on the same page.",
  "Code signing keys outlive the software they sign. This session covers how to plan a post-quantum transition for firmware and update channels when devices stay in the field for fifteen years or more.",
  "Shorter certificate lifetimes push every team toward automation. We describe the operational changes, the outages we avoided, and the ones we did not.",
  "An HSM is only as agile as its firmware and its vendor's roadmap. We review what to ask for in procurement today so that tomorrow's algorithms are a configuration change rather than a forklift upgrade.",
  "The panel brings together a certification authority, a browser root program and an enterprise relying party to debate what “ready” means, and who has to move first.",
  "A hands-on look at the new standards: parameter sets, key and signature sizes, performance on commodity hardware, and the pitfalls we hit when integrating them into existing libraries.",
  "Identity wallets change who issues credentials and who relies on them. We explain how trust lists, qualified certificates and selective disclosure fit together, and where PKI expertise is still missing.",
  "We ran a red-team exercise against our own migration plan. This talk shares the scenarios, what broke, and the controls we added afterwards.",
  "Q&A with the audience.",
];

/** An abstract of one to three paragraphs; a few sessions have none at all. */
export function inventAbstract(random, kind) {
  if (kind === "break") return "";
  const roll = random();
  if (roll < 0.05) return "";
  const count = roll < 0.4 ? 1 : roll < 0.85 ? 2 : 3;
  const paragraphs = new Set();
  while (paragraphs.size < count) paragraphs.add(pick(random, ABSTRACT_PARAGRAPHS));
  return [...paragraphs].join("\n\n");
}

const BIOGRAPHY_SENTENCES = [
  "{name} has worked on public key infrastructure for more than fifteen years.",
  "{name} leads the cryptography team at {organization}.",
  "Before joining {organization}, {name} spent a decade building certificate lifecycle tooling.",
  "{name} contributes to IETF and ETSI working groups on post-quantum migration.",
  "{name} is a frequent speaker on crypto-agility and the operational side of PKI.",
  "{name} holds a PhD in applied cryptography.",
  "At {organization}, {name} is responsible for HSM operations, key ceremonies and audit readiness.",
  "{name} co-authored several open-source libraries used in TLS and code signing.",
  "Outside work, {name} enjoys cycling, chess and terrible puns about quantum states.",
];

/** A biography from a few sentences; some speakers write a single line, a few none. */
export function inventBiography(random, person) {
  const roll = random();
  if (roll < 0.05) return "";
  const count = roll < 0.3 ? 1 : roll < 0.8 ? 3 : 5;
  const organization = person.organizationIdentity?.organizationName;
  const usable = BIOGRAPHY_SENTENCES.filter((sentence) => organization || !sentence.includes("{organization}"));
  const sentences = new Set();
  while (sentences.size < Math.min(count, usable.length)) sentences.add(pick(random, usable));
  const [first, ...rest] = [...sentences];
  return [first.replaceAll("{name}", `${person.firstName} ${person.lastName}`), ...rest]
    .join(" ")
    .replaceAll("{name}", person.firstName)
    .replaceAll("{organization}", organization);
}
