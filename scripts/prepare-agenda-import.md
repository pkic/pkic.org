# Preparing historical agendas

This temporary tool converts event Markdown front matter or standalone YAML into the existing agenda transfer format. It prepares reviewable documents; it does not create database records, upload files, approve historical credits, or publish an agenda.

Use Node 22.15 or newer and install the repository dependencies with pnpm.

```sh
node --experimental-strip-types scripts/prepare-agenda-import.mjs \
  content/events/2023/post-quantum-cryptography-conference/index.md \
  /path/to/reviewed-mappings.json /path/to/output/agenda.json
```

Mappings must explicitly identify the existing event (`event.eventId` and `event.eventSlug`), canonical room IDs (`roomIds`), and canonical speaker user IDs (`speakerUserIds`). Names are source references, never an instruction to create or automatically match a person. Preparation does not check a database revision; fetch the target agenda revision when preparing the actual review request.

For local slides, provide reviewed `presentationUrls` or a `publicBasePath` that exactly matches the event's existing `/content-media/events/...` static asset path. The tool resolves unique PDF filenames and single-level glob references, checks the PDF bytes, and records SHA-256 digests. Missing, ambiguous, unsafe, or unresolved paths require review. It does not download remote assets. Recording references accept public URLs or YouTube IDs with an optional `?start=SECONDS` offset.

Authored speaker biographies and titles remain historical review candidates. To include approved historical credits, use `historicalPeople` mappings with `userId`, an explicitly selected `actingIdentityId` (including explicit `null`), and the actual `approvedAt` timestamp. Optional `organizationName`, `jobTitle`, `biography`, and `photoUrl` describe the approved historical representation. Never infer an employer from a job title or invent approval dates. Slide and recording release approval remains a separate backend review.

Publication requires an explicitly approved representation for every canonical speaker, including standalone and copied sessions. Unmapped source-only credits and `title_not_recorded` or `credit_not_recorded` decisions preserve incomplete evidence in the draft; they block publication until verified mappings resolve the missing attribution or title. A known historical start with an unknown end remains valid archival timing and does not require an invented end.

For multiple events, supply a JSON manifest containing an `events` array. Each entry has `sourcePath`, `mappingPath`, and optionally a unique simple `outputName`. Input paths are relative to the manifest file.

```sh
node --experimental-strip-types scripts/prepare-agenda-import.mjs \
  --batch /path/to/manifest.json /path/to/output-directory
```

For single-file preparation, create the output parent directory first. Batch preparation creates its output directory.

Each event produces transfer documents with at most 100 occurrences, a report of unresolved references, historical candidates, and resolved assets. The batch manifest records preparation status. `ready` means preparation has no reported unresolved items; it does not prove that target IDs exist or that data has been applied.

Before applying, verify the event and rooms in the target database. Review each document through the existing agenda transfer API or portal, resolve conflicts, and apply the reviewed result. Refresh `expectedRevision` between parts. Reconcile source and target sessions, slides, recordings, and historical credits after application. Keep the reports until the target cutover has been verified; preparation reports always retain `applied: false`.

## Reviewing and applying prepared documents

Set `PKIC_AGENDA_IMPORT_TOKEN` through your environment using an authorized session token. Keep it out of command arguments, mappings, reports, and source control.

Review without applying:

```sh
node --experimental-strip-types scripts/import-agenda.mjs \
  --base-url https://your-target.example \
  --event existing-event-slug \
  --document /path/to/output/agenda.json
```

Repeat `--document` for prepared parts in order. The tool fetches the current target revision before reviewing each part and reports counts and finding codes. Source provenance may differ from the destination slug. An adjacent `.report.json`, when present, must report no unresolved preparation findings. Valid portable transfers can be reviewed without a preparation report.

To apply, add `--apply`. Inferred timing and historical representation require the corresponding explicit `--acknowledge-inferred-timing` and `--acknowledge-archive-representation` flags when the review requires them. Supply reviewed people, room, media and row decisions with `--resolutions /path/to/resolutions.json`; the file uses the existing transfer resolution contract. The tool refuses unresolved findings and never assumes permission to overwrite an organizer edit.

The default `--mode archive` retains source identities for reconciliation. Use `--mode copy_as_new` deliberately to create independent new-event content. Mutation failures stop the run without automatic retries. Rerunning an archive import uses the server's existing source-key reconciliation and local-edit protection. This command does not upload PDFs, create target events or rooms, approve material release, or publish the website.

## Resumable historical PDF uploads

After the agenda transfer has been reviewed and applied, map each resolved report asset's `authoredReference` to its verified canonical occurrence UUID. The mapping file is a JSON object, for example `{ "slides*.pdf": "<occurrence UUID>" }`. Keep one mapping/report pair per event. The preparation report retains authored source, original public URL, exact PDF size and SHA-256; the upload receipt additionally records the actual repository-relative PDF path and destination version.

Review locally before any upload:

```sh
node --experimental-strip-types scripts/import-agenda-media.mjs \
  --report ./review/event.json.report.json \
  --mappings ./review/material-occurrences.json \
  --repository-root ./ \
  --base-url https://preview.pkic.org --event event-slug \
  --receipts ./review/material-receipts.json
```

The default verifies every mapped local PDF and reports its provenance without network requests. Add `--apply` with `PKIC_AGENDA_IMPORT_TOKEN` to upload private draft versions through the existing session presentation API and compensated R2 lifecycle. Run one process per receipt file. The tool saves receipts atomically before and after each attempt and stops on a failure. Resume with the same inputs: it reconciles matching server source/digest metadata; if a lost response or pagination hides the matching version, the same source/digest upload safely returns the existing version. A changed PDF requires fresh preparation evidence and creates a separate draft. A deleted matching source requires organizer review rather than silently recreating it.

An uploaded draft is not approved or public. This command does not change authored public URLs, remove the old PDF, publish an agenda, or claim that historical migration is complete. Keep the existing linked download publication path until reviewed release and verified redirects/aliases provide an explicit cutover. Reconcile source counts, canonical occurrences, historical credits, recordings, material versions and public links separately before declaring completion.

For an already public historical source, explicitly set `archivePublicSource: true` in reviewed mappings to retain unmatched authored speakers as source-only archival credits. These preserve exact attribution and source digest, create no user or acting identity, and assert no historical approval or permission. Only archive review with a completed past interval accepts these credits; future scheduling and copy-as-new still require canonical people. The review reports that availability cannot be checked for unlinked credits. A verified canonical link must replace the source-only credit explicitly. For an unknown final end in that explicitly selected public archive, retain the authored start in `archivalTiming`; the canonical scheduled interval stays empty and the review requires a past start and exact provenance. No duration or calendar ending is invented. Ordinary preparation without this selection still reports the missing duration for review.

Headshot preparation inventories the same `speakers/<authored ID or shared name slug>.*` paths as the static source renderer. Exact PNG/JPEG/WebP matches include original public path, byte length and SHA-256 in the separate `headshots` report. Duplicate source names, ambiguous files, missing photos and invalid bytes remain visible inventory findings without blocking an otherwise usable agenda. No canonical person matching or image upload occurs. Reviewed `historicalPeople[name].photoUrl` overrides remain explicit; exact source photos are retained in archival attribution.

## Exact source row decisions and local filename mappings

For an explicitly reviewed local headshot file or format mismatch, use `localHeadshotFiles[exactAuthoredReference]`, for example the key `speakers/alex-smith.*`, containing `relativePath` (an exact event-relative `speakers/` filename), reviewed `sourceDigest` (SHA-256), `bytes`, and `mediaType` (`image/png`, `image/jpeg`, or `image/webp`). The resolver requires a confined, nonsymlink file with matching digest, size, and declared image signature; default extension validation remains unchanged without this mapping. Its report retains the authored reference, original local paths and public URL when uniquely known, resolved filename, mapping evidence, and resolved extension-mismatch finding. `historicalPeople[name].photoUrl` selects the public destination separately. Verified file evidence establishes no canonical person, consent, upload, or publication approval.

Preparation reports now list `sourceRows` with a `sourceLocator` in the form `YYYY-MM-DD:slotIndex:sessionIndex` (zero-based authored indexes), the existing `originalSourceKey`, final `sourceKey`, original title/credits, and parsed source digest. Missing, null, or whitespace-only session titles remain unresolved until reviewed. The parsed `sourceDigest` differs from the Markdown file hash; copy the exact digest from the fresh report.

Use `sourceRows[locator]` in reviewed mappings with that `sourceDigest`. Optional `title` is `{ "decision": "reviewed_title", "value": "<researched title>", "reviewedAt": "<actual UTC review instant>" }`, or `{ "decision": "title_not_recorded", "reviewedAt": "<actual UTC review instant>" }` for a blank authored title. The latter uses the neutral label “Title not recorded.” Credit choices live under `credits[exactAuthoredName]`: `credit_not_recorded` retains an omitted placeholder as provenance; `retain_source_credit` retains an exact agenda-only historical name without a canonical identity or invented biography. Both require `archivePublicSource: true` and an actual `reviewedAt`. Source decisions retain the original values in the report and archive metadata.

Colliding source keys remain unresolved. Supply an explicit stable `sourceKey` and actual `reviewedAt` on the exact source row mapping to distinguish only the reviewed collision; untouched rows retain their existing keys. Decisions with stale source digests, absent locators/credits, future review times, or conflicting canonical-person mappings remain unresolved.

When an authored slide filename differs from the real local file, use `localPresentationFiles[exactAuthoredReference]` containing `relativePath` (an exact event-relative filename), reviewed `sourceDigest` (PDF SHA-256), and `bytes`. No filename normalization occurs. The resolver requires the exact confined, nonsymlink PDF and verifies its hash and size. `presentationUrls` still chooses the public destination separately. The report keeps the original reference, original public URL, resolved filename, and reviewed evidence; a mapped file does not prove an old URL redirects successfully.

A same-start next slot can produce a zero inferred window. In explicitly selected public archive mode this preserves the start with an unknown end, using the existing archival timing contract and transfer acknowledgment. Explicit authored zero/invalid durations remain unresolved; no closing duration is invented.

To resolve a verified historical placeholder to a real person, use `sourceRows[locator].credits[exactAuthoredPlaceholder]` with `{ "decision": "reviewed_credit", "resolvedValue": "<exact verified person reference>", "reviewedAt": "<actual UTC review instant>" }`. Supply `historicalPeople[resolvedValue]` with an explicit canonical `userId`, an explicitly selected `actingIdentityId` (including `null`), and actual `approvedAt`. Valid approval evidence is required before replacing the row's person reference. The original placeholder, including blank text, stays in source-decision provenance; the verified reference supplies the approved historical appearance. Authored moderator roles remain attached to the resolved person unless explicitly reviewed otherwise. This mapping never guesses a person, employer, or approval time. Missing or invalid mappings remain unresolved.

Historical sources with an authored room column order also retain their original Hugo dialog and label fragments in `archive.legacyFragments`. The shared Hugo-compatible slug codec uses the original title, the exact authored clock spelling (`8:30` remains `830`), and the original day-specific column index. A reviewed title replacement never rewrites these anchors. Each fragment retains source path/digest, the transfer row reference, original date/start/title, source room reference and reviewed canonical room ID when available. Unknown or duplicate columns, unsafe anchors and duplicate fragments remain unresolved. Sources without authored column-order evidence do not manufacture legacy IDs. Backend review resolves canonical room IDs and preserves this provenance separately from editable page paths; copy-as-new clears source fragments. Day, tab and speaker navigation aliases derive from the protected original dates during approved rendering. Preparation does not establish that these aliases have been deployed or verified through HTTP/browser navigation.

Verified local PDFs also retain `archive.legacyDownloads` receipts for the exact original event-root bundle URL and its matching `/content-media/events/...` target. The authored reference must equal the resolver's exact local filename and verified public target; globs, remote destinations and reviewed filename substitutions do not establish an original Hugo href. The Sandra Guasch whitespace substitution therefore creates no ordinary-space old-link receipt. Receipts retain source path/digest/row reference and confer no material rights or release approval. Approved public material evidence and the static publisher still govern whether an old URL can be served.
