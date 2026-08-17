/**
 * External-command adapter: logo/photo file lookup on disk plus the real
 * `wrangler d1 execute`/`wrangler r2 object put` invocations. Isolated here
 * because it's the only part of the importer that shells out or touches R2 —
 * everything else (parsing, reconciliation, SQL rendering, reporting) is a
 * pure function over already-loaded data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Requires an exact `<slug>.<ext>` match. Falling back to "the first file
 * in the directory" when no exact match exists previously risked silently
 * picking an unrelated file (e.g. a representative's headshot living in
 * the same directory) as the organization logo.
 */
export function findLogoFile(logoDir, slug) {
  const dir = path.join(logoDir, slug);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === slug);
  return exact ? path.join(dir, exact) : null;
}

/**
 * Per-representative photo, sourced from the same `assets/images/members/<orgSlug>/`
 * directory as the org logo — the old Hugo `single.html` looked these up at
 * `/images/members/<orgSlug>/<repId-or-urlized-name>.*` (falling back to the
 * urlized representative name when no explicit `id` was set on the YAML
 * `representatives[]` entry). Distinct from `findLogoFile`, which only ever
 * matches the org's own `<orgSlug>.*` file.
 */
export function findRepPhotoFile(logoDir, orgSlug, rep, urlizeName) {
  const dir = path.join(logoDir, orgSlug);
  if (!fs.existsSync(dir)) return null;
  const repSlug = String(rep.id ?? urlizeName(rep.name));
  if (!repSlug) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === repSlug);
  return exact ? path.join(dir, exact) : null;
}

export function runWranglerD1(root, envConfig, cli, sql) {
  const tmpPath = path.join(os.tmpdir(), `pkic-migrate-members-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");
  const args = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    "--env",
    envConfig.wranglerEnv,
    envConfig.wranglerFlag,
    ...(cli.persistTo ? [`--persist-to=${cli.persistTo}`] : []),
    "--file",
    tmpPath,
  ];
  try {
    execFileSync("pnpm", ["exec", ...args], { cwd: root, stdio: "inherit" });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

export function uploadLogosToR2(root, envConfig, cli, logoUploads) {
  for (const { filePath, r2Key } of logoUploads) {
    const args = [
      "wrangler",
      "r2",
      "object",
      "put",
      `${cli.logoBucket}/${r2Key}`,
      "--file",
      filePath,
      ...(envConfig.wranglerFlag === "--local" ? ["--local"] : []),
    ];
    execFileSync("pnpm", ["exec", ...args], { cwd: root, stdio: "inherit" });
  }
}
