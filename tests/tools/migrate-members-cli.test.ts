/**
 * Regression for the documented importer command. The existing importer
 * smoke test imports the orchestration module through Vitest, which means its
 * TypeScript transform hides failures that occur when the documented CLI is
 * run by Node. This test creates a synthetic checkout and executes the same
 * Node command used by the package script against it in dry-run mode.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const ENTRYPOINT = path.join(ROOT, "scripts", "migrate-members-yaml-to-d1.mjs");
const TEMP_ROOT = process.env.TMPDIR ?? os.tmpdir();

function writeRoster(filePath: string, rows: string[][] = []): void {
  const lines = [
    "Members for group fixture",
    "Email,Nickname,Col3,Col4,Col5,Col6,Year,Month,Day,Hour,Minute,Second",
    ...rows.map((fields) => fields.join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function createFixture(): string {
  const fixtureRoot = fs.mkdtempSync(path.join(TEMP_ROOT, "pkic-importer-cli-"));
  const membersDir = path.join(fixtureRoot, "data", "members");
  const csvDir = path.join(fixtureRoot, "csv");
  fs.mkdirSync(membersDir, { recursive: true });
  fs.mkdirSync(csvDir, { recursive: true });

  fs.writeFileSync(
    path.join(membersDir, "acme.yaml"),
    `id: acme
name: Acme Corp
memberType: A
organizationDomains:
  - acme.example
representatives:
  - name: Alice Anderson
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(membersDir, "student.yaml"),
    "id: student\nname: Student Example\nmemberType: H5\n",
    "utf8",
  );

  const alice = ["alice@acme.example", "Alice", "x", "x", "x", "x", "2023", "01", "15", "10", "00", "00"];
  writeRoster(path.join(csvDir, "pkic.csv"), [alice]);
  for (const slug of ["ca", "cbom", "cm", "pkimm", "pqc", "tcwg"]) {
    writeRoster(path.join(csvDir, `${slug}.csv`));
  }

  return fixtureRoot;
}

describe("migrate:members CLI", () => {
  const fixtures: string[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("runs the documented Node command against a synthetic checkout", () => {
    const fixtureRoot = createFixture();
    fixtures.push(fixtureRoot);

    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", ENTRYPOINT, "--dry-run", "--skip-logos"],
      {
        cwd: fixtureRoot,
        env: { ...process.env, TMPDIR: TEMP_ROOT },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const generatedFiles = fs.readdirSync(path.join(fixtureRoot, "ignore"));
    expect(generatedFiles.some((file) => file.endsWith(".sql"))).toBe(true);
    expect(generatedFiles.some((file) => file.endsWith(".json"))).toBe(true);
    expect(output).toContain("--dry-run: skipping wrangler execution and logo upload.");
  });
});
