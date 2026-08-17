import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCsvLine,
  loadRosterCsv,
  loadMemberYamlFiles,
  activeRepresentatives,
  convertHugoShortcodes,
  splitName,
  urlizeName,
  normalizeEmail,
} from "../../scripts/migrate-members/parsers.mjs";

describe("parseCsvLine", () => {
  it("splits plain comma-separated fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsvLine('alice@example.com,"Dholakia, Sandip",x')).toEqual([
      "alice@example.com",
      "Dholakia, Sandip",
      "x",
    ]);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });
});

describe("loadRosterCsv / loadMemberYamlFiles", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips the title/header lines and normalizes emails, ignoring rows with no @", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-parsers-csv-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "roster.csv");
    fs.writeFileSync(
      file,
      [
        "Members for group fixture",
        "Email,Nickname,Col3,Col4,Col5,Col6,Year,Month,Day,Hour,Minute,Second",
        "Alice@Example.com,Alice,x,x,x,x,2023,01,15,10,00,00",
        "not-an-email,Bob,x,x,x,x,2023,01,16,10,00,00",
      ].join("\n"),
      "utf8",
    );

    const roster = loadRosterCsv(file);
    expect([...roster.keys()]).toEqual(["alice@example.com"]);
    expect(roster.get("alice@example.com")).toEqual({ joinSortKey: "2023-0001-0015-0010-0000-0000" });
  });

  it("loads every .yaml/.yml file in the directory, deriving slug from the filename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-parsers-yaml-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "acme.yaml"), "name: Acme Corp\nmemberType: A\n", "utf8");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored", "utf8");

    const records = loadMemberYamlFiles(dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ filename: "acme.yaml", slug: "acme", doc: { name: "Acme Corp" } });
  });

  it("excludes AppleDouble sidecar files and other hidden dotfiles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-parsers-appledouble-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "acme.yaml"), "name: Acme Corp\nmemberType: A\n", "utf8");
    // AppleDouble sidecar file, produced when a directory is copied off an
    // HFS+/APFS volume onto a non-Apple filesystem (e.g. ScanDisk-backed runs).
    fs.writeFileSync(path.join(dir, "._acme.yaml"), "\x00\x05\x16\x07", "utf8");
    fs.writeFileSync(path.join(dir, ".hidden.yaml"), "name: Hidden\n", "utf8");

    const records = loadMemberYamlFiles(dir);
    expect(records).toHaveLength(1);
    expect(records[0].filename).toBe("acme.yaml");
  });

  it("excludes non-regular files (directories) even with a matching extension", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-parsers-dir-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "acme.yaml"), "name: Acme Corp\nmemberType: A\n", "utf8");
    fs.mkdirSync(path.join(dir, "subdir.yaml"));

    const records = loadMemberYamlFiles(dir);
    expect(records).toHaveLength(1);
    expect(records[0].filename).toBe("acme.yaml");
  });
});

describe("activeRepresentatives", () => {
  it("keeps only named representatives without a `till` date", () => {
    const doc = {
      representatives: [
        { name: "Alice" },
        { name: "  " },
        { name: "Bob", till: "2024-01-01" },
        { role: "no name field" },
      ],
    };
    expect(activeRepresentatives(doc).map((r: { name: string }) => r.name)).toEqual(["Alice"]);
  });

  it("returns an empty array when representatives is missing", () => {
    expect(activeRepresentatives({})).toEqual([]);
  });
});

describe("convertHugoShortcodes", () => {
  it("rewrites youtube/vimeo/video shortcodes into plain URLs", () => {
    expect(convertHugoShortcodes("{{< youtube abc123 >}}")).toBe("https://www.youtube.com/watch?v=abc123");
    expect(convertHugoShortcodes("{{< vimeo 42 >}}")).toBe("https://vimeo.com/42");
    expect(convertHugoShortcodes('{{< video link="https://example.com/v.mp4" >}}')).toBe("https://example.com/v.mp4");
  });

  it("passes through content with no shortcodes, and null/undefined unchanged", () => {
    expect(convertHugoShortcodes("plain text")).toBe("plain text");
    expect(convertHugoShortcodes(null)).toBeNull();
  });
});

describe("splitName", () => {
  it("splits multi-token names into first/last, single tokens into first only", () => {
    expect(splitName("Alice Anderson")).toEqual({ firstName: "Alice", lastName: "Anderson" });
    expect(splitName("Alice Van Der Berg")).toEqual({ firstName: "Alice Van Der", lastName: "Berg" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitName("")).toEqual({ firstName: null, lastName: null });
  });
});

describe("urlizeName", () => {
  it("mirrors Hugo's urlize: lowercase, strip diacritics, non-alphanumerics to hyphens", () => {
    expect(urlizeName("René O'Bréan & Co.")).toBe("rene-o-brean-co");
    expect(urlizeName("  Acme  Corp  ")).toBe("acme-corp");
  });
});
