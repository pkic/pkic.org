import { useState } from "preact/hooks";
import { type ClockZone } from "../../../../../../../shared/event-clock";
import { sponsorLeadDetailSchema } from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { Breadcrumb } from "../../../../../../ui/Breadcrumb";
import { Button } from "../../../../../../ui/Button";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { usePortalHashLocation } from "../../../../hash-location";
import { SponsorLeadCaptures } from "./SponsorLeadCaptures";
import { SponsorLeadNoteDialog } from "./SponsorLeadNoteDialog";

export function SponsorLeadDetail({
  slug,
  sponsorId,
  leadId,
  timeZone,
}: {
  slug: string;
  sponsorId: string;
  leadId: string;
  timeZone: ClockZone;
}) {
  const { live, epoch } = useLiveBrowserSession();
  if (!live) return <p role="status">Reconnect to view current consenting contacts.</p>;
  return (
    // Each lead keeps its own note state, so a note saved on one lead never carries to the next.
    <LiveSponsorLeadDetail
      key={`${epoch}:${sponsorId}:${leadId}`}
      slug={slug}
      sponsorId={sponsorId}
      leadId={leadId}
      timeZone={timeZone}
    />
  );
}

function LiveSponsorLeadDetail({
  slug,
  sponsorId,
  leadId,
  timeZone,
}: {
  slug: string;
  sponsorId: string;
  leadId: string;
  timeZone: ClockZone;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads/${encodeURIComponent(leadId)}`;
  const result = useData(() => getJson(endpoint, sponsorLeadDetailSchema), [endpoint]);
  const [editingNote, setEditingNote] = useState(false);
  const [savedNote, setSavedNote] = useState<{ note: string | null } | null>(null);
  if (result.loading) return <Spinner label="Loading lead…" />;
  if (!result.data) return <ErrorAlert error={result.error ?? "This lead is unavailable."} />;
  const { lead, sponsorName } = result.data;
  const note = savedNote ? savedNote.note : lead.note;
  return (
    <div class="pk-stack">
      <Breadcrumb
        items={[
          { label: "Leads", href: usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}/leads`) },
          { label: lead.name },
        ]}
      />
      <Panel>
        <PanelHeader title={lead.name} />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Sponsor", value: sponsorName },
              { term: "Email", value: lead.email },
              ...(lead.organization ? [{ term: "Organization", value: lead.organization }] : []),
              ...(lead.title ? [{ term: "Title", value: lead.title }] : []),
            ]}
          />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Note">
          <Button onClick={() => setEditingNote(true)}>{note ? "Edit note" : "Add note"}</Button>
        </PanelHeader>
        <PanelBody>{note ? <p class="pk-prose-block">{note}</p> : <p class="pk-muted">No note yet.</p>}</PanelBody>
      </Panel>
      {editingNote && (
        <SponsorLeadNoteDialog
          slug={slug}
          sponsorId={sponsorId}
          leadId={lead.id}
          name={lead.name}
          note={note}
          onClose={() => setEditingNote(false)}
          onSaved={(saved) => {
            setSavedNote({ note: saved });
            setEditingNote(false);
          }}
        />
      )}
      <Panel>
        <PanelHeader title="Capture history" />
        <PanelBody flush>
          <SponsorLeadCaptures endpoint={`${endpoint}/captures`} timeZone={timeZone} />
        </PanelBody>
      </Panel>
    </div>
  );
}
