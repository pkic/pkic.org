import { readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);
if (targets.length === 0) throw new Error("Provide at least one repository-relative directory to clean");

function isAppleDouble(name) {
  return name.startsWith("._") || name === ".AppleDouble";
}

async function cleanDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (isAppleDouble(entry.name)) {
      await rm(entryPath, { recursive: true, force: true });
    } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await cleanDirectory(entryPath);
    }
  }
}

for (const target of targets) {
  if (isAbsolute(target)) throw new Error(`Expected a repository-relative path: ${target}`);
  const directory = resolve(repositoryRoot, target);
  const relativePath = relative(repositoryRoot, directory);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to clean path outside a scoped repository directory: ${target}`);
  }
  await cleanDirectory(directory);
}
