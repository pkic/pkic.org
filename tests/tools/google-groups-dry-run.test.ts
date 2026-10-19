import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleGroupsReadOnlyDatabase, runGoogleGroupsDryRun } from "../../scripts/google-groups-sync/dry-run";
import { GOOGLE_GROUPS_READONLY_SCOPES } from "../../functions/_lib/services/google-groups/directory-client";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "reader@example.test",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  GOOGLE_WORKSPACE_ADMIN_EMAIL: "groups-reader@example.test",
};
let temporary: string;
let path: string;
let db: DatabaseSync;
function queue(id: string, action = "add_to_list", group = "group@example.test", due = "2026-01-01T00:00:00.000Z") {
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, normalized_email, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  ).run(id, `${id}@example.test`, `${id}@example.test`, due, due);
  db.prepare(
    "INSERT INTO google_groups_sync_queue (id, user_id, action, google_group_email, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
  ).run(`queue-${id}-${action}`, id, action, group, due, due);
}
function mockGoogle(options: { incomplete?: boolean; status?: number } = {}) {
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      const payload = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
      expect(payload.scope.split(" ")).toEqual([...GOOGLE_GROUPS_READONLY_SCOPES]);
      expect(payload.sub).toBe(credentials.GOOGLE_WORKSPACE_ADMIN_EMAIL);
      return Response.json({ access_token: "synthetic-access-token" });
    }
    expect(init?.method ?? "GET").toBe("GET");
    expect(url).toContain("/members?");
    return Response.json(
      { members: [{ email: "remove@example.test" }], ...(options.incomplete ? { nextPageToken: "next" } : {}) },
      { status: options.status ?? 200 },
    );
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "pkic-groups-test-"));
  path = join(temporary, "synthetic.sqlite");
  db = new DatabaseSync(path);
  for (const name of readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort())
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
});
afterEach(() => {
  db.close();
  rmSync(temporary, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("Google Groups dry run", () => {
  it("plans adds/removes through the production use case without changing any database bytes", async () => {
    queue("add");
    queue("remove", "remove_from_list");
    const calls = mockGoogle();
    const before = readFileSync(path);
    const result = await runGoogleGroupsDryRun(path, credentials, 25);
    expect(result.plannedOperations).toEqual([
      { action: "add_to_list", googleGroupEmail: "group@example.test", memberEmail: "add@example.test" },
      { action: "remove_from_list", googleGroupEmail: "group@example.test", memberEmail: "remove@example.test" },
    ]);
    expect(result.completedAddsByUser).toEqual({});
    expect(calls).toHaveBeenCalledTimes(2);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect((await runGoogleGroupsDryRun(path, credentials, 25)).plannedOperations).toEqual(result.plannedOperations);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
  it("shares suppression, pause, stale-intent and due-date policies with live sync", async () => {
    queue("suppressed");
    queue("stale");
    queue("stale", "remove_from_list");
    queue("future", "add_to_list", "group@example.test", "2999-01-01T00:00:00.000Z");
    const list = db.prepare("SELECT id, email FROM mailing_lists LIMIT 1").get()!;
    queue("paused", "add_to_list", String(list.email));
    db.prepare("INSERT INTO mailing_list_sync_settings (mailing_list_id, enabled, updated_at) VALUES (?, 0, ?)").run(
      list.id!,
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO google_groups_observed_membership (user_id, google_group_email, suppressed) VALUES (?, ?, 1)",
    ).run("suppressed", "group@example.test");
    mockGoogle();
    const before = readFileSync(path);
    const result = await runGoogleGroupsDryRun(path, credentials, 25);
    expect(result.suppressed).toBe(1);
    expect(result.plannedOperations).toEqual([
      { action: "remove_from_list", googleGroupEmail: "group@example.test", memberEmail: "stale@example.test" },
    ]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
  it("does not authenticate with no due work, and respects the bounded batch", async () => {
    const calls = mockGoogle();
    expect((await runGoogleGroupsDryRun(path, credentials, 1)).plannedOperations).toEqual([]);
    expect(calls).not.toHaveBeenCalled();
    queue("one");
    queue("two");
    expect((await runGoogleGroupsDryRun(path, credentials, 1)).plannedOperations).toHaveLength(1);
  });
  it.each([{ status: 403 }, { incomplete: true }])(
    "fails without writes for unreadable/partial membership: %j",
    async (options) => {
      queue("one");
      mockGoogle(options);
      const before = readFileSync(path);
      await expect(runGoogleGroupsDryRun(path, credentials, 25)).rejects.toThrow();
      expect(readFileSync(path).equals(before)).toBe(true);
    },
  );
  it("rejects mutations even through read methods on the SQLite adapter", async () => {
    const sqlite = new DatabaseSync(path, { readOnly: true });
    try {
      const adapter = googleGroupsReadOnlyDatabase(sqlite);
      await expect(adapter.prepare("DELETE FROM users").all()).rejects.toThrow();
      await expect(adapter.prepare("SELECT 1").run()).rejects.toThrow();
      await expect(adapter.batch([])).rejects.toThrow();
    } finally {
      sqlite.close();
    }
  });
});
