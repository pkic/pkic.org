import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCaptureServer } from "../../scripts/email-capture/server.mjs";
import { parseRehearsalOptions, rehearsalMemberArguments } from "../../scripts/rehearsal/options.mjs";
import { rehearsalConfig, rehearsalEnvironment } from "../../scripts/rehearsal/config.mjs";

import { parseArgs } from "../../scripts/migrate-members/cli.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("local migration rehearsal", () => {
  it("requires explicit commands and refuses remote or ambiguous operations", () => {
    expect(() => parseRehearsalOptions(["start"])).toThrow("--state");
    expect(() => parseRehearsalOptions(["init", "--state", "/local"])).toThrow("--dump");
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--remote"])).toThrow();
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--dump", "backup.sql"])).toThrow();
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--port", "8799"])).toThrow("differ");
    expect(parseRehearsalOptions(["start", "--state", "/local"]).command).toBe("start");
    expect(parseRehearsalOptions(["members", "--state", "/local"]).command).toBe("members");
    expect(() => parseRehearsalOptions(["members", "--state", "/local", "--production"])).toThrow();
    expect(parseRehearsalOptions(["apply", "--state", "/local", "--sql", "migration.sql"]).sql).toBe(
      path.resolve("migration.sql"),
    );
  });

  it.each(["Europe/Amsterdam", "America/New_York", "UTC"])(
    "forwards %s unchanged to the local member importer",
    (zone) => {
      const options = parseRehearsalOptions(["members", "--state", "/local", "--roster-time-zone", zone]);
      const args = rehearsalMemberArguments(options);
      const imported = parseArgs(args.slice(2), process.cwd());
      expect(imported).toMatchObject({
        env: "local",
        persistTo: path.resolve("/local"),
        rosterTimeZone: zone,
        outDir: path.resolve("/local/member-import"),
      });
    },
  );

  it("keeps the source zone optional and reports misspelled, missing, or misplaced options", () => {
    const options = parseRehearsalOptions(["members", "--state", "/local"]);
    expect(rehearsalMemberArguments(options)).not.toContain("--roster-time-zone");
    expect(() =>
      parseRehearsalOptions(["members", "--state", "/local", "--roster-timme-zone", "Europe/Amsterdam"]),
    ).toThrow("Unknown option: --roster-timme-zone; use --roster-time-zone");
    expect(() => parseRehearsalOptions(["members", "--state", "/local", "--roster-time-zone"])).toThrow(
      "Missing value for --roster-time-zone",
    );
    expect(() => parseRehearsalOptions(["members", "--roster-time-zone", "--state", "/local"])).toThrow(
      "Missing value for --roster-time-zone",
    );
    expect(() =>
      parseRehearsalOptions(["start", "--state", "/local", "--roster-time-zone", "Europe/Amsterdam"]),
    ).toThrow("Only members accepts --roster-time-zone");
  });

  it("forwards the approved manual mapping path only for member imports", () => {
    const options = parseRehearsalOptions([
      "members",
      "--state",
      "/local",
      "--manual-mapping",
      "csv/manual-mapping.csv",
    ]);
    const imported = parseArgs(rehearsalMemberArguments(options).slice(2), process.cwd());
    expect(imported.manualMappingPath).toBe(path.resolve("csv/manual-mapping.csv"));
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--manual-mapping", "mapping.csv"])).toThrow(
      "Only members",
    );
  });

  it("isolates configuration and inherited credentials from all real providers", () => {
    const state = mkdtempSync(path.join(tmpdir(), "rehearsal-config-"));
    directories.push(state);
    const config = rehearsalConfig(process.cwd(), state, 8788, 8799, "new-local-secret");
    expect(config.vars.SENDGRID_API_BASE).toBe("http://127.0.0.1:8799");
    expect(config.vars.SENDGRID_API_KEY).toBe("local-capture-only-not-a-real-key");
    expect(config.vars.INTERNAL_SIGNING_SECRET).toBe("new-local-secret");
    expect(config).not.toHaveProperty("triggers");
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("services");
    expect(config.vars).not.toHaveProperty("STRIPE_SECRET_KEY");
    for (const binding of [...config.d1_databases, ...config.r2_buckets, ...config.kv_namespaces]) {
      expect(binding.remote).toBe(false);
    }
    expect(
      rehearsalEnvironment({
        PATH: "/bin",
        HOME: "/home/local",
        SENDGRID_API_KEY: "real",
        CLOUDFLARE_API_TOKEN: "real",
        NODE_OPTIONS: "--import unwanted.mjs",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/home/local" });
  });

  it("shows a local inbox and captures original recipients, BCC and bodies without delivery", async () => {
    const server = createCaptureServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No server address");
      const url = `http://127.0.0.1:${address.port}`;
      const page = await fetch(url);
      expect(await page.text()).toContain("Captured email");
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
      const payload = {
        personalizations: [
          { to: [{ email: "original@organization.example" }], bcc: [{ email: "copy@organization.example" }] },
        ],
        subject: "Rehearsal",
        content: [{ type: "text/plain", value: "Sign in: http://localhost:8788/portal/#/verify?token=synthetic" }],
      };
      expect((await fetch(url, { method: "POST", body: JSON.stringify(payload) })).status).toBe(202);
      const captured = await (await fetch(`${url}/outbox`)).json();
      expect(captured[0].payload).toEqual(payload);
      expect((await fetch(`${url}/clear`, { method: "POST" })).status).toBe(204);
      expect(await (await fetch(`${url}/outbox`)).json()).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
