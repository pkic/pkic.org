/** Approved per-person decisions; never infer an identity from a domain correction. */
import fs from "node:fs";
import { normalizedEmailSchema } from "../../assets/shared/schemas/api-common.ts";
import { parseCsvRecords } from "./roster-csv.mjs";
import { activeRepresentatives } from "./parsers.mjs";
import { isIndividualMembershipCategory } from "./categories.mjs";
import { sentinelEmailForSlug } from "./reconciliation.mjs";

const columns = [
  "source_file",
  "organization",
  "representative_name",
  "current_or_placeholder_email",
  "confirmed_email",
  "corrected_domains",
  "decision",
  "notes",
];

export function loadManualMappings(filePath, yamlRecords) {
  const byFile = new Map();
  if (!filePath) return byFile;
  const [header, ...rows] = parseCsvRecords(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (!header || header.length !== columns.length || columns.some((key) => !header.includes(key))) {
    throw new Error("Manual mapping must contain the eight documented CSV columns exactly once");
  }
  const sources = new Map(yamlRecords.map((record) => [record.filename, record]));
  const emailOwners = new Map();
  for (const [index, fields] of rows.entries()) {
    const fail = (message) => {
      throw new Error(`Manual mapping row ${index + 2}: ${message}`);
    };
    if (fields.length !== header.length) fail("incorrect column count");
    const row = Object.fromEntries(header.map((key, i) => [key, fields[i].trim()]));
    const source = sources.get(row.source_file);
    if (!source) fail("source_file does not identify a member YAML record");
    if (!row.representative_name) fail("representative_name is required");
    if (!["confirmed", "unresolved", "no_longer_representative"].includes(row.decision)) fail("unknown decision");
    const individual = isIndividualMembershipCategory(source.doc.memberType);
    if (row.decision === "confirmed" && !individual && row.organization !== source.doc.name)
      fail("organization does not match source_file");
    if (
      individual &&
      row.representative_name !== source.doc.name &&
      !activeRepresentatives(source.doc).some((rep) => rep.name === row.representative_name)
    )
      fail("individual name does not match source_file");
    const entries = byFile.get(row.source_file) ?? [];
    if (
      entries.some((entry) => entry.representative_name === row.representative_name) ||
      (individual && entries.length)
    )
      fail("duplicate person decision");
    if (row.decision === "confirmed") {
      const parsed = normalizedEmailSchema.safeParse(row.confirmed_email);
      if (!parsed.success || parsed.data.endsWith(".invalid"))
        fail("confirmed_email must be a deliverable email address");
      row.confirmed_email = parsed.data;
      const owner = emailOwners.get(parsed.data);
      if (owner && owner !== row.representative_name) fail("confirmed email is assigned to different people");
      emailOwners.set(parsed.data, row.representative_name);
      const previous = row.current_or_placeholder_email;
      if (
        previous &&
        previous !== "TODO" &&
        previous.toLowerCase() !== parsed.data &&
        (!individual || previous !== sentinelEmailForSlug(source.slug))
      )
        fail("only the source individual's deterministic placeholder can be replaced");
    }
    row.domains =
      row.decision === "confirmed" && row.corrected_domains
        ? [...new Set(row.corrected_domains.split(/[;\s]+/).map((domain) => domain.toLowerCase()))]
        : [];
    for (const domain of row.domains) {
      if (!normalizedEmailSchema.safeParse(`member@${domain}`).success || domain.endsWith(".invalid"))
        fail("invalid corrected domain");
    }
    const priorDomains = entries.find((entry) => entry.domains.length)?.domains;
    if (priorDomains && row.domains.length && [...priorDomains].sort().join() !== [...row.domains].sort().join())
      fail("conflicting corrected domains for one organization");
    entries.push(row);
    byFile.set(row.source_file, entries);
  }
  return byFile;
}

/** Apply approved decisions before candidate matching, preserving source profile fields. */
export function reconcileManualRecord({ reps, candidates, mappings }) {
  if (!mappings.length) return { reps, candidates };
  const decisions = new Map(mappings.map((row) => [row.representative_name, row]));
  const selected = reps.filter((rep) => !decisions.has(rep.name) || decisions.get(rep.name).decision === "confirmed");
  for (const row of mappings) {
    if (row.decision === "confirmed" && !selected.some((rep) => rep.name === row.representative_name)) {
      selected.push({ name: row.representative_name });
    }
  }
  const excluded = new Set(
    mappings.filter((row) => row.decision !== "confirmed").map((row) => row.confirmed_email.toLowerCase()),
  );
  const available = candidates.filter((candidate) => !excluded.has(candidate.email));
  for (const row of mappings.filter((entry) => entry.decision === "confirmed")) {
    if (!available.some((candidate) => candidate.email === row.confirmed_email))
      available.push({ email: row.confirmed_email, joinSortKey: "" });
  }
  return {
    reps: selected.map((rep) => ({ ...rep, confirmedEmail: decisions.get(rep.name)?.confirmed_email })),
    candidates: available,
  };
}
