import { useState } from "preact/hooks";
import { groupEventDaysResponseSchema, type GroupEvent } from "../../../../../shared/schemas/group-events";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { EventDaysForm } from "./EventDaysForm";

export function EventDaysEditor({
  groupId,
  event,
  expectedUpdatedAt,
  onRevision,
}: {
  groupId: string;
  event: GroupEvent;
  expectedUpdatedAt: string;
  onRevision: (revision: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/days`;
  const resource = useData(() => getJson(endpoint, groupEventDaysResponseSchema), [groupId, event.id]);
  if (resource.loading) return <Spinner label="Loading attendance days…" />;
  if (resource.error) return <ErrorAlert error={resource.error} />;
  if (!resource.data) return <></>;
  if (editing)
    return (
      <EventDaysForm
        key={resource.data.eventUpdatedAt}
        endpoint={endpoint}
        event={event}
        response={resource.data}
        expectedUpdatedAt={expectedUpdatedAt}
        onRevision={onRevision}
        onCancel={async () => {
          setEditing(false);
          await resource.reload();
        }}
        onSaved={async () => {
          setSaved(true);
          setEditing(false);
          await resource.reload();
        }}
      />
    );
  return (
    <Panel aria-label="Attendance days">
      <PanelHeader
        title="Attendance days"
        menu={
          <Menu
            label="Attendance days actions"
            align="end"
            items={[
              {
                id: "edit",
                label: "Edit attendance days",
                onSelect: () => {
                  setSaved(false);
                  setEditing(true);
                },
              },
            ]}
          />
        }
      />
      <PanelBody class="pk-stack">
        {saved && <Alert tone="ok">Days saved.</Alert>}
        {resource.data.days.length ? (
          <DescriptionList
            items={resource.data.days.map((day) => ({
              term: day.label ? `${day.date} · ${day.label}` : day.date,
              value:
                day.attendanceOptions
                  .filter((option) => option.enabled !== false)
                  .map((option) => option.label)
                  .join(", ") || "No attendance options",
            }))}
          />
        ) : (
          <p class="pk-muted">No attendance days configured.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
