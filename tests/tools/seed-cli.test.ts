import { describe, expect, it } from "vitest";
import { buildWranglerD1ExecuteArgs, parseSeedCliArgs } from "../../scripts/lib/seed-cli.mjs";
import { sqlString, toSqlNullableText, toSqlNullableTextPreservingWhitespace } from "../../scripts/lib/sql.mjs";

describe("shared seed CLI parser", () => {
  it("parses common flags and resolves relative config paths", () => {
    expect(
      parseSeedCliArgs(["--remote", "--db", "preview-db", "--env", "preview", "--config", "fixtures/event.yaml"], {
        configPath: "default.yaml",
      }),
    ).toMatchObject({
      mode: "remote",
      database: "preview-db",
      wranglerEnv: "preview",
      configPath: expect.stringMatching(/fixtures\/event\.yaml$/),
    });
  });

  it("lets a focused seeder consume its own value option", () => {
    const parsed = parseSeedCliArgs(
      ["--template", "welcome, reminder", "--if-missing"],
      { onlyTemplates: [] as string[], ifMissing: false },
      ({
        arg,
        next,
        parsed: options,
      }: {
        arg: string;
        next?: string;
        parsed: { onlyTemplates: string[]; ifMissing: boolean };
      }) => {
        if (arg === "--template" && next) {
          options.onlyTemplates.push(...next.split(",").map((value) => value.trim()));
          return 1;
        }
        if (arg === "--if-missing") options.ifMissing = true;
        return 0;
      },
    );
    expect(parsed.onlyTemplates).toEqual(["welcome", "reminder"]);
    expect(parsed.ifMissing).toBe(true);
  });
});

describe("shared seed SQL and Wrangler helpers", () => {
  it("quotes strings and renders optional text consistently for every seeder", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
    // An absent value is a NULL column, never the literal text 'null'.
    expect(sqlString(null)).toBe("NULL");
    expect(sqlString(undefined)).toBe("NULL");
    expect(toSqlNullableText("  value  ")).toBe("'value'");
    expect(toSqlNullableText("   ")).toBe("NULL");
    expect(toSqlNullableText(null)).toBe("NULL");
    expect(toSqlNullableTextPreservingWhitespace("  value  ")).toBe("'  value  '");
  });

  it("builds local and remote D1 execute arguments without dropping environment options", () => {
    // Workers Previews share the production DB binding's preview database;
    // --preview is what keeps a preview seed off production.
    expect(
      buildWranglerD1ExecuteArgs({ database: "DB", wranglerEnv: "preview", mode: "remote", persistTo: null }),
    ).toEqual(["wrangler", "d1", "execute", "DB", "--env", "production", "--preview", "--remote"]);
    expect(
      buildWranglerD1ExecuteArgs({ database: "pkic-db", wranglerEnv: "production", mode: "remote", persistTo: null }),
    ).toEqual(["wrangler", "d1", "execute", "pkic-db", "--env", "production", "--remote"]);
    expect(() =>
      buildWranglerD1ExecuteArgs({ database: "x", wranglerEnv: "staging", mode: "remote", persistTo: null }),
    ).toThrow(/Unsupported Wrangler target/);
    expect(
      buildWranglerD1ExecuteArgs({ database: "pkic-db", wranglerEnv: null, mode: "local", persistTo: "/tmp/d1" }),
    ).toEqual(["wrangler", "d1", "execute", "pkic-db", "--local", "--persist-to=/tmp/d1"]);
  });
});
