/**
 * Seeds the member-profile surface: the skill vocabulary, claims and vouches,
 * what people are open to, and the standing they have earned.
 *
 * Written so a contact record has something to show. Without it the Skills,
 * Availability and Standing panels are correctly absent, and nobody can see
 * whether the page works.
 *
 * Like the governance roster seed, this is not a schema migration: user ids
 * differ per environment, so every row resolves its person by email at run
 * time. An email with no user inserts zero rows rather than failing the run.
 * Every statement is idempotent — running it twice changes nothing the second
 * time — so it is safe to re-run after adding people.
 *
 * Vouches here are written directly rather than through the API. The rules the
 * write path enforces (nobody vouches for themselves; only someone sharing a
 * group may vouch) are respected by the data below: every voucher shares a
 * group with the person they vouch for in the seeded rosters.
 *
 * Usage:
 *   node scripts/seed-member-profiles.mjs --local
 *   node scripts/seed-member-profiles.mjs --preview
 *   node scripts/seed-member-profiles.mjs --production
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEMO_GROUPS, demoGroupSql, meetingsSql, seatSql } from "./lib/seed-demo-groups.mjs";
import { memberProfileId as stableId } from "./lib/seed-ids.mjs";
import { NOW, RANDOM_ID, sqlString } from "./lib/sql.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

const ENVS = {
  local: { wranglerFlag: "--local", wranglerEnv: "local", database: "pkic-db-local" },
  preview: { wranglerFlag: "--remote", wranglerEnv: "preview", database: "pkic-db-preview" },
  production: { wranglerFlag: "--remote", wranglerEnv: "production", database: "pkic-db" },
};

/** The e2e harness runs against a throwaway database in a temp directory. */
function persistTo(argv) {
  const index = argv.indexOf("--persist-to");
  return index >= 0 ? argv[index + 1] : null;
}

function parseEnv(argv) {
  for (const name of Object.keys(ENVS)) {
    if (argv.includes(`--${name}`)) {
      if (name === "production") {
        // This seeds a fabricated organization, invented meetings and
        // attendance, and vouches nobody actually gave. That is fine for a
        // development or preview database and is never acceptable in
        // production, where it would be indistinguishable from real record.
        throw new Error("seed-member-profiles is demo data and must not be run against production.");
      }
      return name;
    }
  }
  throw new Error("Pass one of --local, --preview");
}

/** The consortium's shared skill vocabulary. */
const SKILLS = [
  ["signature-validation", "Signature validation"],
  ["eidas-trust-services", "eIDAS / trust services"],
  ["post-quantum-migration", "Post-quantum migration"],
  ["certificate-policy", "Certificate policy"],
  ["cbom", "CBOM"],
  ["certificate-transparency", "Certificate transparency"],
  ["auditing-etsi", "Auditing (ETSI)"],
  ["key-management", "Key management"],
  ["certificate-lifecycle", "Certificate lifecycle automation"],
];

/**
 * Who claims what, and who vouched.
 *
 * Vouchers are drawn from the Executive Council roster, so each shares a group
 * with the claimant — the same rule the vouch endpoint enforces.
 */
const CLAIMS = [
  {
    // The demo record. Its vouches come from DEMO_PEER, who shares the seeded
    // group seats below — the same rule the vouch endpoint enforces.
    email: "paul.vanbrouwershaven@pkic.org",
    skills: [
      ["signature-validation", ["admin@pkic.org"]],
      ["eidas-trust-services", ["admin@pkic.org"]],
      ["post-quantum-migration", ["admin@pkic.org"]],
      ["cbom", ["admin@pkic.org"]],
      ["certificate-policy", []],
      ["certificate-transparency", []],
      ["auditing-etsi", []],
    ],
  },
  {
    email: "paul.vanbrouwershaven@digitorus.com",
    skills: [
      ["signature-validation", ["dzacharo@harica.gr", "chris@ssl.com", "tim.callan@sectigo.com"]],
      ["eidas-trust-services", ["clemens.wanko@tuv-austria.com", "mads.henriksveen@buypass.no"]],
      ["post-quantum-migration", ["tomas.gustavsson@keyfactor.com"]],
      ["cbom", ["chris.bailey@pkic.org", "dzacharo@harica.gr"]],
      ["certificate-policy", []],
    ],
  },
  {
    email: "tomas.gustavsson@keyfactor.com",
    skills: [
      ["key-management", ["paul.vanbrouwershaven@digitorus.com", "chris@ssl.com"]],
      ["certificate-lifecycle", ["tim.callan@sectigo.com"]],
      ["post-quantum-migration", []],
    ],
  },
  {
    email: "dzacharo@harica.gr",
    skills: [
      ["auditing-etsi", ["clemens.wanko@tuv-austria.com", "paul.vanbrouwershaven@digitorus.com"]],
      ["certificate-transparency", ["chris@ssl.com"]],
    ],
  },
];

/** What people are open to. `private` is seeded too, so the rule is visible. */
const AVAILABILITY = [
  {
    email: "paul.vanbrouwershaven@pkic.org",
    openToEmployment: 1,
    openToContract: 1,
    rolesSought: "Principal architect, Head of trust services, Standards lead",
    servicesOffered: "PKI design review, eIDAS conformance, Signature validation, Training",
    note: "Remote or hybrid in the EU",
    availableFrom: "2027-01-01",
    visibility: "members",
  },
  {
    email: "paul.vanbrouwershaven@digitorus.com",
    openToEmployment: 1,
    openToContract: 1,
    rolesSought: "Principal architect, Head of trust services, Standards lead",
    servicesOffered: "PKI design review, eIDAS conformance, Signature validation, Training",
    note: "Remote or hybrid in the EU",
    availableFrom: "2027-01-01",
    visibility: "members",
  },
  {
    email: "tomas.gustavsson@keyfactor.com",
    openToEmployment: 0,
    openToContract: 1,
    rolesSought: null,
    servicesOffered: "PKI design review, Key management, Training",
    note: "Engagements from 2 days",
    availableFrom: null,
    visibility: "members",
  },
  // Set, but not shared: the panel must stay absent for everyone else.
  {
    email: "dzacharo@harica.gr",
    openToEmployment: 1,
    openToContract: 0,
    rolesSought: "Audit lead",
    servicesOffered: null,
    note: null,
    availableFrom: null,
    visibility: "private",
  },
];

/**
 * Standing, as a ledger.
 *
 * Written as individual awards rather than a total, because that is what the
 * table is — and it means the seeded profile demonstrates the correction case
 * as well as the accumulation one.
 */
const AWARDS = [
  { email: "paul.vanbrouwershaven@pkic.org", reason: "group_chaired_term", points: 150, count: 8 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "document_authored", points: 60, count: 3 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "document_reviewed", points: 20, count: 9 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "meeting_attended", points: 5, count: 31 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "event_spoke", points: 40, count: 4 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "event_attended", points: 10, count: 12 },
  { email: "paul.vanbrouwershaven@pkic.org", reason: "correction", points: -35, count: 1 },

  { email: "paul.vanbrouwershaven@digitorus.com", reason: "group_chaired_term", points: 150, count: 8 },
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "document_authored", points: 60, count: 3 },
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "document_reviewed", points: 20, count: 9 },
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "meeting_attended", points: 5, count: 31 },
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "event_spoke", points: 40, count: 4 },
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "event_attended", points: 10, count: 12 },
  // A correction, so the ledger shows one being reversed rather than edited.
  { email: "paul.vanbrouwershaven@digitorus.com", reason: "correction", points: -35, count: 1 },

  { email: "tomas.gustavsson@keyfactor.com", reason: "document_authored", points: 60, count: 2 },
  { email: "tomas.gustavsson@keyfactor.com", reason: "meeting_attended", points: 5, count: 18 },
  { email: "dzacharo@harica.gr", reason: "meeting_attended", points: 5, count: 22 },
  { email: "dzacharo@harica.gr", reason: "document_reviewed", points: 20, count: 4 },
];

const RECOGNITIONS = [
  { email: "paul.vanbrouwershaven@pkic.org", key: "chair", label: "Chair" },
  { email: "paul.vanbrouwershaven@pkic.org", key: "document-editor", label: "Document editor" },
  { email: "paul.vanbrouwershaven@pkic.org", key: "founding-delegate", label: "Founding delegate" },

  { email: "paul.vanbrouwershaven@digitorus.com", key: "chair", label: "Chair" },
  { email: "paul.vanbrouwershaven@digitorus.com", key: "document-editor", label: "Document editor" },
  { email: "paul.vanbrouwershaven@digitorus.com", key: "founding-delegate", label: "Founding delegate" },
  { email: "tomas.gustavsson@keyfactor.com", key: "document-editor", label: "Document editor" },
];

/* ── The demo record ────────────────────────────────────────────────────────
 *
 * A contact record only shows what a person has: an affiliation gives it a
 * lede and a biography, group seats give it participation, and meetings that
 * actually happened give it an attendance rate. A database with users and
 * nothing else renders an almost empty page, which is what a fresh local
 * environment had before this.
 *
 * Everything below hangs off `DEMO_MEMBER`, resolved by email. It is written
 * once and re-running changes nothing.
 * ────────────────────────────────────────────────────────────────────────── */

const DEMO_MEMBER = "paul.vanbrouwershaven@pkic.org";
const DEMO_PEER = "admin@pkic.org";
const DEMO_ORG = "Digitorus";
/** Stable ids so every statement can reference the same rows idempotently. */
const ORG_ID = stableId("org-digitorus");
const MEMBER_ID = stableId("member-digitorus");
const IDENTITY_ID = stableId("identity-demo");
const PEER_IDENTITY_ID = stableId("identity-peer");
const PEER_MEMBER_ID = stableId("member-peer");

function demoOrganizationSql() {
  return [
    `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
SELECT ${sqlString(ORG_ID)}, ${sqlString(DEMO_ORG)}, ${sqlString(DEMO_ORG.toLowerCase())}, ${NOW}, ${NOW}
 WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE normalized_name = ${sqlString(DEMO_ORG.toLowerCase())});`,

    `INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
SELECT ${sqlString(MEMBER_ID)}, 'organization', ${sqlString(ORG_ID)}, 'active', ${NOW}, ${NOW}
 WHERE NOT EXISTS (SELECT 1 FROM members WHERE id = ${sqlString(MEMBER_ID)});`,

    `INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT ${sqlString(MEMBER_ID)}, 'A', ${NOW}, ${NOW}
 WHERE NOT EXISTS (SELECT 1 FROM member_category_assignments WHERE member_id = ${sqlString(MEMBER_ID)});`,

    /* The affiliation itself: this is what gives the record its lede, its
       About panel and its Contact links. */
    `INSERT INTO identities
  (id, user_id, organization_id, job_title, biography, links_json, source,
   show_on_organization_profile, invited_at, started_at, created_at, updated_at)
SELECT ${sqlString(IDENTITY_ID)}, u.id, ${sqlString(ORG_ID)},
       'Solution architect',
       'Twenty years in public key infrastructure, most of them spent on the unglamorous end: signature validation, policy conformance, and getting relying parties to agree on what a certificate actually means.',
       '["https://digitorus.com","https://www.linkedin.com/in/pvanbrouwershaven"]',
       'migration', 1, ${NOW}, ${NOW}, ${NOW}, ${NOW}
  FROM users u
 WHERE u.email = ${sqlString(DEMO_MEMBER)}
   AND NOT EXISTS (SELECT 1 FROM identities WHERE id = ${sqlString(IDENTITY_ID)});`,

    /* A second member, so vouching has somebody to come from. */
    `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
SELECT ${sqlString(PEER_MEMBER_ID)}, 'individual', u.id, 'active', ${NOW}, ${NOW}
  FROM users u WHERE u.email = ${sqlString(DEMO_PEER)}
   AND NOT EXISTS (SELECT 1 FROM members WHERE id = ${sqlString(PEER_MEMBER_ID)});`,

    `INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT ${sqlString(PEER_MEMBER_ID)}, 'H6', ${NOW}, ${NOW}
 WHERE EXISTS (SELECT 1 FROM members WHERE id = ${sqlString(PEER_MEMBER_ID)})
   AND NOT EXISTS (SELECT 1 FROM member_category_assignments WHERE member_id = ${sqlString(PEER_MEMBER_ID)});`,

    `INSERT INTO identities
  (id, user_id, organization_id, source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
-- An individual capacity has no organization profile to appear on, which the
-- table's CHECK enforces: no job title and never shown.
SELECT ${sqlString(PEER_IDENTITY_ID)}, u.id, NULL, 'migration', 0, ${NOW}, ${NOW}, ${NOW}, ${NOW}
  FROM users u WHERE u.email = ${sqlString(DEMO_PEER)}
   AND NOT EXISTS (SELECT 1 FROM identities WHERE id = ${sqlString(PEER_IDENTITY_ID)});`,
  ];
}

function skillSql([slug, name]) {
  return `INSERT INTO skills (id, slug, name, active, created_at, updated_at)
SELECT ${RANDOM_ID}, ${sqlString(slug)}, ${sqlString(name)}, 1, ${NOW}, ${NOW}
 WHERE NOT EXISTS (SELECT 1 FROM skills WHERE slug = ${sqlString(slug)});`;
}

function claimSql(email, slug, order) {
  return `INSERT INTO user_skills (id, user_id, skill_id, sort_order, created_at, updated_at)
SELECT ${RANDOM_ID}, u.id, s.id, ${String(order)}, ${NOW}, ${NOW}
  FROM users u JOIN skills s ON s.slug = ${sqlString(slug)}
 WHERE u.email = ${sqlString(email)}
   AND NOT EXISTS (SELECT 1 FROM user_skills existing WHERE existing.user_id = u.id AND existing.skill_id = s.id);`;
}

/**
 * A seeded vouch obeys the same two rules the write path enforces: never your
 * own skill, and only from somebody who shares a current group with you.
 * Enforcing them here rather than trusting the table above means seed data can
 * never contradict what the API would allow.
 */
function vouchSql(ownerEmail, slug, voucherEmail) {
  return `INSERT INTO user_skill_vouches (id, user_skill_id, voucher_user_id, created_at)
SELECT ${RANDOM_ID}, claim.id, voucher.id, ${NOW}
  FROM user_skills claim
  JOIN users owner ON owner.id = claim.user_id AND owner.email = ${sqlString(ownerEmail)}
  JOIN skills s ON s.id = claim.skill_id AND s.slug = ${sqlString(slug)}
  JOIN users voucher ON voucher.email = ${sqlString(voucherEmail)}
 WHERE voucher.id <> owner.id
   AND EXISTS (
     SELECT 1
       FROM group_memberships mine
       JOIN group_memberships theirs ON theirs.group_id = mine.group_id
      WHERE mine.user_id = voucher.id AND mine.left_at IS NULL
        AND theirs.user_id = owner.id AND theirs.left_at IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM user_skill_vouches existing
      WHERE existing.user_skill_id = claim.id AND existing.voucher_user_id = voucher.id
   );`;
}

function availabilitySql(entry) {
  return `INSERT INTO user_availability
  (user_id, open_to_employment, open_to_contract, roles_sought, services_offered, note, available_from, visibility, created_at, updated_at)
SELECT u.id, ${String(entry.openToEmployment)}, ${String(entry.openToContract)}, ${sqlString(entry.rolesSought)},
       ${sqlString(entry.servicesOffered)},
       ${sqlString(entry.note)}, ${sqlString(entry.availableFrom)}, ${sqlString(entry.visibility)}, ${NOW}, ${NOW}
  FROM users u WHERE u.email = ${sqlString(entry.email)}
    ON CONFLICT(user_id) DO UPDATE SET
      open_to_employment = excluded.open_to_employment,
      open_to_contract   = excluded.open_to_contract,
      roles_sought       = excluded.roles_sought,
      services_offered   = excluded.services_offered,
      note               = excluded.note,
      available_from     = excluded.available_from,
      visibility         = excluded.visibility,
      updated_at         = excluded.updated_at;`;
}

/**
 * One award row per occurrence, keyed by an index so re-running is idempotent:
 * `source_ref` gives the partial unique index something stable to match on.
 */
function awardSql(entry, index) {
  return `INSERT INTO user_standing_awards (id, user_id, reason_key, points, source_type, source_ref, awarded_at, created_at)
SELECT ${RANDOM_ID}, u.id, ${sqlString(entry.reason)}, ${String(entry.points)}, 'seed', ${sqlString(`${entry.reason}-${String(index)}`)}, ${NOW}, ${NOW}
  FROM users u
 WHERE u.email = ${sqlString(entry.email)}
   AND NOT EXISTS (
     SELECT 1 FROM user_standing_awards existing
      WHERE existing.user_id = u.id AND existing.source_type = 'seed'
        AND existing.source_ref = ${sqlString(`${entry.reason}-${String(index)}`)}
   );`;
}

function recognitionSql(entry) {
  return `INSERT INTO user_recognitions (id, user_id, recognition_key, label, awarded_at, created_at, updated_at)
SELECT ${RANDOM_ID}, u.id, ${sqlString(entry.key)}, ${sqlString(entry.label)}, ${NOW}, ${NOW}, ${NOW}
  FROM users u WHERE u.email = ${sqlString(entry.email)}
    ON CONFLICT(user_id, recognition_key) DO NOTHING;`;
}

function buildSql() {
  const statements = [...SKILLS.map(skillSql), ...demoOrganizationSql()];

  /* The groups this seed owns, before anything that hangs off them. */
  statements.push(...DEMO_GROUPS.map(demoGroupSql));

  /* Seats: vouching and attendance both depend on them existing. The demo
     member chairs the CBOM demo group, which the record's lede reflects. */
  for (const group of DEMO_GROUPS) {
    statements.push(seatSql(DEMO_MEMBER, IDENTITY_ID, MEMBER_ID, group.slug, group.title));
    statements.push(seatSql(DEMO_PEER, PEER_IDENTITY_ID, PEER_MEMBER_ID, group.slug, null));
  }

  /* Attendance: held vs attended per group, so the record shows three
     different rates rather than one flat number. */
  DEMO_GROUPS.forEach((group, index) => {
    statements.push(...meetingsSql(group.slug, index, group.held, group.attended, DEMO_MEMBER));
  });

  for (const person of CLAIMS) {
    person.skills.forEach(([slug, vouchers], order) => {
      statements.push(claimSql(person.email, slug, order));
      for (const voucher of vouchers) statements.push(vouchSql(person.email, slug, voucher));
    });
  }

  statements.push(...AVAILABILITY.map(availabilitySql));

  let awardIndex = 0;
  for (const entry of AWARDS) {
    for (let occurrence = 0; occurrence < entry.count; occurrence += 1) {
      statements.push(awardSql(entry, awardIndex));
      awardIndex += 1;
    }
  }

  statements.push(...RECOGNITIONS.map(recognitionSql));
  return statements.join("\n\n");
}

function main() {
  const argv = process.argv.slice(2);
  const env = parseEnv(argv);
  const cfg = ENVS[env];
  const persist = persistTo(argv);
  const tmpPath = path.join(os.tmpdir(), `pkic-seed-member-profiles-${String(Date.now())}.sql`);
  fs.writeFileSync(tmpPath, buildSql(), "utf8");

  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        cfg.database,
        "--env",
        cfg.wranglerEnv,
        cfg.wranglerFlag,
        ...(persist ? ["--persist-to", persist] : []),
        "--file",
        tmpPath,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }

  console.log(`\n✓ Member profiles seeded into ${cfg.database}.`);
}

main();
