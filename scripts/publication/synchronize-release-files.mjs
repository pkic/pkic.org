import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

/** Keep an existing file readable until its complete replacement is installed. */
export async function installReleaseFile(source, destination) {
  await installReleaseBytes(await readFile(source), destination);
}

/** Generated headers and manifests use the same atomic installation boundary. */
export async function installReleaseBytes(value, destination) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  try {
    if (bytes.equals(await readFile(destination))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.pending`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Reconcile owned assets without deleting a directory still serving requests. */
export async function synchronizeReleaseDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  const incoming = new Set(entries.map(({ name }) => name));
  for (const entry of entries) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    if (entry.isDirectory()) await synchronizeReleaseDirectory(from, to);
    else if (entry.isFile()) await installReleaseFile(from, to);
    else throw new Error(`Publication assets must be regular files: ${from}`);
  }
  for (const name of await readdir(destination)) {
    if (!incoming.has(name)) await rm(resolve(destination, name), { recursive: true, force: true });
  }
}
