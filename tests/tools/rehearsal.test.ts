import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir, networkInterfaces } from "node:os";
import { rehearsalOrigin } from "../../scripts/rehearsal/network.mjs";
import { assertPortAvailable, waitForServer } from "../../scripts/rehearsal/fresh.mjs";
import path from "node:path";
import { createCaptureServer } from "../../scripts/email-capture/server.mjs";
import { parseRehearsalOptions } from "../../scripts/rehearsal/options.mjs";
import {
  copyBundledWorker,
  readBundledWorker,
  rehearsalDatabaseConfig,
  rehearsalDevConfig,
  rehearsalEnvironment,
  rehearsalEnvFiles,
  rehearsalWorkerConfig,
  serializeRehearsalDevVars,
  serializeRehearsalVars,
} from "../../scripts/rehearsal/config.mjs";
import { agendaPlanArguments, agendaPlanFiles } from "../../scripts/rehearsal/plans.mjs";
import { rehearsalBuildOutputs, rehearsalBuildSteps, rehearsalWatchProcesses } from "../../scripts/rehearsal/build.mjs";
import ts from "typescript";

import { parseEnv } from "node:util";
import { localBadgePrintKeyring, localBadgePrintEnvValue } from "../../scripts/local-badge-print-keyring.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

/** The shape `vite build` emits for the local target, plus deployment-only fields to strip. */
function writeLocalBundle(directory: string, target = "local") {
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync("wrangler.jsonc", "utf8"));
  const local = parsed.config.env.local;
  writeFileSync(
    path.join(directory, "wrangler.json"),
    JSON.stringify({
      ...local,
      targetEnvironment: target,
      account_id: "account",
      compatibility_date: parsed.config.compatibility_date,
      compatibility_flags: parsed.config.compatibility_flags,
      exports: parsed.config.exports,
      rules: [{ type: "ESModule", globs: ["**/*.js"] }],
      main: "index.js",
      no_bundle: true,
      routes: [{ pattern: "pkic.org", custom_domain: true }],
      triggers: { crons: ["* * * * *"] },
      services: [{ binding: "REMOTE", service: "remote" }],
    }),
  );
  writeFileSync(path.join(directory, "index.js"), "export default {};\n");
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "assets/chunk.js"), "export {};\n");
  writeFileSync(path.join(directory, ".dev.vars"), "STRIPE_SECRET_KEY=sk_test_local\n");
  return directory;
}

function localWorkerConfig(state: string, signingSecret = "local-signing", host = "127.0.0.1") {
  const bundleDirectory = writeLocalBundle(temporaryDirectory("rehearsal-bundle-"));
  const worker = path.join(state, "worker");
  copyBundledWorker(bundleDirectory, worker);
  return rehearsalWorkerConfig(
    { directory: worker, bundle: readBundledWorker(bundleDirectory), database: rehearsalDatabaseConfig(process.cwd()) },
    { state, port: 8788, inboxPort: 8799, signingSecret, host },
  );
}

describe("local migration rehearsal", () => {
  it.each([
    ["192.168.1.10", "http://192.168.1.10:8788"],
    ["2001:db8::10", "http://[2001:db8::10]:8788"],
    ["::1", "http://[::1]:8788"],
    ["0.0.0.0", "http://127.0.0.1:8788"],
    ["::", "http://[::1]:8788"],
  ])("derives usable service origins for %s", (host, origin) => {
    const options = parseRehearsalOptions(["start", "--state", "/local", "--host", host]);
    expect(options).toMatchObject({ host, baseUrl: origin });
    expect(agendaPlanArguments("plan.json", options.port, host)).toContain(origin);
    const [, server] = rehearsalWatchProcesses(
      {},
      { root: "/repo", configPath: "/config", state: "/local", port: 8788, host },
    );
    expect(server.args).toContain(host);
  });

  it("defaults to loopback and rejects missing or malformed host IPs", () => {
    expect(parseRehearsalOptions(["start", "--state", "/local"]).host).toBe("127.0.0.1");
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--host"])).toThrow("Missing value for --host");
    for (const host of ["localhost", "300.1.1.1", "192.168.1.10:8788", "[::1]"])
      expect(() => parseRehearsalOptions(["start", "--state", "/local", "--host", host])).toThrow("valid IP address");
  });

  it.each(["", "https://rehearsal.example.test"])(
    "captures email on a specific interface with public origin %s",
    async (baseUrl) => {
      const host = Object.values(networkInterfaces())
        .flat()
        .find((entry) => entry && !entry.internal && entry.family === "IPv4")?.address;
      if (!host) throw new Error("A non-loopback IPv4 interface is required for the rehearsal network smoke test");
      const root = temporaryDirectory("rehearsal-network-");
      const state = temporaryDirectory("rehearsal-network-state-");
      const applicationOrigin = baseUrl || rehearsalOrigin(host, 8788);
      const server = createCaptureServer({ applicationOrigin });
      await new Promise<void>((resolve) => server.listen(0, host, resolve));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server address");
        await expect(assertPortAvailable(address.port, "--inbox-port", host)).rejects.toThrow("already in use");
        const options = parseRehearsalOptions([
          "start",
          "--state",
          state,
          "--host",
          host,
          "--inbox-port",
          String(address.port),
          ...(baseUrl ? ["--base-url", baseUrl] : []),
        ]);
        const vars = parseEnv(serializeRehearsalDevVars(root, { ...options, signingSecret: "synthetic" }));
        expect(vars.APP_BASE_URL).toBe(applicationOrigin);
        const inbox = z.string().parse(vars.SENDGRID_API_BASE);
        expect(inbox).toBe(rehearsalOrigin(host, address.port));
        expect(await waitForServer(inbox, { attempts: 1 })).toBe(true);
        expect((await fetch(inbox)).status).toBe(200);
        const payload = {
          personalizations: [{ to: [{ email: "reader@example.test" }] }],
          subject: "Sign in",
          content: [{ type: "text/plain", value: `${vars.APP_BASE_URL}/portal/#/verify?token=synthetic` }],
        };
        expect((await fetch(inbox, { method: "POST", body: JSON.stringify(payload) })).status).toBe(202);
        expect((await (await fetch(`${inbox}/outbox`)).json())[0].payload).toEqual(payload);
        expect(await (await fetch(`${inbox}/configuration`)).json()).toEqual({ applicationOrigin });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("keeps email delivery on the listen interface when the public origin is overridden", () => {
    const root = temporaryDirectory("rehearsal-origin-");
    const options = parseRehearsalOptions([
      "start",
      "--state",
      root,
      "--host",
      "2001:db8::10",
      "--base-url",
      "https://rehearsal.example.test",
    ]);
    const vars = parseEnv(serializeRehearsalDevVars(root, { ...options, signingSecret: "synthetic" }));
    expect(vars.APP_BASE_URL).toBe("https://rehearsal.example.test");
    expect(vars.SENDGRID_API_BASE).toBe("http://[2001:db8::10]:8799");
    const built = localWorkerConfig(root, "synthetic", "2001:db8::10");
    expect(built.vars.SENDGRID_API_BASE).toBe(vars.SENDGRID_API_BASE);
    expect(built.vars.APP_BASE_URL).toBe("http://[2001:db8::10]:8788");
  });

  it("requires explicit commands and refuses remote or ambiguous operations", () => {
    expect(() => parseRehearsalOptions(["start"])).toThrow("--state");
    expect(() => parseRehearsalOptions(["init", "--state", "/local"])).toThrow("--dump");
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--remote"])).toThrow();
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--dump", "backup.sql"])).toThrow();
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--port", "8799"])).toThrow("differ");
    expect(parseRehearsalOptions(["start", "--state", "/local"]).command).toBe("start");
    expect(() => parseRehearsalOptions(["members", "--state", "/local"])).toThrow("Usage");
    expect(parseRehearsalOptions(["apply", "--state", "/local", "--sql", "migration.sql"]).sql).toBe(
      path.resolve("migration.sql"),
    );
  });

  it("hot-reloads by default and accepts --build and --fast only where the site is served", () => {
    expect(parseRehearsalOptions(["start", "--state", "/local"])).toMatchObject({ build: false, fast: false });
    expect(parseRehearsalOptions(["start", "--state", "/local", "--build", "--fast"])).toMatchObject({
      build: true,
      fast: true,
    });
    expect(parseRehearsalOptions(["fresh", "--build"]).build).toBe(true);
    expect(() => parseRehearsalOptions(["fresh", "--fast"])).toThrow("--fast applies only with --build");
    for (const flag of ["--fast", "--build"])
      for (const command of [["init", "--dump", "backup.sql"], ["migrate"], ["apply", "--sql", "m.sql"]])
        expect(() => parseRehearsalOptions([...command, "--state", "/local", flag])).toThrow(flag);
  });

  it("refreshes only into a new state and applies reviewed plans in name order", () => {
    expect(parseRehearsalOptions(["refresh", "--state", "/local", "--plans", "plans"])).toMatchObject({
      command: "refresh",
      plans: path.resolve("plans"),
      build: false,
    });
    expect(parseRehearsalOptions(["refresh", "--state", "/local", "--build"]).build).toBe(true);
    expect(() => parseRehearsalOptions(["refresh", "--state", "/local", "--dump", "x.sql"])).toThrow("--dump");
    expect(() => parseRehearsalOptions(["start", "--state", "/local", "--plans", "plans"])).toThrow("--plans");

    const plans = temporaryDirectory("rehearsal-plans-");
    for (const event of ["ottawa-2023", "amsterdam-2026", "notes"]) mkdirSync(path.join(plans, event));
    for (const event of ["ottawa-2023", "amsterdam-2026"]) writeFileSync(path.join(plans, event, "plan.json"), "{}");
    const files = agendaPlanFiles(plans);
    expect(files).toEqual([path.join(plans, "amsterdam-2026/plan.json"), path.join(plans, "ottawa-2023/plan.json")]);
    expect(agendaPlanArguments(files[0], 8788)).toEqual([
      "--experimental-strip-types",
      "scripts/migrate-event-agenda.mjs",
      "--base-url",
      "http://127.0.0.1:8788",
      "--plan",
      files[0],
      "--apply",
    ]);
    expect(() => agendaPlanFiles(temporaryDirectory("rehearsal-empty-"))).toThrow("plan.json");
  });

  it("isolates badge printing keys and retains them across Worker restarts", () => {
    const state = mkdtempSync(path.join(tmpdir(), "rehearsal-badge-"));
    const other = mkdtempSync(path.join(tmpdir(), "rehearsal-badge-"));
    directories.push(state, other);
    const first = localBadgePrintKeyring(state);
    expect(localBadgePrintKeyring(state)).toBe(first);
    expect(localBadgePrintKeyring(other)).not.toBe(first);
    const ring = z
      .object({
        activeKeyId: z.literal("local"),
        keys: z.object({ local: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
      })
      .strict()
      .parse(JSON.parse(first));
    expect(ring.activeKeyId).toBe("local");
    const config = localWorkerConfig(state);
    expect(config.vars.BADGE_PRINT_ENCRYPTION_KEYS).toBe(first);
    const serialized = serializeRehearsalVars(config.vars);
    expect(serialized).toContain(`BADGE_PRINT_ENCRYPTION_KEYS=${localBadgePrintEnvValue(first)}`);
    // Wrangler dotenv and Node parseEnv strip single quotes without rewriting the JSON inside.
    expect(parseEnv(serialized).BADGE_PRINT_ENCRYPTION_KEYS).toBe(first);
    expect(
      parseEnv(`BADGE_PRINT_ENCRYPTION_KEYS=${localBadgePrintEnvValue(first)}\n`).BADGE_PRINT_ENCRYPTION_KEYS,
    ).toBe(first);
    expect(() => localBadgePrintEnvValue("invalid'key")).toThrow();
    expect(readFileSync("scripts/e2e-start.sh", "utf8")).toContain(
      'node scripts/local-badge-print-keyring.mjs "$STATE_DIR" "$E2E_ENV_FILE"',
    );
  });

  it("keeps infrastructure local and excludes inherited process credentials", () => {
    const state = temporaryDirectory("rehearsal-config-");
    const config = localWorkerConfig(state, "new-local-secret");
    expect(config.main).toBe(path.join(state, "worker/index.js"));
    expect(config.assets.directory).toBe(path.join(state, "site"));
    expect(config.d1_databases).toEqual(rehearsalDatabaseConfig(process.cwd()).d1_databases);
    expect(config).not.toHaveProperty("account_id");
    expect(config.images).toEqual({ binding: "IMAGES", remote: false });
    expect(config.vars.SENDGRID_API_BASE).toBe("http://127.0.0.1:8799");
    expect(config.vars.SENDGRID_API_KEY).toBe("local-capture-only-not-a-real-key");
    expect(config.vars.STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
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

  it("loads repository development secrets before rehearsal-controlled overrides", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rehearsal-root-"));
    const state = mkdtempSync(path.join(tmpdir(), "rehearsal-state-"));
    directories.push(root, state);
    writeFileSync(
      path.join(root, ".dev.vars"),
      "STRIPE_SECRET_KEY=sk_test_local\nSTRIPE_PUBLISHABLE_KEY=pk_test_local\nSENDGRID_API_BASE=https://api.sendgrid.com\n",
    );

    const config = localWorkerConfig(state, "new-local-secret");
    const overridesPath = path.join(state, ".rehearsal.vars");
    writeFileSync(overridesPath, serializeRehearsalVars(config.vars));

    expect(rehearsalEnvFiles(root, state)).toEqual([path.join(root, ".dev.vars"), overridesPath]);
    expect(readFileSync(overridesPath, "utf8")).toContain('SENDGRID_API_BASE="http://127.0.0.1:8799"');
    expect(readFileSync(overridesPath, "utf8")).toContain('SENDGRID_API_KEY="local-capture-only-not-a-real-key"');
    expect(readFileSync(overridesPath, "utf8")).not.toContain("STRIPE_PUBLISHABLE_KEY");
  });

  it("starts with rehearsal-controlled values when .dev.vars is absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rehearsal-root-"));
    const state = mkdtempSync(path.join(tmpdir(), "rehearsal-state-"));
    directories.push(root, state);
    expect(rehearsalEnvFiles(root, state)).toEqual([path.join(state, ".rehearsal.vars")]);
  });

  it("imports and migrates through a database-only configuration", () => {
    const database = rehearsalDatabaseConfig(process.cwd());
    expect(Object.keys(database).sort()).toEqual(["compatibility_date", "d1_databases", "name"]);
    expect(database.d1_databases).toEqual([
      expect.objectContaining({ binding: "DB", migrations_dir: path.resolve("migrations"), remote: false }),
    ]);
  });

  it("builds the local publication from the rehearsal database without migrating or seeding it", () => {
    const state = "/local/rehearsal";
    const steps = rehearsalBuildSteps({ PATH: "/bin" }, state);
    for (const step of steps) {
      expect(step.env).toEqual({
        PATH: "/bin",
        CLOUDFLARE_ENV: "local",
        PKIC_PUBLICATION_LOCAL_STATE: path.join(state, "v3"),
      });
    }
    expect(steps.map(({ command, args }) => [path.basename(command), ...args].join(" "))).toEqual([
      `${path.basename(process.execPath)} --experimental-strip-types scripts/prepare-public.mjs --dev`,
      "pnpm exec vite build",
      `${path.basename(process.execPath)} --experimental-strip-types scripts/publication/build-local-publication.mjs dist/client`,
    ]);
    // A restored backup has no R2 uploads; --fast skips assets the portal does not need.
    for (const step of rehearsalBuildSteps({ PATH: "/bin" }, state, { fast: true, withoutR2Media: true })) {
      expect(step.env).toEqual({
        PATH: "/bin",
        CLOUDFLARE_ENV: "local",
        PKIC_PUBLICATION_LOCAL_STATE: path.join(state, "v3"),
        PKIC_PUBLICATION_FAST: "1",
        PKIC_PUBLICATION_MISSING_R2_MEDIA: "omit",
      });
    }
    // Hot reload builds only the publication, linking the client bundle by its development names.
    const [publication, ...rest] = rehearsalBuildSteps({ PATH: "/bin" }, state, { watch: true });
    expect(rest).toEqual([]);
    expect(publication.args.at(-1)).toBe("scripts/publication/build-local-publication.mjs");
    expect(publication.env).toMatchObject({ PKIC_PUBLICATION_FAST: "1", PKIC_CLIENT_DEV: "1" });
    const outputs = rehearsalBuildOutputs("/repo");
    expect(outputs).toEqual({
      worker: "/repo/dist/pkic_org_base",
      site: "/repo/dist/client",
      stale: ["/repo/dist", "/repo/.wrangler/deploy/config.json"],
    });
  });

  it("hot-reloads the source Worker against the state directory with local bindings and captured email", () => {
    const root = temporaryDirectory("rehearsal-root-");
    const state = temporaryDirectory("rehearsal-state-");
    writeFileSync(
      path.join(root, ".dev.vars"),
      "STRIPE_SECRET_KEY=sk_test_local\nSENDGRID_API_KEY=SG.real\nSENDGRID_API_BASE=https://api.sendgrid.com\n",
    );
    const database = rehearsalDatabaseConfig(process.cwd());
    const config = rehearsalDevConfig(process.cwd(), database);
    expect(config.main).toBe(path.resolve("functions/router.ts"));
    expect(Object.keys(config.env)).toEqual(["local"]);
    expect(config).not.toHaveProperty("account_id");
    expect(config.env.local.d1_databases).toEqual(database.d1_databases);
    expect(config.env.local.assets.directory).toBe(path.resolve("public"));
    for (const binding of [...config.env.local.r2_buckets, ...config.env.local.kv_namespaces, config.env.local.images])
      expect(binding.remote).toBe(false);

    const vars = parseEnv(serializeRehearsalDevVars(root, { state, port: 8788, inboxPort: 8799, signingSecret: "s" }));
    expect(vars).toMatchObject({
      STRIPE_SECRET_KEY: "sk_test_local",
      SENDGRID_API_KEY: "local-capture-only-not-a-real-key",
      SENDGRID_API_BASE: "http://127.0.0.1:8799",
      INTERNAL_SIGNING_SECRET: "s",
    });

    const [client, server] = rehearsalWatchProcesses(
      { PATH: "/bin" },
      { root: "/repo", configPath: path.join(state, "wrangler.dev.json"), state, port: 8788 },
    );
    expect(client.args).toEqual(["scripts/build-frontend.mjs", "--watch"]);
    expect(server.args).toEqual([
      "/repo/node_modules/vite/bin/vite.js",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "8788",
      "--strictPort",
    ]);
    expect(server.env).toEqual({
      PATH: "/bin",
      CLOUDFLARE_ENV: "local",
      PKIC_CLIENT_DEV: "1",
      PKIC_DEV_WRANGLER_CONFIG: path.join(state, "wrangler.dev.json"),
      PKIC_DEV_STATE: state,
    });
  });

  it("serves only a bundle built for the local target and snapshots it without env files", () => {
    expect(() => readBundledWorker(writeLocalBundle(temporaryDirectory("rehearsal-bundle-"), "production"))).toThrow(
      "local target",
    );
    const state = temporaryDirectory("rehearsal-state-");
    const config = localWorkerConfig(state);
    const worker = path.join(state, "worker");
    expect(existsSync(path.join(worker, "index.js"))).toBe(true);
    expect(existsSync(path.join(worker, "assets/chunk.js"))).toBe(true);
    expect(existsSync(path.join(worker, ".dev.vars"))).toBe(false);
    expect(existsSync(path.join(worker, "wrangler.json"))).toBe(false);
    expect(config.vars).not.toHaveProperty("STRIPE_SECRET_KEY");
  });

  it("uses an explicit LAN origin for generated email links and authentication origins", () => {
    const bundleDirectory = writeLocalBundle(temporaryDirectory("rehearsal-lan-"));
    const config = rehearsalWorkerConfig(
      {
        directory: bundleDirectory,
        bundle: readBundledWorker(bundleDirectory),
        database: rehearsalDatabaseConfig(process.cwd()),
      },
      {
        state: temporaryDirectory("rehearsal-lan-state-"),
        port: 8788,
        inboxPort: 8799,
        signingSecret: "test",
        baseUrl: "http://10.0.52.217:8788",
      },
    );
    expect(config.vars).toMatchObject({
      APP_BASE_URL: "http://10.0.52.217:8788",
      WEBAUTHN_ORIGIN: "http://10.0.52.217:8788",
      WEBAUTHN_RP_ID: "10.0.52.217",
    });
  });

  it("shows a local inbox and captures original recipients, BCC and bodies without delivery", async () => {
    const server = createCaptureServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No server address");
      const url = `http://127.0.0.1:${address.port}`;
      const refused = await new Promise<number | undefined>((resolve, reject) => {
        get(url, { headers: { host: `untrusted.example:${address.port}` } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        }).on("error", reject);
      });
      expect(refused).toBe(403);
      expect((await fetch(url, { headers: { origin: "https://untrusted.example" } })).status).toBe(403);
      const configuration = await (await fetch(`${url}/configuration`)).json();
      expect(configuration).toEqual({ applicationOrigin: "http://localhost:8788" });
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
      const captured = z.array(z.object({ payload: z.json() })).parse(await (await fetch(`${url}/outbox`)).json());
      expect(captured[0].payload).toEqual(payload);
      expect((await fetch(`${url}/clear`, { method: "POST" })).status).toBe(204);
      expect(await (await fetch(`${url}/outbox`)).json()).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
