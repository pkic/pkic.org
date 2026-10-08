import {
  historicalReviewIssueMessages,
  type AgendaHistoricalMetadataReview,
  type HistoricalReviewMetadata,
} from "../../../../../../../shared/schemas/event-agenda-historical-review";
import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { publicSessionMaterials } from "../../../../../../../shared/schemas/event-session-history";
import { formatDateTime, formatDateTimeInZone } from "../../../../../../shared/ui";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { DataTable } from "../../../../../../ui/DataTable";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";

function HistoricalAttribution({
  metadata,
  label,
  needsMapping,
}: {
  metadata: HistoricalReviewMetadata;
  label: string;
  needsMapping: boolean;
}) {
  return (
    <section aria-label={label} class="pk-stack">
      <h5>{label}</h5>
      {metadata.archivalCredits.map((credit) => (
        <DescriptionList
          key={credit.sourceRef}
          items={[
            { term: "Authored credit", value: credit.displayName },
            { term: "Credit role", value: credit.role.replaceAll("_", " ") },
            { term: "Organization", value: credit.organizationName },
            { term: "Job title", value: credit.jobTitle },
            { term: "Biography", value: credit.biography },
            { term: "Source reference", value: credit.sourceRef },
          ]}
        />
      ))}
      {metadata.appearances.map((appearance) => (
        <DescriptionList
          key={appearance.userId}
          items={[
            { term: "Frozen appearance", value: appearance.displayName },
            {
              term: "Representation",
              value:
                appearance.actingIdentityId === null
                  ? "Explicit individual"
                  : [appearance.organizationName, appearance.jobTitle].filter(Boolean).join(" — ") ||
                    "Verified representation",
            },
            { term: "Organization", value: appearance.organizationName },
            { term: "Job title", value: appearance.jobTitle },
            { term: "Biography", value: appearance.biography },
            { term: "Appearance approved", value: formatDateTime(appearance.approvedAt) },
          ]}
        />
      ))}
      {metadata.archivalCredits.length === 0 && metadata.appearances.length === 0 && (
        <p>{needsMapping ? "Historical attribution needs verified mapping" : "No credited people"}</p>
      )}
      {metadata.archivalTiming && (
        <DescriptionList
          items={[
            { term: "Authored date", value: metadata.archivalTiming.authoredDate },
            { term: "Authored start", value: metadata.archivalTiming.authoredStart },
            {
              term: "Historical start",
              value: `${formatDateTimeInZone(metadata.archivalTiming.startAt, metadata.archivalTiming.timeZone)} (${metadata.archivalTiming.timeZone})`,
            },
          ]}
        />
      )}
      {metadata.sourceDecisions.length > 0 && (
        <DataTable
          caption={`${label}: source decisions`}
          rows={metadata.sourceDecisions}
          rowKey={(decision) => JSON.stringify([decision.kind, decision.sourceLocator, decision.authoredValue])}
          columns={[
            { id: "kind", header: "Source field", cell: (decision) => decision.kind },
            {
              id: "authored",
              header: "Authored value",
              cell: (decision) => decision.authoredValue ?? "Not recorded in source",
            },
            { id: "decision", header: "Verified decision", cell: (decision) => decision.decision.replaceAll("_", " ") },
            { id: "resolved", header: "Reviewed value", cell: (decision) => decision.resolvedValue ?? "Unresolved" },
            { id: "locator", header: "Source locator", cell: (decision) => decision.sourceLocator },
          ]}
        />
      )}
      {metadata.legacyPaths.length > 0 && (
        <DescriptionList items={[{ term: "Historical paths", value: metadata.legacyPaths.join(", ") }]} />
      )}
    </section>
  );
}

/** Shows staged, immutable evidence; approval stays with the dedicated content form. */
export function HistoricalMappingReview({
  entries,
  occurrences,
}: {
  entries: readonly AgendaHistoricalMetadataReview[];
  occurrences: readonly AgendaOccurrence[];
}) {
  return (
    <section aria-label="Historical mapping review" class="pk-stack">
      <h4>Verified historical mapping changes</h4>
      <p>
        Review the original attribution and proposed mapping before accepting the source changes. Existing approved
        appearances and materials are retained.
      </p>
      {entries.map((entry) => {
        const occurrence = occurrences.find((item) => item.id === entry.occurrenceId);
        const materials = publicSessionMaterials(occurrence?.history?.materials ?? []);
        return (
          <section
            key={entry.occurrenceId}
            aria-label={`Historical review: ${occurrence?.title ?? entry.sourceRef}`}
            class="pk-stack"
          >
            <h5>{occurrence?.title ?? entry.sourceRef}</h5>
            {entry.reviewIssues.length > 0 && (
              <Alert tone="warn">
                <p>Historical mapping approval is blocked.</p>
                <ul>
                  {entry.reviewIssues.map((issue) => (
                    <li key={issue}>{historicalReviewIssueMessages[issue]}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <Panel aria-label="Source evidence">
              <PanelHeader title="Source evidence" headingLevel={4} />
              <PanelBody>
                <DescriptionList
                  items={[
                    { term: "Original source", value: entry.originalSource.sourcePath },
                    { term: "Original source reference", value: entry.originalSource.sourceRef },
                    { term: "Original source digest", value: entry.originalSource.sourceDigest },
                    { term: "Incoming source", value: entry.sourcePath },
                    { term: "Incoming source reference", value: entry.sourceRef },
                    { term: "Incoming source digest", value: entry.sourceDigest },
                  ]}
                />
              </PanelBody>
            </Panel>
            <HistoricalAttribution
              label="Original historical attribution"
              metadata={entry.originalMetadata}
              needsMapping={entry.reviewIssues.some((issue) => issue !== "title_unresolved")}
            />
            <HistoricalAttribution
              label="Verified incoming attribution"
              metadata={entry.incomingMetadata}
              needsMapping={entry.reviewIssues.some((issue) => issue !== "title_unresolved")}
            />
            <DataTable
              caption="Verified canonical person mappings"
              rows={entry.people}
              rowKey={(person) => person.sourceRef}
              columns={[
                { id: "source", header: "Source credit reference", cell: (person) => person.sourceRef },
                {
                  id: "person",
                  header: "Person",
                  cell: (person) =>
                    entry.incomingMetadata.appearances.find((appearance) => appearance.userId === person.userId)
                      ?.displayName ??
                    entry.originalMetadata.archivalCredits.find((credit) => credit.sourceRef === person.sourceRef)
                      ?.displayName ??
                    "Needs verified mapping",
                },
                {
                  id: "identity",
                  header: "Representation",
                  cell: (person) =>
                    person.userId === null
                      ? "Unresolved"
                      : person.actingIdentityId === null
                        ? "Explicit individual"
                        : (() => {
                            const appearance = entry.incomingMetadata.appearances.find(
                              (item) =>
                                item.userId === person.userId && item.actingIdentityId === person.actingIdentityId,
                            );
                            return appearance
                              ? [appearance.organizationName, appearance.jobTitle].filter(Boolean).join(" — ") ||
                                  "Verified representation"
                              : "Needs verified mapping";
                          })(),
                },
              ]}
            />
            {entry.people.length > 0 && (
              <Panel aria-label="Record references">
                <PanelHeader title="Record references" headingLevel={4} />
                <PanelBody>
                  <DescriptionList
                    items={entry.people.map((person) => ({
                      term: person.sourceRef,
                      value:
                        person.userId === null
                          ? "Needs verified mapping"
                          : `${person.userId} / ${person.actingIdentityId ?? "Explicit individual"}`,
                    }))}
                  />
                </PanelBody>
              </Panel>
            )}
            {materials.length > 0 && (
              <DescriptionList
                items={[
                  {
                    term: "Retained approved materials",
                    value: materials.map((material) => material.title).join(", "),
                  },
                ]}
              />
            )}
          </section>
        );
      })}
    </section>
  );
}
