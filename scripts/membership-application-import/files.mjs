import { open, rename, unlink, realpath, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, basename, join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export async function readJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile() || (await file.stat()).size > 64 * 1024 * 1024)
      throw new Error("Input must be a regular JSON file no larger than 64 MiB");
    return JSON.parse(await file.readFile("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Input is not valid JSON", { cause: error });
    throw error;
  } finally {
    await file.close();
  }
}

export async function privatePaths(manifestPath, reportPath, repositoryRoot) {
  const root = await realpath(repositoryRoot);
  const manifest = await realpath(manifestPath);
  const report = join(await realpath(dirname(reportPath)), basename(reportPath));
  for (const path of [manifest, report]) {
    const location = relative(root, path);
    if (!location || (!location.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(location)))
      throw new Error("Keep manifests and reports outside the repository");
  }
  if (manifest === report) throw new Error("Manifest and report must be different files");
  try {
    if (!(await lstat(report)).isFile()) throw new Error("Report must be a regular file, not a symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { manifest, report };
}

/** Exclusive run lock also prevents two resumptions from racing the same checkpoint. */
export async function lockReport(path) {
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("Report is locked; verify no import is running before removing its .lock file", { cause: error });
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    await unlink(lockPath).catch(() => {});
    throw error;
  } finally {
    await lock.close();
  }
  return () => unlink(lockPath);
}

export async function writeReport(path, report) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await file.sync();
    await file.close();
    await rename(temporary, path);
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function existingReport(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
