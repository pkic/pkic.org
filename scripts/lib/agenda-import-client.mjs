import {
  agendaTransferSchema,
  transferResolutionSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../../assets/shared/schemas/event-agenda-transfer.ts";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda.ts";

/** @typedef {import('zod').infer<typeof agendaTransferSchema>} Document */
/** @typedef {import('zod').infer<typeof transferResolutionSchema>} Resolutions */
/** @typedef {{part:number, revision:number, ready:boolean, imported:number, skipped:number, applied:boolean, findings:Array<{code:string,severity:string,count:number}>}} ImportSummary */
/**
 * Review sequential bounded documents; writes require explicit application and acknowledgements.
 * @param {{baseUrl:string,eventSlug:string,token:string,documents:Document[],resolutions?:Resolutions,mode?:'archive'|'copy_as_new',apply?:boolean,acknowledgeInferredTiming?:boolean,acknowledgeArchiveRepresentation?:boolean,fetcher?:typeof fetch,onSummary?:(summary:ImportSummary)=>void}} options
 */
export async function importPreparedAgenda(options) {
  const origin = new URL(options.baseUrl);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("Base URL must be an origin without credentials, path, query or fragment.");
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  )
    throw new Error("Use HTTPS or a local HTTP origin.");
  if (!options.token || /[\r\n]/u.test(options.token))
    throw new Error("Supply the token through PKIC_AGENDA_IMPORT_TOKEN.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(options.eventSlug))
    throw new Error("Supply a valid destination event slug.");
  if (!options.documents.length) throw new Error("Supply at least one prepared document.");
  const documents = options.documents.map((document) => agendaTransferSchema.parse(document));
  const resolutions = transferResolutionSchema.parse(
    options.resolutions ?? { people: {}, rooms: {}, media: {}, rows: {} },
  );
  const fetcher = options.fetcher ?? fetch;
  const base = new URL(`/api/v1/events/${encodeURIComponent(options.eventSlug)}/agenda`, origin);
  /** @param {string} suffix @param {unknown} [body] */
  async function request(suffix, body) {
    let response;
    try {
      response = await fetcher(`${base}${suffix}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
      });
    } catch {
      throw new Error("Agenda request failed before receiving a response.");
    }
    if (!response.ok) {
      let code = "REQUEST_FAILED";
      try {
        const error = await response.json();
        if (typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,100}$/u.test(error.code)) code = error.code;
      } catch {
        /* Never report response contents. */
      }
      throw new Error(`Agenda request failed: HTTP ${response.status} ${code}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Agenda returned invalid JSON.");
    }
  }
  /** @type {ImportSummary[]} */
  const summaries = [];
  for (const [index, document] of documents.entries()) {
    const snapshot = agendaSnapshotSchema.parse(await request(""));
    const prepared = transferPrepareSchema.parse({
      expectedRevision: snapshot.revision,
      mode: options.mode ?? "archive",
      document,
      resolutions,
    });
    const review = transferReviewSchema.parse(await request("/transfers/reviews", prepared));
    /** @type {Map<string,{code:string,severity:string,count:number}>} */
    const grouped = new Map();
    for (const finding of review.findings) {
      const key = `${finding.code}:${finding.severity}`;
      const group = grouped.get(key) ?? { code: finding.code, severity: finding.severity, count: 0 };
      group.count++;
      grouped.set(key, group);
    }
    const summary = {
      part: index + 1,
      revision: snapshot.revision,
      ready: review.ready,
      imported: review.imported,
      skipped: review.skipped,
      applied: false,
      findings: [...grouped.values()],
    };
    options.onSummary?.(summary);
    if (!review.ready) throw new Error(`Part ${index + 1} has unresolved blocking findings.`);
    if (options.apply) {
      if (review.findings.some((finding) => finding.code === "timing_inferred") && !options.acknowledgeInferredTiming)
        throw new Error("Explicit --acknowledge-inferred-timing is required.");
      if (
        prepared.mode === "archive" &&
        document.occurrences.some((row) => row.archive) &&
        !options.acknowledgeArchiveRepresentation
      )
        throw new Error("Explicit --acknowledge-archive-representation is required.");
      if (
        review.findings.some(
          (finding) =>
            finding.severity === "review" &&
            finding.code !== "timing_inferred" &&
            (!finding.rowRef || !resolutions.rows[finding.rowRef]),
        )
      )
        throw new Error("Review findings require explicit row decisions in the resolutions file.");
      const result = transferApplyResponseSchema.parse(
        await request(
          "/transfers",
          transferApplySchema.parse({
            ...prepared,
            reviewDigest: review.digest,
            acknowledgeInferredTiming: options.acknowledgeInferredTiming ?? false,
            acknowledgeArchiveRepresentation: options.acknowledgeArchiveRepresentation ?? false,
          }),
        ),
      );
      summary.applied = true;
      summary.revision = result.agenda.revision;
      summary.imported = result.imported;
      summary.skipped = result.skipped;
      options.onSummary?.(summary);
    }
    summaries.push(summary);
  }
  return summaries;
}
