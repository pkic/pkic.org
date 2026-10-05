import type { z } from "zod";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useState } from "preact/hooks";
import {
  agendaImportSchema,
  agendaImportResponseSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
function instant(value: string, zone: string) {
  try {
    return dateTimeLocalToIso(value, zone);
  } catch {
    return value;
  }
}
export function AcceptedProposalPlacementReview({
  snapshot,
  candidate,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  candidate: { id: string; title: string; startAt: string; roomId: string };
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(
    candidate.startAt ? instantToDateTimeLocal(candidate.startAt, snapshot.timeZone) : "",
  );
  const [end, setEnd] = useState("");
  const [room, setRoom] = useState(candidate.roomId);
  const [reviewed, setReviewed] = useState<{
    candidate: string;
    source: string;
    preview: NonNullable<z.infer<typeof agendaImportResponseSchema>["placementPreview"]>;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const body = {
    expectedRevision: snapshot.revision,
    source: "accepted_proposals" as const,
    proposalIds: [candidate.id],
    occurrences: [],
    dryRun: true,
    proposalPlacement: {
      proposalId: candidate.id,
      startAt: instant(start, snapshot.timeZone),
      endAt: instant(end, snapshot.timeZone),
      roomId: room,
      additionalRoomIds: [],
    },
  };
  const form = useContractForm(agendaImportSchema, body);
  const fingerprint = JSON.stringify(body);
  async function run(apply: boolean) {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    if (apply && reviewed?.candidate !== fingerprint) return;
    setBusy(true);
    try {
      const result = await postJson(
        `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/imports`,
        { ...checked.data, dryRun: !apply, expectedPlacementFingerprint: apply ? reviewed?.source : undefined },
        agendaImportResponseSchema,
      );
      if (apply) {
        onSaved(result.agenda);
        onClose();
      } else if (result.placementFingerprint && result.placementPreview)
        setReviewed({ candidate: fingerprint, source: result.placementFingerprint, preview: result.placementPreview });
      else throw new Error("The placement review did not return a source fingerprint. Review again before saving.");
      setError("");
    } catch (failure) {
      setReviewed(null);
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        title={`Schedule accepted proposal · ${reviewed?.candidate === fingerprint ? reviewed.preview.title : candidate.title}`}
      />
      <PanelBody>
        <p>
          Choose the end time, then review this placement. Confirmed speakers and proposal content are imported
          together. Times are in {snapshot.timeZone}.
        </p>
        {error && <ErrorAlert error={error} />}
        <form
          noValidate
          {...form.handlers}
          class="pk-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(false);
          }}
        >
          <Field label="Start time" {...form.of("proposalPlacement.startAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="proposalPlacement.startAt"
                type="datetime-local"
                value={start}
                onInput={(event) => setStart(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="End time" {...form.of("proposalPlacement.endAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="proposalPlacement.endAt"
                type="datetime-local"
                value={end}
                onInput={(event) => setEnd(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Location" {...form.of("proposalPlacement.roomId")}>
            {(control) => (
              <Select
                {...control}
                name="proposalPlacement.roomId"
                value={room}
                onChange={(event) => setRoom(event.currentTarget.value)}
              >
                <option value="">Choose a location</option>
                {snapshot.rooms.map((value) => (
                  <option value={value.id}>{value.name}</option>
                ))}
              </Select>
            )}
          </Field>
          {reviewed?.candidate === fingerprint && (
            <section aria-label="Reviewed proposal content" class="pk-stack">
              <strong>{reviewed.preview.title}</strong>
              <p>{reviewed.preview.description}</p>
              <p>{formatNumber(reviewed.preview.speakerCount)} confirmed speakers</p>
              <p role="status">Placement reviewed. Save to import this proposal at the selected time and location.</p>
            </section>
          )}
          <div class="pk-cluster pk-cluster--end">
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Review placement
            </Button>
            <Button
              variant="primary"
              disabled={busy || reviewed?.candidate !== fingerprint}
              onClick={() => void run(true)}
            >
              Save placement
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
