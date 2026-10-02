import { performance } from "node:perf_hooks";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parse as parseYaml } from "yaml";
import {
  compileContentIgnorePatterns,
  contentSourceIsIncluded,
  parseFrontMatter,
} from "../functions/_lib/services/site-markdown.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const contentDirectory = fileURLToPath(new URL("../content/", import.meta.url));

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

const config = parseYaml(await readFile(new URL("../config.yaml", import.meta.url), "utf8")) ?? {};
const ignorePatterns = compileContentIgnorePatterns(config.ignoreFiles ?? []);

const discoveryStarted = performance.now();
const discovered = (await markdownFiles(contentDirectory)).filter((path) =>
  contentSourceIsIncluded(`content/${relative(contentDirectory, path)}`, ignorePatterns),
);
const discoveryMs = performance.now() - discoveryStarted;

const readStarted = performance.now();
const sources = await Promise.all(discovered.map((path) => readFile(path, "utf8")));
const readMs = performance.now() - readStarted;

const renderStarted = performance.now();
let sourceBytes = 0;
let htmlBytes = 0;
for (const source of sources) {
  sourceBytes += Buffer.byteLength(source);
  const { body } = parseFrontMatter(source);
  htmlBytes += Buffer.byteLength(await marked.parse(body));
}
const renderMs = performance.now() - renderStarted;
const totalMs = discoveryMs + readMs + renderMs;

const result = {
  files: sources.length,
  sourceBytes,
  htmlBytes,
  discoveryMs: Number(discoveryMs.toFixed(2)),
  readMs: Number(readMs.toFixed(2)),
  markdownToHtmlMs: Number(renderMs.toFixed(2)),
  totalMs: Number(totalMs.toFixed(2)),
  pagesPerSecond: Number(((sources.length / totalMs) * 1000).toFixed(0)),
  repository: root,
};

console.log(JSON.stringify(result, null, 2));
