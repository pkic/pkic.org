import {
  publicationRepairAliasesSchema,
  publicationRepairAliasPaths,
} from "../../assets/shared/schemas/site-publication-repair-aliases.ts";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url.ts";
import { publicSessionMaterials } from "../../assets/shared/schemas/event-session-history.ts";

/** The snapshot and native verified document must both select the explicitly reviewed owner. */
export function verifyCurrentDocumentRepairAliases(snapshot, input, documents) {
  const aliases = publicationRepairAliasesSchema.parse(input);
  for (const alias of aliases) {
    const agenda = snapshot.eventAgendas?.[alias.eventSlug];
    const occurrence = agenda?.occurrences.find((item) => item.id === alias.occurrenceId);
    const material = occurrence?.history?.materials.find((item) => item.id === alias.materialId);
    if (
      !material ||
      publicSessionMaterials([material]).length !== 1 ||
      material.presentationSource !== "session" ||
      material.presentationVersionId !== alias.versionId ||
      material.url !== sessionPresentationPublicUrl(alias)
    )
      throw new Error("Repair alias does not match the selected approved document");
    if (documents) {
      const matches = documents.filter(
        (document) =>
          document.eventId === alias.eventId &&
          document.occurrenceId === alias.occurrenceId &&
          document.materialId === alias.materialId,
      );
      const document = matches[0];
      if (
        matches.length !== 1 ||
        !document.objectEtag ||
        document.versionId !== alias.versionId ||
        document.digest !== alias.digest ||
        document.fileSize !== alias.bytes ||
        JSON.stringify(document.repairAliases) !== JSON.stringify([alias])
      )
        throw new Error("Repair alias lacks exact native byte and source verification");
    }
  }
  return aliases;
}

/** Previously activated repairs retain their denial-safe routes after withdrawal. */
export function appendDocumentRepairAliases(current, active, retained, documentFilePath, validate) {
  const aliases = publicationRepairAliasesSchema.parse(active);
  const previous = publicationRepairAliasesSchema.parse(retained);
  const rules = new Map(current.redirects.map((rule) => [rule.from, rule]));
  const paths = new Map(current.retiredPaths.map((path) => [path.path, path]));
  const owners = new Map();
  const originalRules = new Set(rules.keys());
  const evidence = new Map();
  for (const alias of [...aliases, ...previous]) {
    const to = sessionPresentationPublicUrl(alias);
    const owner = JSON.stringify(alias);
    evidence.set(owner, alias);
    for (const from of publicationRepairAliasPaths(alias)) {
      const path = documentFilePath(from);
      if (originalRules.has(from)) throw new Error("Repair alias conflicts with a historical download route");
      const owned = owners.get(path);
      if (owned && owned !== owner) throw new Error("Repair alias has conflicting owners");
      owners.set(path, owner);
      const rule = rules.get(from);
      const bytes = paths.get(path);
      if ((rule && rule.to !== to) || (bytes && (bytes.sha256 !== alias.digest || bytes.bytes !== alias.bytes)))
        throw new Error("Repair alias conflicts with an existing document route or bytes");
      rules.set(from, { from, to, status: 302 });
      paths.set(path, { path, sha256: alias.digest, bytes: alias.bytes });
    }
  }
  return validate({
    ...current,
    repairAliases: [...evidence.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
    redirects: [...rules.values()].sort((left, right) => left.from.localeCompare(right.from)),
    retiredPaths: [...paths.values()].sort((left, right) => left.path.localeCompare(right.path)),
  });
}
