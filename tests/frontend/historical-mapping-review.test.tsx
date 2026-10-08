// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HistoricalMappingReview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/HistoricalMappingReview";
import {
  agendaHistoricalMetadataReviewSchema,
  historicalReviewIssueMessages,
} from "../../assets/shared/schemas/event-agenda-historical-review";
import { historicalMappingFixture } from "./helpers/historical-mapping-fixture";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

it("compares immutable original and verified attribution with canonical mapping and both provenance digests", () => {
  const entry = historicalMappingFixture();
  render(<HistoricalMappingReview entries={[entry]} occurrences={[]} />, host);
  expect(host.textContent).toContain("Authored Speaker");
  expect(host.textContent).toContain("Historical Role");
  expect(host.textContent).toContain("Verified Historical Speaker");
  expect(host.textContent).toContain("Verified Historical Role");
  expect(host.textContent).toContain("Verified Historical Organization");
  expect(host.textContent).toContain(entry.originalSource.sourceDigest);
  expect(host.textContent).toContain(entry.sourceDigest);
  expect(host.textContent).toContain("Title not recorded");
  expect(host.textContent).toContain("Verified historical title");
  expect(host.textContent).toContain("Existing approved appearances and materials are retained");
  const evidence = host.querySelector('section[aria-label="Source evidence"]')!;
  expect(evidence.querySelector("h4")?.textContent).toBe("Source evidence");
  expect(evidence.textContent).toContain(entry.originalSource.sourceDigest);
  expect(evidence.textContent).toContain(entry.sourceDigest);
  const references = host.querySelector('section[aria-label="Record references"]')!;
  expect(references.querySelector("h4")?.textContent).toBe("Record references");
  expect(references.textContent).toContain(entry.people[0]!.userId);
  expect(host.querySelector("details, summary")).toBeNull();
  expect(host.querySelector("input, select, button, form")).toBeNull();
});

it("distinguishes verified individual attribution from an unresolved mapping and exposes canonical review blockers", () => {
  const entry = historicalMappingFixture();
  entry.people[0]!.actingIdentityId = null;
  entry.incomingMetadata.appearances[0]!.actingIdentityId = null;
  entry.people.push({ sourceRef: "unmapped-source", userId: null, actingIdentityId: null });
  entry.reviewIssues = ["credit_unresolved", "source_mapping_incomplete"];
  render(
    <HistoricalMappingReview entries={[agendaHistoricalMetadataReviewSchema.parse(entry)]} occurrences={[]} />,
    host,
  );
  expect(host.textContent).toContain("Explicit individual");
  expect(host.textContent).toContain("Needs verified mapping");
  expect(host.textContent).toContain("Historical mapping approval is blocked");
  expect(host.textContent).toContain(historicalReviewIssueMessages.credit_unresolved);
  expect(host.textContent).toContain(historicalReviewIssueMessages.source_mapping_incomplete);
});

it("renders source attribution as text without interpreting source markup", () => {
  const entry = historicalMappingFixture();
  entry.originalMetadata.archivalCredits[0]!.displayName = "<script>source()</script>";
  render(<HistoricalMappingReview entries={[entry]} occurrences={[]} />, host);
  expect(host.textContent).toContain("<script>source()</script>");
  expect(host.querySelector("script")).toBeNull();
});

it("distinguishes pending attribution from a source with no credited people", () => {
  const entry = historicalMappingFixture();
  entry.originalMetadata.archivalCredits = [];
  entry.incomingMetadata.appearances = [];
  entry.people = [];
  render(<HistoricalMappingReview entries={[entry]} occurrences={[]} />, host);
  expect(host.textContent).toContain("No credited people");
  entry.reviewIssues = ["credit_unresolved"];
  render(<HistoricalMappingReview entries={[entry]} occurrences={[]} />, host);
  expect(host.textContent).toContain("Historical attribution needs verified mapping");
  expect(host.textContent).not.toContain("No credited people");
});

it("retains both authored credit rows when decisions share a locator across render updates", () => {
  const entry = historicalMappingFixture();
  const provenance = entry.originalMetadata.sourceDecisions[0]!;
  entry.originalMetadata.sourceDecisions = ["Authored credit A", "Authored credit B"].map((authoredValue) => ({
    ...provenance,
    kind: "credit",
    sourceLocator: "session/credits",
    authoredValue,
    decision: "retain_source_credit",
    resolvedValue: authoredValue,
  }));
  const parsed = agendaHistoricalMetadataReviewSchema.parse(entry);
  render(<HistoricalMappingReview entries={[parsed]} occurrences={[]} />, host);
  const rows = () => [
    ...host.querySelectorAll<HTMLTableRowElement>('section[aria-label="Original historical attribution"] tbody tr'),
  ];
  const originalRows = rows();
  expect(originalRows).toHaveLength(2);
  expect(originalRows[0]!.textContent).toContain("Authored credit A");
  expect(originalRows[1]!.textContent).toContain("Authored credit B");
  parsed.originalMetadata.sourceDecisions.reverse();
  render(<HistoricalMappingReview entries={[parsed]} occurrences={[]} />, host);
  const updatedRows = rows();
  expect(updatedRows).toHaveLength(2);
  expect(updatedRows[0]).toBe(originalRows[1]);
  expect(updatedRows[1]).toBe(originalRows[0]);
  expect(updatedRows[0]!.textContent).toContain("Authored credit B");
  expect(updatedRows[1]!.textContent).toContain("Authored credit A");
});
