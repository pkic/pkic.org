import { useState } from "preact/hooks";
import {
  attendanceImportTextSchema,
  attendanceImportRequestSchema,
  attendanceImportReviewSchema,
  attendanceImportReceiptSchema,
  attendanceImportsResponseSchema,
} from "../../../../../../../shared/schemas/event-attendance-imports";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ApiClientError, postJson } from "../../../../../../shared/api-client";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { Textarea } from "../../../../../../ui/TextControl";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import type { z } from "zod";
import { formatNumber } from "../../../../../../../shared/format-number";
import { attendancePath } from "./attendance-navigation";
export function AttendanceImport({
  slug,
  timeZone,
  onChanged,
  canRead = true,
  canImport = true,
  creating = true,
  basePath = `/events/${slug}/attendance`,
}: {
  slug: string;
  timeZone: string;
  onChanged: () => void;
  canRead?: boolean;
  canImport?: boolean;
  creating?: boolean;
  basePath?: string;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [review, setReview] = useState<z.infer<typeof attendanceImportReviewSchema> | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const form = useContractForm(attendanceImportTextSchema, { evidence: text });
  async function prepare(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const parsed = attendanceImportRequestSchema.parse({ ...JSON.parse(checked.data.evidence), operationId });
      setReview(
        await postJson(
          `/api/v1/events/${encodeURIComponent(slug)}/attendance/imports/reviews`,
          parsed,
          attendanceImportReviewSchema,
        ),
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "ATTENDANCE_IMPORT_REVIEW_CHANGED") {
        setReview(null);
        setOperationId(crypto.randomUUID());
      }
      setError(error instanceof Error ? error.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!review) return;
    setError("");
    setBusy(true);
    try {
      await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/attendance/imports`,
        { operationId, reviewId: review.reviewId, payloadHash: review.payloadHash },
        attendanceImportReceiptSchema,
      );
      setReview(null);
      setText("");
      setOperationId(crypto.randomUUID());
      setEpoch((value) => value + 1);
      onChanged();
      if (basePath) window.location.hash = attendancePath(basePath, "imports");
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "ATTENDANCE_IMPORT_REVIEW_CHANGED") {
        setReview(null);
        setOperationId(crypto.randomUUID());
      }
      setError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!creating)
    return canRead ? (
      <ApiDataTable
        key={epoch}
        searchPlaceholder="Search imports…"
        createAction={
          canImport
            ? {
                label: "Import attendance",
                onSelect: () => {
                  window.location.hash = attendancePath(basePath, "imports", "new");
                },
              }
            : undefined
        }
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/imports`}
        responseSchema={attendanceImportsResponseSchema}
        resolve={(value) => value.imports}
        resolvePage={(value) => value.page}
        caption="Attendance imports"
        paginate
        rowKey={(row) => row.id}
        columns={[
          { header: "Source", cell: (row) => row.source.replaceAll("_", " ") },
          { header: "Reference", cell: (row) => row.sourceReference },
          { header: "Observations", align: "end", width: "fit", cell: (row) => formatNumber(row.rowCount) },
          { header: "Imported by", cell: (row) => row.actorUserId },
          { header: "Received", cell: (row) => formatDateTimeInZone(row.receivedAt, timeZone) },
        ]}
      />
    ) : (
      <ButtonLink href={attendancePath(basePath, "imports", "new")}>Import attendance</ButtonLink>
    );
  if (!canImport) return <p>You do not have permission to import attendance.</p>;
  return (
    <section class="pk-stack" aria-label="Import attendance evidence">
      <ButtonLink href={attendancePath(basePath, "imports")}>Back to imports</ButtonLink>
      <h3>Import attendance evidence</h3>
      <p>
        Review up to 100 records with canonical user/session IDs and original UTC observation timestamps. Imported
        presence does not create admission, reservations or scan attempts. Provider verification is an attributed source
        assertion; imported clock time remains unverified.
      </p>
      <Panel aria-label="Import format">
        <PanelHeader title="Import format" headingLevel={4} />
        <PanelBody class="pk-stack">
          <pre>
            {JSON.stringify(
              {
                source: "vendor_attendance",
                sourceReference: "vendor-export-reference",
                rows: [
                  {
                    sourceRecordId: "record-1",
                    userId: "canonical-user-uuid",
                    occurrenceId: null,
                    attendanceMode: "virtual",
                    observedAt: "2026-10-04T10:00:00.000Z",
                    verification: "unverified",
                  },
                ],
              },
              null,
              2,
            )}
          </pre>
          <p>
            Use manual_evidence for reviewed physical evidence, with verification unverified. An occurrence must be
            approved and the observation must fall within its interval. Reusing a source record cannot overwrite
            evidence.
          </p>
        </PanelBody>
      </Panel>
      <form noValidate {...form.handlers} onSubmit={prepare} class="pk-stack">
        <Field label="Attendance evidence JSON" {...form.of("evidence")}>
          {(control) => (
            <Textarea
              {...control}
              value={text}
              rows={8}
              onInput={(event) => {
                setText(event.currentTarget.value);
                setReview(null);
                setOperationId(crypto.randomUUID());
              }}
            />
          )}
        </Field>
        <Button type="submit" loading={busy} disabled={!text.trim()}>
          Review evidence
        </Button>
      </form>
      {review && (
        <div class="pk-stack">
          <p>
            Reviewed {formatNumber(review.rowCount)} records. Review expires{" "}
            {formatDateTimeInZone(review.expiresAt, timeZone)}. Confirm that these original source records establish
            presence, rather than registration or a join click.
          </p>
          <DescriptionList
            items={[
              { term: "Captured timezone", value: review.captureContext.timeZone },
              {
                term: "Published agenda revision",
                value: review.captureContext.publicationRevision ?? "No published agenda",
              },
              { term: "Attendance days", value: review.captureContext.capturedDays.join(", ") },
            ]}
          />
          {review.captureContext.occurrences.length > 0 && (
            <Panel aria-label="Reviewed session intervals">
              <PanelHeader title="Reviewed session intervals" headingLevel={4} />
              <PanelBody>
                <DescriptionList
                  items={review.captureContext.occurrences.map((occurrence) => ({
                    term: occurrence.occurrenceId,
                    value: `${formatDateTimeInZone(occurrence.startAt, review.captureContext.timeZone)} – ${formatDateTimeInZone(occurrence.endAt, review.captureContext.timeZone)}`,
                  }))}
                />
              </PanelBody>
            </Panel>
          )}
          <p>Changing the event timezone or published schedule requires a new review before importing.</p>
          <Button onClick={apply} loading={busy}>
            Confirm import of {formatNumber(review.rowCount)} observations
          </Button>
        </div>
      )}
      {error && <ErrorAlert error={error} />}
    </section>
  );
}
