import { publicationRepairAliasPaths } from "../../assets/shared/schemas/site-publication-repair-aliases.ts";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url.ts";
import { publicationDocumentFilePath as documentFilePath } from "../../assets/shared/publication-document-path.ts";
import { verifyCurrentDocumentRepairAliases, appendDocumentRepairAliases } from "./document-repair-aliases.mjs";
import { constants } from "node:fs";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import {
  PUBLICATION_DOCUMENT_ROUTES_PATH,
  sitePublicationDocumentRoutesSchema,
} from "../../assets/shared/schemas/site-publication-release.ts";
import { parseSessionRecordingPublicUrl } from "../../assets/shared/session-recording-public-url.ts";
import { publicSessionMaterials } from "../../assets/shared/schemas/event-session-history.ts";
import { parseSessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url.ts";
import { verifiedSessionMaterialLegacyDownload } from "../../assets/shared/session-material-legacy-download.ts";
import { publicationDocumentGrantHashInput } from "../../assets/shared/schemas/site-publication-documents.ts";

export { documentFilePath };

function snapshotDocumentRoutes(snapshot, verify) {
  const redirects = [];
  const retiredPaths = [];
  const owners = new Set();
  const documents = [];
  for (const [eventSlug, agenda] of Object.entries(snapshot.eventAgendas ?? {})) {
    for (const occurrence of agenda.occurrences) {
      for (const material of occurrence.history?.materials ?? []) {
        if (
          material.kind === "presentation" &&
          material.presentationSource === "session" &&
          material.status === "approved" &&
          material.rightsConfirmed &&
          material.consentConfirmed &&
          material.validated &&
          material.approvedAt
        ) {
          const canonical = parseSessionPresentationPublicUrl(material.url);
          if (
            !canonical ||
            canonical.eventSlug !== eventSlug ||
            canonical.occurrenceId !== occurrence.id ||
            canonical.versionId !== material.presentationVersionId
          )
            throw new Error("Published PDF selection lacks its canonical URL");
          documents.push({
            url: material.url,
            grantId: createHash("sha256")
              .update(
                publicationDocumentGrantHashInput({
                  ...canonical,
                  materialId: material.id,
                  approvedAt: material.approvedAt,
                  approvalNonce: material.approvalNonce ?? null,
                }),
              )
              .digest("hex"),
          });
        }
        if (
          material.kind === "recording" &&
          material.recordingVersionId &&
          publicSessionMaterials([material]).length === 1
        ) {
          const canonical = parseSessionRecordingPublicUrl(material.url);
          if (
            !canonical ||
            canonical.eventSlug !== eventSlug ||
            canonical.occurrenceId !== occurrence.id ||
            canonical.materialId !== material.id ||
            canonical.versionId !== material.recordingVersionId
          )
            throw new Error("Published recording selection lacks its canonical URL");
          documents.push({
            url: material.url,
            grantId: createHash("sha256")
              .update(
                publicationDocumentGrantHashInput({
                  ...canonical,
                  kind: "recording",
                  approvedAt: material.approvedAt,
                  approvalNonce: material.approvalNonce ?? null,
                }),
              )
              .digest("hex"),
          });
        }
        if (!material.legacyDownloadUrl || material.status !== "approved") continue;
        if (!material.rightsConfirmed || !material.consentConfirmed || !material.validated || !material.approvedAt)
          throw new Error("Historical document selection lacks publication approval");
        const target = parseSessionPresentationPublicUrl(material.url);
        const selected = occurrence.history.legacyDownloads?.find(({ url }) => url === material.legacyDownloadUrl);
        if (!target || target.eventSlug !== eventSlug || target.occurrenceId !== occurrence.id || !selected?.pdfBytes)
          throw new Error("Historical document selection lacks an exact canonical receipt");
        const receipt = verifiedSessionMaterialLegacyDownload(material, occurrence.history.legacyDownloads, {
          id: target.versionId,
          versionNumber: material.version,
          sourceDigest: target.digest,
          fileSize: selected.pdfBytes,
          mimeType: "application/pdf",
        });
        if (!receipt) throw new Error("Historical document receipt does not match selected canonical bytes");
        verify(occurrence, material, receipt, target);
        if (owners.has(receipt.url)) throw new Error("Historical document route has multiple owners");
        owners.add(receipt.url);
        for (const from of [receipt.url, receipt.targetUrl]) {
          redirects.push({ from, to: material.url, status: 302 });
          retiredPaths.push({ path: documentFilePath(from), sha256: target.digest, bytes: receipt.pdfBytes });
        }
      }
    }
  }
  return validateDocumentRoutes({
    version: 1,
    snapshotId: snapshot.snapshotId,
    sourceSequence: snapshot.sourceSequence ?? null,
    documents: documents.sort((a, b) => a.url.localeCompare(b.url)),
    redirects: redirects.sort((a, b) => a.from.localeCompare(b.from)),
    retiredPaths: retiredPaths.sort((a, b) => a.path.localeCompare(b.path)),
  });
}

/** Only native verified documents can turn an explicitly selected receipt into redirects. */
export function collectDocumentRedirects(
  snapshot,
  documents,
  retained = [],
  recordings = [],
  repairs = [],
  retainedRepairs = [],
) {
  const current = snapshotDocumentRoutes(snapshot, (occurrence, material, receipt, target) => {
    const matches = documents.filter(
      (document) => document.occurrenceId === occurrence.id && document.materialId === material.id,
    );
    const document = matches[0];
    if (
      matches.length !== 1 ||
      !document?.objectEtag ||
      document.versionId !== target.versionId ||
      document.digest !== target.digest ||
      document.fileSize !== receipt.pdfBytes ||
      JSON.stringify(receipt) !== JSON.stringify(document.legacyDownload)
    )
      throw new Error("Historical document selection lacks exact native byte verification");
  });
  for (const selection of current.documents) {
    const recording = parseSessionRecordingPublicUrl(selection.url);
    const target = recording ?? parseSessionPresentationPublicUrl(selection.url);
    const candidates = recording ? recordings : documents;
    const matches = candidates.filter(
      (document) =>
        (!recording || document.eventSlug === target.eventSlug) &&
        document.occurrenceId === target.occurrenceId &&
        document.versionId === target.versionId &&
        document.digest === target.digest &&
        (!recording || document.materialId === recording.materialId),
    );
    if (
      matches.length !== 1 ||
      !matches[0].objectEtag ||
      (matches[0].grantId && matches[0].grantId !== selection.grantId)
    )
      throw new Error(
        recording
          ? "Published recording selection lacks exact native verification"
          : "Published PDF selection lacks exact native verification",
      );
  }
  const aliases = verifyCurrentDocumentRepairAliases(snapshot, repairs, documents);
  return appendDocumentRepairAliases(
    appendRetainedDocumentRoutes(current, documents, retained),
    aliases,
    retainedRepairs,
    documentFilePath,
    validateDocumentRoutes,
  );
}

function appendRetainedDocumentRoutes(current, documents, retained) {
  const rules = new Map(current.redirects.map((entry) => [entry.from, entry]));
  const paths = new Map(current.retiredPaths.map((entry) => [entry.path, entry]));
  for (const document of retained) {
    const receipt = document.legacyDownload;
    const target = parseSessionPresentationPublicUrl(document.url);
    if (
      !target ||
      target.occurrenceId !== document.occurrenceId ||
      target.versionId !== document.versionId ||
      target.digest !== document.digest ||
      receipt.pdfDigest !== document.digest ||
      !receipt.pdfBytes
    )
      throw new Error("Retained document receipt does not bind its canonical tuple");
    const selected = documents.find((item) => item.legacyDownload?.url === receipt.url);
    if (
      selected &&
      (selected.eventId !== document.eventId ||
        selected.occurrenceId !== document.occurrenceId ||
        selected.materialId !== document.materialId ||
        JSON.stringify(selected.legacyDownload) !== JSON.stringify(receipt))
    )
      throw new Error("Current document binding conflicts with retained ownership or bytes");
    for (const from of [receipt.url, receipt.targetUrl]) {
      const path = documentFilePath(from);
      const previous = paths.get(path);
      if (previous && (previous.sha256 !== receipt.pdfDigest || previous.bytes !== receipt.pdfBytes))
        throw new Error("Document route replacement conflicts with historical owned bytes");
      if (!rules.has(from)) rules.set(from, { from, to: document.url, status: 302 });
      paths.set(path, { path, sha256: receipt.pdfDigest, bytes: receipt.pdfBytes });
    }
  }
  return validateDocumentRoutes({
    ...current,
    redirects: [...rules.values()].sort((a, b) => a.from.localeCompare(b.from)),
    retiredPaths: [...paths.values()].sort((a, b) => a.path.localeCompare(b.path)),
  });
}

/** Recheck staged public metadata against the selected snapshot before any static retirement. */
export function assertDocumentRoutesSnapshot(snapshot, value, retained = [], repairs = [], retainedRepairs = []) {
  const routes = validateDocumentRoutes(value);
  const aliases = verifyCurrentDocumentRepairAliases(snapshot, repairs);
  const expected = appendDocumentRepairAliases(
    appendRetainedDocumentRoutes(
      snapshotDocumentRoutes(snapshot, () => {}),
      [],
      retained,
    ),
    aliases,
    retainedRepairs,
    documentFilePath,
    validateDocumentRoutes,
  );
  if (JSON.stringify(routes) !== JSON.stringify(expected))
    throw new Error("Document routes do not match the selected publication snapshot");
  return routes;
}

/** Public metadata must describe exactly paired authored/source paths and the same canonical bytes. */
export function validateDocumentRoutes(value, release) {
  const routes = sitePublicationDocumentRoutesSchema.parse(value);
  const paths = new Map(routes.retiredPaths.map((entry) => [entry.path, entry]));
  const rules = new Map(routes.redirects.map((entry) => [entry.from, entry]));
  const decoded = new Set();
  for (const alias of routes.repairAliases) {
    for (const from of publicationRepairAliasPaths(alias)) {
      const rule = rules.get(from);
      const bytes = paths.get(documentFilePath(from));
      if (
        !rule ||
        rule.to !== sessionPresentationPublicUrl(alias) ||
        !bytes ||
        bytes.sha256 !== alias.digest ||
        bytes.bytes !== alias.bytes
      )
        throw new Error("Repair alias evidence disagrees with its owned document routes");
    }
  }
  for (const rule of routes.redirects) {
    const path = documentFilePath(rule.from);
    const key = path.toLowerCase();
    if (decoded.has(key)) throw new Error("Document redirects have colliding decoded paths");
    decoded.add(key);
    const receipt = paths.get(path);
    const canonical = parseSessionPresentationPublicUrl(rule.to);
    const pairedUrl = rule.from.startsWith("/content-media/")
      ? rule.from.slice("/content-media".length)
      : `/content-media${rule.from}`;
    const paired = rules.get(pairedUrl);
    const pairedReceipt = paths.get(documentFilePath(pairedUrl));
    if (
      !receipt ||
      !canonical ||
      receipt.sha256 !== canonical.digest ||
      !paired ||
      paired.to !== rule.to ||
      !pairedReceipt ||
      pairedReceipt.sha256 !== receipt.sha256 ||
      pairedReceipt.bytes !== receipt.bytes
    )
      throw new Error("Document redirects and exact retired byte pairs disagree");
  }
  if (paths.size !== rules.size) throw new Error("Document retirement inventory contains an unowned path");
  if (release) {
    if (routes.snapshotId !== release.snapshotId || routes.sourceSequence !== release.sourceSequence)
      throw new Error("Document routes do not identify this release");
    const canonicalRules = release.redirects.filter(({ to }) => parseSessionPresentationPublicUrl(to));
    if (
      JSON.stringify(canonicalRules.slice().sort((a, b) => a.from.localeCompare(b.from))) !==
      JSON.stringify(routes.redirects.slice().sort((a, b) => a.from.localeCompare(b.from)))
    )
      throw new Error("Release document redirects differ from integrity-owned routes");
    if (
      !release.integrity?.files[PUBLICATION_DOCUMENT_ROUTES_PATH] ||
      !release.files.includes(PUBLICATION_DOCUMENT_ROUTES_PATH)
    )
      throw new Error("Document routes require integrity-owned release bytes");
    for (const path of paths.keys()) {
      if (release.files.includes(path) || release.integrity.files[path])
        throw new Error("Retired document bytes cannot remain owned by the release");
    }
  }
  return routes;
}

/** Bound copies must also be skipped by generic and explicit DOM download publishers. */
export function boundDocumentRedirect(routes, url) {
  if (!routes?.redirects.length) return null;
  const rule = routes.redirects.find(({ from }) => from === url);
  if (rule) return rule;
  let decoded;
  try {
    decoded = decodeURIComponent(url).slice(1).toLowerCase();
  } catch {
    return null;
  }
  if (routes.retiredPaths.some(({ path }) => path.toLowerCase() === decoded))
    throw new Error("Download encoding conflicts with an exact document redirect");
  return null;
}

/** Validate the complete provider rule set before retiring bytes or replacing a release. */
export function validateDocumentRedirectRules(entries, routes, retained = "") {
  const rules = retained
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to, status = "302", extra] = line.split(/\s+/u);
      if (!from || !to || extra || !/^(?:200|30[12378])$/u.test(status))
        throw new Error("Invalid retained redirect rule");
      return { from, to, status: Number(status) };
    })
    .concat(entries);
  let dynamic = 0;
  const sources = new Set();
  const targets = new Map();
  for (const { from, to, status } of rules) {
    if (Buffer.byteLength(`${from} ${to} ${status}`, "utf8") > 1000)
      throw new Error("Redirect exceeds provider line limit");
    if (sources.has(from)) throw new Error("Redirect source has conflicting provider rules");
    sources.add(from);
    if (/\*|:[a-z]/iu.test(from)) dynamic++;
    else targets.set(from, to);
    if (from === to) throw new Error("Document redirect loop");
    const bound = boundDocumentRedirect(routes, from);
    if (bound && (to !== bound.to || status !== 302)) throw new Error("Provider rule conflicts with document redirect");
    if (parseSessionPresentationPublicUrl(to) && !bound) throw new Error("Unowned canonical document redirect");
  }
  if (dynamic > 100 || rules.length - dynamic > 2000) throw new Error("Redirect inventory exceeds provider limits");
  for (const source of targets.keys()) {
    const visited = new Set();
    let target = source;
    while (targets.has(target)) {
      if (visited.has(target)) throw new Error("Document redirect loop");
      visited.add(target);
      target = targets.get(target);
    }
  }
  // A redirect on the canonical API path would prevent its live delivery guard from running.
  for (const { to } of routes.redirects) {
    for (const { from } of rules) {
      const pattern = from
        .split(/(\*|:[a-z][a-z0-9_]*)/iu)
        .map((part) => (/^\*|^:/u.test(part) ? ".*" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
        .join("");
      if (new RegExp(`^${pattern}$`, "u").test(to)) throw new Error("Canonical document destination is redirected");
    }
  }
}

async function confinedDocumentPath(root, path) {
  const directory = resolve(root);
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Document release root must be a regular directory");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let current = directory;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if (!current.startsWith(`${directory}${sep}`)) throw new Error("Document retirement escapes the release");
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (current !== resolve(directory, path) && !info.isDirectory()))
        throw new Error("Document retirement cannot follow symlinks or unsafe parents");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return current;
}

async function verifyRetiredDocument(root, receipt) {
  const path = await confinedDocumentPath(root, receipt.path);
  if (!path) return null;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== receipt.bytes) throw new Error("Retired document conflicts with owned bytes");
    const hash = createHash("sha256");
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > receipt.bytes) throw new Error("Retired document exceeds owned byte count");
      if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5);
      hash.update(chunk);
    }
    if (bytes !== receipt.bytes || prefix.toString("ascii") !== "%PDF-" || hash.digest("hex") !== receipt.sha256)
      throw new Error("Retired document conflicts with owned PDF digest");
    return path;
  } finally {
    await handle.close();
  }
}

/** Verify every candidate before any deletion; a different or unknown file is never removed. */
export async function prepareDocumentRetirement(roots, routes) {
  const candidates = [];
  for (const root of roots) {
    for (const receipt of routes.retiredPaths) {
      if (await verifyRetiredDocument(root, receipt)) candidates.push({ root, receipt });
    }
  }
  return async () => {
    // Recheck all byte receipts and ancestors before deleting the first file.
    for (const { root, receipt } of candidates) await verifyRetiredDocument(root, receipt);
    for (const { root, receipt } of candidates) {
      const path = await confinedDocumentPath(root, receipt.path);
      if (path) await rm(path);
    }
    for (const root of roots) {
      for (const { path } of routes.retiredPaths) {
        if (await confinedDocumentPath(root, path)) throw new Error("Retired static document remains in release");
      }
    }
  };
}

export async function readReleaseDocumentRoutes(root, release) {
  let value;
  try {
    value = await readFile(resolve(root, PUBLICATION_DOCUMENT_ROUTES_PATH), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (release.redirects.some(({ to }) => parseSessionPresentationPublicUrl(to)))
      throw new Error("Canonical document routes are missing", { cause: error });
    return sitePublicationDocumentRoutesSchema.parse({
      version: 1,
      snapshotId: release.snapshotId,
      sourceSequence: release.sourceSequence,
      redirects: [],
      retiredPaths: [],
    });
  }
  return validateDocumentRoutes(JSON.parse(value), release);
}
