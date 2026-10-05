import { publishedMeetingAgendaResponseSchema, meetingAgendaTimes } from "../../../../../shared/schemas/meeting-agenda";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
export function PublishedMeetingAgenda({
  groupId,
  seriesId,
  occurrenceId,
}: {
  groupId: string;
  seriesId: string;
  occurrenceId: string;
}) {
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}/occurrences/${encodeURIComponent(occurrenceId)}/agenda/published`;
  const detail = useData(() => getJson(endpoint, publishedMeetingAgendaResponseSchema), [endpoint]);
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return <Spinner />;
  const agenda = detail.data.agenda;
  if (!agenda)
    return (
      <Panel>
        <PanelHeader title="Meeting agenda" />
        <PanelBody>
          <p>The organizer has not approved an agenda for this occurrence yet.</p>
        </PanelBody>
      </Panel>
    );
  const items = meetingAgendaTimes(agenda.startsAt!, agenda.items);
  return (
    <Panel>
      <PanelHeader title={agenda.name} />
      <PanelBody>
        <p>Approved agenda · {agenda.timezone}</p>
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <h3>{item.title}</h3>
              <p>
                {formatDateTimeInZone(item.startAt, agenda.timezone)} –{" "}
                {formatDateTimeInZone(item.endAt, agenda.timezone)} · {item.durationMinutes} minutes
              </p>
              {item.description && <p>{item.description}</p>}
            </li>
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}
