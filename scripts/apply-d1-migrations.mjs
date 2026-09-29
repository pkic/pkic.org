import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationName = '0035_membership_portal_governance.sql';
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));

function wrangler(args, stdio = 'inherit') {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'd1', ...args], {
    encoding: 'utf8',
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Wrangler exited with status ${result.status}: ${result.stderr || 'see output above'}`);
  }
  return result.stdout;
}

export function buildImportSql(sql) {
  return `${sql.trimEnd()}\nINSERT INTO d1_migrations (name) VALUES ('${migrationName}');\n`;
}

export function pendingMigrationNames(appliedNames, localNames) {
  const applied = new Set(appliedNames);
  return localNames.filter((name) => !applied.has(name));
}

function readRemoteRows(environment, query) {
  const output = wrangler(
    ['execute', 'DB', '--env', environment, '--remote', '--json', '--command', query],
    'pipe',
  );
  const result = JSON.parse(output);
  if (result.length !== 1 || result[0].success !== true) {
    throw new Error('D1 preflight did not return one successful result');
  }
  return result[0].results;
}

function apply(environment) {
  const appliedNames = readRemoteRows(environment, 'SELECT name FROM d1_migrations').map(
    (row) => row.name,
  );
  const localNames = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
  const pending = pendingMigrationNames(appliedNames, localNames);

  if (pending.includes(migrationName)) {
    if (pending[0] !== migrationName) {
      throw new Error(`Apply earlier pending migrations before ${migrationName}: ${pending.join(', ')}`);
    }
    const existing = readRemoteRows(
      environment,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('membership_categories', 'membership_workflow_versions', 'payment_ledger_entries')",
    );
    if (existing.length !== 0) {
      throw new Error(`Migration tables already exist without a ledger entry: ${existing.map((row) => row.name).join(', ')}`);
    }

    // D1's remote /query splitter rejects this valid, trigger-heavy migration.
    // --file uses D1's atomic import path; the ledger insert shares that import.
    const temporaryDir = mkdtempSync(join(process.env.PKIC_MIGRATION_TMPDIR || tmpdir(), 'pkic-d1-'));
    const importFile = join(temporaryDir, migrationName);
    try {
      writeFileSync(importFile, buildImportSql(readFileSync(join(migrationDir, migrationName), 'utf8')));
      wrangler(['execute', 'DB', '--env', environment, '--remote', '--file', importFile]);
    } finally {
      rmSync(importFile, { force: true });
      rmdirSync(temporaryDir);
    }
    const recorded = readRemoteRows(
      environment,
      `SELECT name FROM d1_migrations WHERE name = '${migrationName}'`,
    );
    if (recorded.length !== 1) throw new Error('D1 import finished without recording migration 0035');
  }

  wrangler(['migrations', 'apply', 'DB', '--env', environment, '--remote']);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const environment = process.argv[2];
  if (environment !== 'preview' && environment !== 'production') {
    throw new Error('Specify preview or production');
  }
  apply(environment);
}
