import { SessionPresentationVersions } from "../proposal-detail/PresentationVersionsTab";
import { AppearanceOverrides } from "./AppearanceOverrides";
import { AppearanceFields, MaterialFields } from "./SessionArchiveFields";
import { useState } from "preact/hooks";
import {
  sessionHistoryMetadataSchema,
  sessionHistoryCorrectionSchema,
} from "../../../../../../../shared/schemas/event-session-history";
import {
  agendaSnapshotSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Textarea } from "../../../../../../ui/TextControl";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Menu } from "../../../../../../ui/Menu";
export function SessionHistoryEditor({
  canEdit = true,
  snapshot,
  occurrence,
  onSaved,
  onClose,
}: {
  canEdit?: boolean;
  snapshot: AgendaSnapshot;
  occurrence: AgendaOccurrence;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"archive" | "presentations" | "overrides">("archive");
  const [materialRevision, setMaterialRevision] = useState(0);
  const [prerequisites, setPrerequisites] = useState(occurrence.history?.prerequisites ?? "");
  const [appearances, setAppearances] = useState(occurrence.history?.appearances ?? []);
  const [materials, setMaterials] = useState(occurrence.history?.materials ?? []);
  const [legacyPaths, setLegacyPaths] = useState(occurrence.history?.legacyPaths.join("\n") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const history = {
    ...sessionHistoryMetadataSchema.parse(occurrence.history ?? {}),
    prerequisites,
    appearances,
    materials,
    legacyPaths: legacyPaths
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  const form = useContractForm(sessionHistoryCorrectionSchema, { expectedRevision: snapshot.revision, history });
  async function save(event: Event) {
    event.preventDefault();
    if (!canEdit) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/${encodeURIComponent(occurrence.id)}/history`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save session archive.");
    } finally {
      setBusy(false);
    }
  }
  if (view === "overrides")
    return (
      <Panel>
        <PanelHeader title={`Historical representation overrides · ${occurrence.title}`}>
          <Button onClick={() => setView("archive")}>Back to archive details</Button>
          <Button onClick={onClose}>Close</Button>
        </PanelHeader>
        <PanelBody>
          <AppearanceOverrides
            canRequest={canEdit}
            snapshot={snapshot}
            occurrenceId={occurrence.id}
            appearances={appearances}
            onSaved={onSaved}
          />
        </PanelBody>
      </Panel>
    );
  if (view === "presentations")
    return (
      <Panel>
        <PanelHeader title={`Session presentations · ${occurrence.title}`}>
          <Button onClick={() => setView("archive")}>Back to archive details</Button>
          <Button onClick={onClose}>Close</Button>
        </PanelHeader>
        <PanelBody>
          <section class="pk-stack" aria-label="Session presentation versions">
            <h3>Uploaded presentation versions</h3>
            <p>
              Uploads and content reviews stay private. Choose an approved version in Material release and approve
              rights, consent and public release separately before publishing the agenda.
            </p>
            <SessionPresentationVersions
              eventSlug={snapshot.eventSlug}
              occurrenceId={occurrence.id}
              canManage={canEdit}
              onChanged={() => setMaterialRevision((current) => current + 1)}
            />
          </section>
        </PanelBody>
      </Panel>
    );
  return (
    <Panel>
      <PanelHeader title={`Session archive · ${occurrence.title}`}>
        <Menu
          label="Session archive actions"
          align="end"
          items={[
            { id: "presentations", label: "Manage presentation uploads", onSelect: () => setView("presentations") },
            { id: "overrides", label: "Historical representation overrides", onSelect: () => setView("overrides") },
            { id: "close", label: "Close", onSelect: onClose },
          ]}
        />
      </PanelHeader>
      <PanelBody>
        {canEdit && (
          <>
            <p>Corrections update the draft. Approve the agenda again to publish a new historical version.</p>
            <form noValidate onSubmit={save}>
              <Field label="Prerequisites" {...form.of("history.prerequisites")}>
                {(control) => (
                  <Textarea
                    {...control}
                    value={prerequisites}
                    onInput={(e) => setPrerequisites(e.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                label="Legacy session URLs"
                help="One event page path per line. Existing generated pages cannot be replaced by a redirect."
                {...form.of("history.legacyPaths")}
              >
                {(control) => (
                  <Textarea {...control} value={legacyPaths} onInput={(e) => setLegacyPaths(e.currentTarget.value)} />
                )}
              </Field>
              <AppearanceFields
                slug={snapshot.eventSlug}
                occurrenceId={occurrence.id}
                appearances={appearances}
                speakers={occurrence.speakers}
                sourceRepresentations={occurrence.history?.proposalRepresentations ?? []}
                onChange={setAppearances}
              />
              <MaterialFields
                refreshToken={materialRevision}
                slug={snapshot.eventSlug}
                occurrenceId={occurrence.id}
                materials={materials}
                legacyDownloads={occurrence.history?.legacyDownloads ?? []}
                onChange={setMaterials}
              />
              {error && <ErrorAlert error={error} />}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save archive details"}
              </Button>
            </form>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
