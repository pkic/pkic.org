import { publicationAuthoredAgendaRoutes } from "../../assets/shared/publication-agenda-routes.ts";
import { agendaTransferDigest } from "../../assets/shared/event-agenda-transfer.ts";
import { conferenceProgramSourceSchema } from "../../assets/shared/schemas/conference-program.ts";
import { contentMediaUrl } from "../../assets/shared/content-media-url.ts";
import { contentPathToRoute, parseFrontMatter } from "../../functions/_lib/services/site-markdown.ts";
import { digestPdf } from "../lib/legacy-agenda-media.mjs";
import { legacyDownloadAliasPublisher } from "./publish-legacy-download-aliases.mjs";
import { boundDocumentRedirect } from "./collect-document-redirects.mjs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";

/** Repository source files must stay within their exact authored bundle, without symbolic links. */
async function regularSourcePath(root, path) {
  const target = resolve(root, path);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Authored download escapes its source root");
  let current = root;
  for (const component of relative(root, target).split(sep)) {
    current = resolve(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (current === target ? !info.isFile() : !info.isDirectory()))
      throw new Error("Authored download source must be a regular confined file");
  }
  return target;
}

/** Retain authored public references independently of the current canonical material release state. */
export async function authoredAgendaDownloadReferences(publication, projectRoot = ".") {
  const root = resolve(projectRoot);
  const references = [];
  for (const owner of publicationAuthoredAgendaRoutes(publication)) {
    const source = await regularSourcePath(root, owner.sourcePath);
    const { data } = parseFrontMatter(await readFile(source, "utf8"));
    if (
      data.draft === true ||
      !data.data ||
      contentPathToRoute(source, data) !== owner.route ||
      (await agendaTransferDigest(data.data)) !== owner.sourceDigest
    )
      throw new Error("Authored public download source changed since archival review");
    const program = conferenceProgramSourceSchema.parse(data.data);
    if (program.draft === true) throw new Error("Draft conference downloads are not a public baseline");
    const directory = dirname(owner.sourcePath.slice("content/".length));
    const presentations = new Set(
      Object.values(program.agenda).flatMap((slots) =>
        slots.flatMap((slot) =>
          slot.sessions.flatMap((session) => (session.presentation ? [session.presentation] : [])),
        ),
      ),
    );
    if (presentations.size > 1000) throw new Error("Authored agenda exceeds the download reference limit");
    for (const reference of presentations) {
      // A missing exact filename is unresolved; patterns, substitutions and remote files establish no old path.
      if (
        !/\.pdf$/iu.test(reference) ||
        /[\\%?#*\p{Cc}]/u.test(reference) ||
        reference.split("/").some((part) => !part || part === "." || part === "..")
      )
        continue;
      const sourcePath = `content/${directory}/${reference}`;
      try {
        await regularSourcePath(root, sourcePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const targetUrl = contentMediaUrl(`${directory}/${reference}`);
      references.push({ sourcePath, targetUrl, url: targetUrl.slice("/content-media".length), route: owner.route });
    }
  }
  return references;
}

/** Use the existing exact-byte alias publisher and canonical redirect supersession rules. */
export async function publishAuthoredAgendaDownloads(output, publication, documentRoutes, projectRoot = ".") {
  const publish = legacyDownloadAliasPublisher(output, documentRoutes);
  const published = new Set();
  for (const reference of await authoredAgendaDownloadReferences(publication, projectRoot)) {
    if (!boundDocumentRedirect(documentRoutes, reference.url)) {
      const source = await regularSourcePath(resolve(projectRoot), reference.sourcePath);
      const original = await digestPdf(source);
      const stagedPath = await regularSourcePath(resolve(output), decodeURIComponent(reference.targetUrl).slice(1));
      const staged = await digestPdf(stagedPath);
      if (original.sourceDigest !== staged.sourceDigest || original.bytes !== staged.bytes)
        throw new Error("Authored public download bytes differ from the exact source file");
    }
    const dom = new JSDOM("");
    try {
      const link = dom.window.document.createElement("a");
      link.setAttribute("href", reference.targetUrl);
      link.setAttribute("data-legacy-download-url", reference.url);
      dom.window.document.body.append(link);
      for (const path of await publish(dom.window.document, reference.route)) published.add(path);
    } finally {
      dom.window.close();
    }
  }
  return [...published];
}
