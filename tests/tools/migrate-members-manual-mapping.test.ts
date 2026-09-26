import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadManualMappings, reconcileManualRecord } from "../../scripts/migrate-members/manual-mapping.mjs";
import { renderMarkdownReport } from "../../scripts/migrate-members/report.mjs";
import { buildMigration } from "../../scripts/migrate-members/build-migration.mjs";
import { matchRepsToCandidates } from "../../scripts/migrate-members/reconciliation.mjs";

const header =
  "source_file,organization,representative_name,current_or_placeholder_email,confirmed_email,corrected_domains,decision,notes";
const sources = [{ filename: "forms.yaml", slug: "forms", doc: { name: "Forms Organization", memberType: "A" } }];
const dirs: string[] = [];
function load(rows: string[], records = sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-mapping-"));
  dirs.push(dir);
  const file = path.join(dir, "mapping.csv");
  fs.writeFileSync(file, `${header}\r\n${rows.join("\r\n")}\r\n`);
  return loadManualMappings(file, records);
}
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("approved member mappings", () => {
  it("handles quoted multiline notes, normalizes addresses, and adds an explicitly named representative", () => {
    const rows = load([
      'forms.yaml,Forms Organization,Ada User,,Ada@Users.Example,forms.example,confirmed,"Approved, including\nprofile review"',
    ]);
    const result = reconcileManualRecord({ reps: [], candidates: [], mappings: rows.get("forms.yaml")! });
    expect(result.reps).toEqual([{ name: "Ada User", confirmedEmail: "ada@users.example" }]);
    expect(result.candidates).toEqual([{ email: "ada@users.example", joinSortKey: "" }]);
    expect(rows.get("forms.yaml")![0].domains).toEqual(["forms.example"]);
  });

  it("assigns confirmed emails before name matching and excludes unresolved and former representatives", () => {
    const mappings = load([
      "forms.yaml,Forms Organization,Ada User,,bob@forms.example,,confirmed,approved",
      "forms.yaml,Forms Organization,Bob User,TODO,TODO,,unresolved,not known",
      "forms.yaml,Forms Organization,Former User,,former@forms.example,,no_longer_representative,left",
    ]).get("forms.yaml")!;
    const result = reconcileManualRecord({
      reps: [{ name: "Ada User", role: "Engineer" }, { name: "Bob User" }, { name: "Former User" }],
      candidates: [{ email: "ada@forms.example" }, { email: "bob@forms.example" }, { email: "former@forms.example" }],
      mappings,
    });
    expect(result.reps).toEqual([{ name: "Ada User", role: "Engineer", confirmedEmail: "bob@forms.example" }]);
    const { assignment } = matchRepsToCandidates(result.reps, result.candidates);
    expect(result.candidates[assignment[0]!].email).toBe("bob@forms.example");
    expect(result.candidates.some((candidate: { email: string }) => candidate.email === "former@forms.example")).toBe(
      false,
    );
  });

  it.each([
    ["forms.yaml,Forms Organization,Ada User,,ada@invalid,,confirmed,", "confirmed_email"],
    ["missing.yaml,Forms Organization,Ada User,,ada@users.example,,confirmed,", "source_file"],
    ["forms.yaml,Other Organization,Ada User,,ada@users.example,,confirmed,", "organization"],
    ["forms.yaml,Forms Organization,Ada User,,ada@users.example,,maybe,", "decision"],
    ["forms.yaml,Forms Organization,Ada User,,ada@users.example,https://forms.example,confirmed,", "domain"],
    ["forms.yaml,Forms Organization,Ada User,old@users.example,ada@users.example,,confirmed,", "placeholder"],
  ])("rejects an unsafe row before SQL generation: %s", (row, message) => {
    expect(() => load([row])).toThrow(message);
  });

  it("rejects duplicate decisions and conflicting email ownership", () => {
    const row = "forms.yaml,Forms Organization,Ada User,,ada@users.example,,confirmed,";
    expect(() => load([row, row])).toThrow("duplicate");
    expect(() => load([row, row.replace("Ada User", "Other User")])).toThrow("different people");
  });

  it("rejects conflicting domain corrections", () => {
    expect(() =>
      load([
        "forms.yaml,Forms Organization,Ada User,,ada@users.example,forms.example,confirmed,",
        "forms.yaml,Forms Organization,Bob User,,bob@users.example,other.example,confirmed,",
      ]),
    ).toThrow("conflicting corrected domains");
  });

  it.each([
    {
      names: ["Ada User", "Bob User"],
      emails: ["first", "second"],
      memberType: "A",
      manual: true,
      expected: "Bob User",
      method: "join-order fallback",
    },
    {
      names: ["Leo Grove"],
      emails: ["chris", "leo"],
      memberType: "A",
      manual: false,
      expected: "Leo Grove",
      method: "join-order fallback",
    },
    {
      names: ["Alice Anderson"],
      emails: ["alice"],
      memberType: "A",
      manual: false,
      expected: "Alice Anderson",
      method: "name match",
    },
    {
      names: ["Leo Grove"],
      emails: ["chris"],
      memberType: "A",
      manual: false,
      expected: "Leo Grove",
      method: "join-order fallback",
    },
    {
      names: ["Forms Organization"],
      emails: ["first"],
      memberType: "H6",
      manual: false,
      expected: "Forms Organization",
      method: "join-order fallback",
    },
    { names: ["Ada User"], emails: ["first"], memberType: "A", manual: true, expected: null, method: null },
    { names: ["Forms Organization"], emails: ["first"], memberType: "H6", manual: true, expected: null, method: null },
  ])(
    "reports every unconfirmed assignment: $names / $memberType / manual=$manual",
    ({ names, emails, memberType, manual, expected, method }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-report-"));
      dirs.push(root);
      const membersDir = path.join(root, "members");
      const csvDir = path.join(root, "csv");
      fs.mkdirSync(membersDir);
      fs.mkdirSync(csvDir);
      fs.writeFileSync(
        path.join(membersDir, "forms.yaml"),
        `name: Forms Organization\nmemberType: ${memberType}\norganizationDomains: [forms.example]\nrepresentatives:\n${names.map((name) => `  - name: ${name}`).join("\n")}\n`,
      );
      for (const name of ["pkic", "ca", "cbom", "cm", "pkimm", "pqc", "tcwg"]) {
        fs.writeFileSync(
          path.join(csvDir, `${name}.csv`),
          name === "pkic" ? `Email\n${emails.map((email) => `${email}@forms.example`).join("\n")}\n` : "Email\n",
        );
      }
      const manualMappingPath = path.join(csvDir, "manual-mapping.csv");
      fs.writeFileSync(
        manualMappingPath,
        `${header}\nforms.yaml,Forms Organization,${names[0]},,ada@users.example,,confirmed,`,
      );
      const { report } = buildMigration({
        uploadLogos: false,
        rosterTimeZone: "UTC",
        membersDir,
        csvDir,
        sponsorsYamlPath: path.join(root, "missing.yaml"),
        manualMappingPath: manual ? manualMappingPath : undefined,
      });
      expect(report.totals.unmatched).toHaveLength(0);
      expect(report.totals.ambiguousPairing).toHaveLength(expected ? 1 : 0);
      expect(report.manualMappings).toHaveLength(manual ? 1 : 0);
      if (expected) {
        const guess = { representative: expected, email: `${emails[0]}@forms.example`, method };
        expect(report.totals.ambiguousPairing[0]).toMatchObject({ guesses: [guess] });
        const markdown = renderMarkdownReport(report);
        expect(markdown).toContain(`${expected} → \`${guess.email}\` — **unconfirmed ${method}**`);
        expect(markdown).toContain(
          `Candidate emails: [${[...emails.map((email) => `${email}@forms.example`), ...(manual ? ["ada@users.example"] : [])].join(", ")}]`,
        );
      }
    },
  );

  it("permits only the deterministic placeholder for an individual", () => {
    const individual = [{ filename: "ada.yaml", slug: "ada", doc: { name: "Ada User", memberType: "H6" } }];
    const row = "ada.yaml,N/A (individual member),Ada User,unmatched-ada@members.invalid,ada@users.example,,confirmed,";
    expect(load([row], individual).get("ada.yaml")).toHaveLength(1);
    expect(() => load([row.replace("unmatched-ada", "unmatched-other")], individual)).toThrow("placeholder");
  });
});
