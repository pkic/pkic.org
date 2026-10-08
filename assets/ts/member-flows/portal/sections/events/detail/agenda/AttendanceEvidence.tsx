import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  attendanceEvidenceSchema,
  attendanceEvidenceResponseSchema,
  attendanceCorrectionRequestSchema,
  attendanceCorrectionSchema,
  attendanceCorrectionHistoryResponseSchema,
} from "../../../../../../../shared/schemas/event-attendance-corrections";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { RowActions } from "../../../../../../ui/RowActions";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
type Evidence = z.infer<typeof attendanceEvidenceSchema>;
export function AttendanceCorrectionReview({
  slug,
  observation,
  timeZone,
  canCorrect,
  onChanged,
}: {
  slug: string;
  observation: Evidence;
  timeZone: string;
  canCorrect: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] =
    useState<(typeof attendanceCorrectionRequestSchema.shape.reasonCode.options)[number]>("operator_error");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const form = useContractForm(attendanceCorrectionRequestSchema, {
    operationId,
    expectedRevision: observation.revision,
    kind: observation.voided ? "restore" : "void",
    reasonCode: reason,
  });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/attendance/observations/${observation.id}/corrections`,
        checked.data,
        attendanceCorrectionSchema,
      );
      onChanged();
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  if (history)
    return (
      <>
        <PanelBody>
          <Button onClick={() => setHistory(false)}>Back to observation</Button>
        </PanelBody>
        <PanelBody flush>
          <ApiDataTable
            endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/observations/${observation.id}/corrections`}
            responseSchema={attendanceCorrectionHistoryResponseSchema}
            resolve={(value) => value.corrections}
            resolvePage={(value) => value.page}
            caption="Attendance correction history"
            rowKey={(row) => row.id}
            paginate
            columns={[
              { header: "Action", cell: (row) => row.kind },
              { header: "Reason", cell: (row) => row.reasonCode.replaceAll("_", " ") },
              { header: "Corrected by", cell: (row) => row.actorUserId },
              { header: "Recorded", cell: (row) => formatDateTimeInZone(row.createdAt, timeZone) },
            ]}
          />
        </PanelBody>
      </>
    );
  return (
    <PanelBody class="pk-stack">
      <Button onClick={() => setHistory(true)}>View correction history</Button>
      <p>
        Original observation:{" "}
        {formatDateTimeInZone(
          observation.observedAt,
          observation.captureContext.state === "captured" ? observation.captureContext.timeZone : "UTC",
        )}
        . Device time is unverified. Server receipt: {formatDateTimeInZone(observation.receivedAt, timeZone)}. Source:{" "}
        {observation.source.replaceAll("_", " ")} · {observation.action}. Operator: {observation.operatorUserId}.
      </p>
      <p>
        {observation.captureContext.state === "captured"
          ? `Recorded day: ${observation.captureContext.dayDate} · ${observation.captureContext.timeZone} · ${observation.captureContext.source}. Publication revision: ${observation.captureContext.publicationRevision ?? "unpublished"}.`
          : "Recorded day context is missing. Original observation time is shown in UTC; no event day has been inferred."}
      </p>
      {observation.sourceReference && (
        <p>
          Source reference: {observation.sourceReference}. Mode: {observation.attendanceMode}. Verification claim:{" "}
          {observation.providerVerification?.replaceAll("_", " ")} (source assertion; clock time unverified).
        </p>
      )}
      <p>
        Corrections change reported attendance only. Original attempts, observations and admission decisions remain
        intact. IDs-only history is retained with the original evidence; identity details follow the event retention
        policy.
      </p>
      {canCorrect && (
        <form noValidate {...form.handlers} onSubmit={submit} class="pk-stack">
          <Field label="Correction reason" {...form.of("reasonCode")}>
            {(control) => (
              <Select
                {...control}
                name="reasonCode"
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
              >
                {attendanceCorrectionRequestSchema.shape.reasonCode.options.map((value) => (
                  <option value={value}>{value.replaceAll("_", " ")}</option>
                ))}
              </Select>
            )}
          </Field>
          {error && <ErrorAlert error={error} />}
          <Button type="submit" loading={busy}>
            {observation.voided ? "Restore observation" : "Exclude observation from attendance"}
          </Button>
        </form>
      )}
    </PanelBody>
  );
}
export function AttendanceEvidence({
  slug,
  occurrenceId,
  userId,
  timeZone,
  canCorrect = false,
  onChanged,
}: {
  slug: string;
  occurrenceId?: string;
  userId?: string;
  timeZone: string;
  canCorrect?: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Evidence | null>(null),
    [epoch, setEpoch] = useState(0);
  if (!occurrenceId && !userId) return <ErrorAlert error="Select an attendee or session to review attendance." />;
  if (selected)
    return (
      <Panel>
        <PanelHeader title="Review attendance observation" />
        <PanelBody>
          <Button onClick={() => setSelected(null)}>Back to observations</Button>
        </PanelBody>
        <AttendanceCorrectionReview
          key={`${selected.id}:${selected.revision}`}
          slug={slug}
          observation={selected}
          timeZone={timeZone}
          canCorrect={canCorrect}
          onChanged={() => {
            setSelected(null);
            setEpoch((value) => value + 1);
            onChanged();
          }}
        />
      </Panel>
    );
  return (
    <div class="pk-stack">
      <ApiDataTable
        key={`${slug}:${occurrenceId ?? ""}:${userId ?? ""}:${epoch}`}
        clearDataOnReload
        retainDataOnError={false}
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance/observations`}
        params={{ ...(occurrenceId ? { occurrenceId } : {}), ...(userId ? { userId } : {}) }}
        responseSchema={attendanceEvidenceResponseSchema}
        resolve={(value) => value.observations}
        resolvePage={(value) => value.page}
        caption="Original attendance evidence"
        rowKey={(row) => row.id}
        paginate
        initialSort="-observedAt"
        columns={[
          { header: "Attendee", cell: (row) => row.displayName ?? "Attendee" },
          ...(userId
            ? [
                {
                  header: "Check-in scope",
                  cell: (row: Evidence) =>
                    row.occurrenceId ? (
                      <span>
                        Session <code>{row.occurrenceId}</code>
                      </span>
                    ) : (
                      "Event entrance"
                    ),
                },
              ]
            : []),
          {
            header: "Observed",
            cell: (row) =>
              formatDateTimeInZone(
                row.observedAt,
                row.captureContext.state === "captured" ? row.captureContext.timeZone : "UTC",
              ),
            sort: { asc: "observedAt", desc: "-observedAt" },
          },
          {
            header: "Recorded day",
            cell: (row) =>
              row.captureContext.state === "captured"
                ? `${row.captureContext.dayDate} · ${row.captureContext.timeZone}`
                : "Missing context (UTC)",
          },
          { header: "Effective status", cell: (row) => (row.voided ? "Excluded by correction" : "Included") },
          {
            header: "Review",
            cell: (row) => (
              <RowActions
                subject={row.displayName ?? "Attendance observation"}
                actions={[{ id: "review", label: "Review observation", onSelect: () => setSelected(row) }]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
