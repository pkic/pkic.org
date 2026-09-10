import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export function listTypeScriptFiles(directory: string, extensions: readonly string[] = [".ts"]): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path, extensions);
    if (!entry.isFile() || entry.name.startsWith("._")) return [];
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

export function readTypeScriptSource(path: string): string {
  return readFileSync(path, "utf8");
}

export function sourceLine(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}
