import type { z } from "zod";
import { eventRecordingAcquisitionsResponseSchema } from "../../../../../../../shared/schemas/event-recording-acquisition-catalog";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventRecordingSourceSchema,
  eventRecordingSourceRefreshSchema,
  eventRecordingAcquireSchema,
  eventRecordingAcquisitionSchema,
  type EventRecordingSource,
  type EventRecordingAcquire,
  type EventRecordingAcquisition,
} from "../../../../../../../shared/schemas/event-recordings";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ApiClientError, getJson, postJson, requestJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { FormSection } from "../../../../../../ui/FormSection";
import { Menu } from "../../../../../../ui/Menu";
import { isAuthed, portalSession } from "../../../../state";
import { hasEventAgendaPermission } from "../../event-agenda-access";
import { toast } from "../../../../ui";

export function RecordingSourceDetails({
  slug,
  source,
  onClose,
  onRefresh,
}: {
  slug: string;
  source: EventRecordingSource;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const request = useRef<EventRecordingAcquire | null>(null);
  const metadataRequest = useRef<AbortController | null>(null);
  const [refreshed, setRefreshed] = useState<{ basis: EventRecordingSource; source: EventRecordingSource } | null>(
    null,
  );
  // Adopt the canonical mutation response immediately; a later canonical read
  // replaces it when the parent supplies a new projection.
  const recording = refreshed?.basis === source ? refreshed.source : source;

  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<EventRecordingAcquisition | null>(null);
  const [acquiring, setBusy] = useState(false),
    [metadataBusy, setMetadataBusy] = useState(false),
    [error, setError] = useState("");
  const busy = acquiring || metadataBusy;
  const session = portalSession.value;
  useEffect(() => {
    setMetadataBusy(false);
    return () => {
      metadataRequest.current?.abort();
      metadataRequest.current = null;
    };
  }, [slug, source.id, session?.sessionId]);
  const form = useContractForm(eventRecordingAcquireSchema, {
    operationId,
    expectedMetadataRevision: recording.metadataRevision,
  });
  const sourceEndpoint = `/api/v1/events/${encodeURIComponent(slug)}/recordings/sources/${encodeURIComponent(source.id)}`;
  const endpoint = `${sourceEndpoint}/acquisitions`;
  const canAcquire = !recording.disabledAt && recording.status === "UPLOADED" && recording.fileBytes > 0;
  const liveSession = () =>
    Boolean(
      isAuthed.value &&
      session &&
      portalSession.value === session &&
      Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now(),
    );
  const canRefreshMetadata =
    !recording.disabledAt && liveSession() && hasEventAgendaPermission(recording.eventId, "events:manage");
  async function refreshMetadata() {
    if (busy || !canRefreshMetadata || !liveSession()) return;
    const controller = new AbortController();
    metadataRequest.current = controller;
    const current = () => !controller.signal.aborted && liveSession();
    setMetadataBusy(true);
    setError("");
    try {
      const body = eventRecordingSourceRefreshSchema.parse({ expectedMetadataRevision: recording.metadataRevision });
      const result = await requestJson(`${sourceEndpoint}/refresh`, eventRecordingSourceSchema, {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!current()) return;
      if (result.id !== source.id || result.eventId !== source.eventId)
        throw new Error("Recording metadata could not be refreshed.");
      setRefreshed({ basis: source, source: result });
      toast("Recording metadata refreshed", "success");
      await onRefresh();
    } catch (failure) {
      if (!current()) return;
      setError(failure instanceof Error ? failure.message : "Recording metadata could not be refreshed.");
      if (failure instanceof ApiClientError && failure.status === 409) {
        try {
          await onRefresh();
        } catch {
          /* Keep the canonical conflict visible; no mutation is retried. */
        }
      }
    } finally {
      if (metadataRequest.current === controller) {
        metadataRequest.current = null;
        setMetadataBusy(false);
      }
    }
  }
  async function acquire(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data || busy || !canAcquire) {
      setError(checked.message ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      request.current ??= checked.data;
      setReceipt(await postJson(endpoint, request.current, eventRecordingAcquisitionSchema));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Recording acquisition could not be requested.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!receipt || busy) return;
    setBusy(true);
    setError("");
    try {
      setReceipt(await getJson(`${endpoint}/${receipt.id}`, eventRecordingAcquisitionSchema));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Recording status is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Recording details">
      <h3>Recording from {formatDateTime(recording.startedAt)}</h3>
      <dl>
        <dt>Status</dt>
        <dd>{recording.status.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase())}</dd>
        <dt>Bytes</dt>
        <dd>{formatNumber(recording.fileBytes)}</dd>
        <dt>Last checked</dt>
        <dd>{formatDateTime(recording.observedAt)}</dd>
      </dl>
      <p>
        Acquiring a file does not publish it. Select the acquired version in the session material review and confirm
        rights and consent separately.
      </p>
      {!canAcquire && (
        <p role="status">
          {recording.disabledAt
            ? "This recording is disabled."
            : "Wait for the provider to finish uploading a non-empty recording before acquisition."}
        </p>
      )}
      <Menu
        label="Recording actions"
        align="end"
        items={[
          {
            id: "refresh-metadata",
            label: "Refresh metadata",
            disabled: busy || !canRefreshMetadata,
            onSelect: () => void refreshMetadata(),
          },
          { id: "reload", label: "Reload recording", disabled: busy, onSelect: () => void onRefresh() },
        ]}
      />
      {error && <ErrorAlert error={error} />}
      {receipt ? (
        <FormSection title="Acquisition status">
          <p role="status">
            {receipt.status}
            {receipt.failure ? ` · ${receipt.failure.replaceAll("_", " ")}` : ""}
          </p>
          {receipt.completedAt && <p>Acquired {formatDateTime(receipt.completedAt)}</p>}
          <Button type="button" disabled={busy} onClick={() => void refresh()}>
            Refresh status
          </Button>
          {(receipt.status === "failed" || receipt.status === "completed") && (
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRefresh();
                  request.current = null;
                  setOperationId(crypto.randomUUID());
                  setReceipt(null);
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : "Recording status is unavailable.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Acquire again
            </Button>
          )}
        </FormSection>
      ) : (
        <form noValidate {...form.handlers} onSubmit={acquire}>
          <Button type="submit" disabled={busy || !canAcquire} loading={busy}>
            Acquire recording
          </Button>
        </form>
      )}
      <ApiDataTable<EventRecordingAcquisition, z.infer<typeof eventRecordingAcquisitionsResponseSchema>>
        endpoint={endpoint}
        responseSchema={eventRecordingAcquisitionsResponseSchema}
        resolve={(result) => result.acquisitions}
        resolvePage={(result) => result.page}
        paginate
        initialSort="-createdAt"
        caption="Acquisition history"
        empty="No acquisition has been requested."
        rowKey={(row) => row.id}
        rowAction={(row) => ({ label: "View acquisition status", onSelect: () => setReceipt(row) })}
        columns={[
          {
            header: "Requested",
            sort: { asc: "createdAt", desc: "-createdAt" },
            cell: (row) => formatDateTime(row.createdAt),
          },
          { header: "Status", cell: (row) => row.status },
          { header: "Attempts", align: "end", width: "fit", cell: (row) => formatNumber(row.attempts) },
        ]}
      />
      <Button type="button" onClick={onClose}>
        Back to recordings
      </Button>
    </section>
  );
}
