import { boundDocumentRedirect, validateDocumentRoutes } from "./collect-document-redirects.mjs";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { digestPdf } from "../lib/legacy-agenda-media.mjs";

function hasControlCharacters(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function localPdfPath(value, prefix) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    !value.startsWith(prefix) ||
    value.startsWith("//") ||
    /[\\?#]/u.test(value) ||
    hasControlCharacters(value) ||
    /%(?:2f|5c|00)/iu.test(value)
  )
    throw new Error("Legacy PDF aliases require exact public event paths without credentials or encoded separators");
  const path = decodeURIComponent(value);
  if (
    !/\.pdf$/iu.test(path) ||
    path.split("/").some((part) => part === "." || part === "..") ||
    path.includes("\\") ||
    hasControlCharacters(path) ||
    /%(?:2e|2f|5c|00)/iu.test(path)
  )
    throw new Error("Legacy PDF alias contains an unsafe path");
  return path.slice(1);
}

/** Check every component before reading or creating a published file; parent symlinks are never followed. */
async function confinedPath(root, path, allowMissing = false) {
  const destination = resolve(root, path);
  if (!destination.startsWith(`${root}${sep}`)) throw new Error("Legacy PDF alias escapes the release directory");
  let current = root;
  for (const component of relative(root, destination).split(sep)) {
    current = resolve(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Legacy PDF alias cannot follow symbolic links");
      if (current !== destination && !info.isDirectory()) throw new Error("Legacy PDF parent must be a directory");
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") break;
      throw error;
    }
  }
  return destination;
}

/** Explicit aliases are emitted only for retained public presentations; this never fetches private objects. */
export function legacyDownloadAliasPublisher(output, documentRoutes) {
  if (documentRoutes) validateDocumentRoutes(documentRoutes);
  const aliases = new Map();
  return async (document, route) => {
    const links = [...document.querySelectorAll("a[data-legacy-download-url]")];
    if (links.length > 1000) throw new Error("A page exceeds the historical download alias limit");
    if (!links.length) return [];
    const outputInfo = await lstat(resolve(output));
    if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink())
      throw new Error("Legacy PDF release root must be a regular directory");
    const root = await realpath(output);
    const published = [];
    for (const link of links) {
      const aliasUrl = link.getAttribute("data-legacy-download-url");
      const alias = localPdfPath(aliasUrl, "/events/");
      const bound = boundDocumentRedirect(documentRoutes, aliasUrl);
      if (bound) {
        const paired = boundDocumentRedirect(documentRoutes, `/content-media${aliasUrl}`);
        if (link.getAttribute("href") !== bound.to && link.getAttribute("href") !== paired?.from)
          throw new Error("Historical document link conflicts with its verified canonical redirect");
        continue;
      }
      const source = localPdfPath(link.getAttribute("href"), "/content-media/events/");
      if (source.slice("content-media/".length) !== alias)
        throw new Error("Legacy PDF alias must retain its exact public source filename");
      const eventDirectory = dirname(alias);
      if (dirname(source).slice("content-media/".length) !== eventDirectory || !route.startsWith(`/${eventDirectory}/`))
        throw new Error("Legacy PDF alias must retain a presentation in the same event directory");
      const prior = aliases.get(alias.toLowerCase());
      if (prior && (prior.alias !== alias || prior.source !== source))
        throw new Error("Legacy PDF alias has conflicting paths or source files");
      const sourcePath = await confinedPath(root, source);
      const evidence = await digestPdf(sourcePath);
      const destination = await confinedPath(root, alias, true);
      let existing = null;
      try {
        existing = await digestPdf(destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (existing) {
        if (existing.sourceDigest !== evidence.sourceDigest || existing.bytes !== evidence.bytes)
          throw new Error("Legacy PDF alias collides with different published bytes");
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await confinedPath(root, alias, true);
        const sourceFile = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes;
        try {
          const current = await sourceFile.stat();
          if (!current.isFile() || current.size !== evidence.bytes)
            throw new Error("Legacy PDF changed before publication");
          const bounded = Buffer.alloc(evidence.bytes + 1);
          let length = 0;
          while (length < bounded.length) {
            const { bytesRead } = await sourceFile.read(bounded, length, bounded.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
          }
          bytes = bounded.subarray(0, length);
          if (
            bytes.length !== evidence.bytes ||
            createHash("sha256").update(bytes).digest("hex") !== evidence.sourceDigest
          )
            throw new Error("Legacy PDF changed before publication");
        } finally {
          await sourceFile.close();
        }
        const target = await open(
          destination,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o644,
        );
        try {
          await target.writeFile(bytes);
        } finally {
          await target.close();
        }
      }
      aliases.set(alias.toLowerCase(), { alias, source });
      published.push(alias);
    }
    return [...new Set(published)];
  };
}
