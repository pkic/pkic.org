/**
 * An occurrence's settings: the facts, and an explicit way into editing them.
 *
 * Read-only until "Edit settings" is chosen — a record never opens in edit
 * mode — the same shape the series settings take. The status is not a
 * setting: cancelling, reinstating and marking as held are commands on the
 * record, so they live in its menu rather than in a select here.
 */
import { useEffect, useState } from "preact/hooks";
import type { EventOccurrence } from "../../../../../shared/schemas/event-series";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { MeetingOccurrenceEditor } from "./MeetingOccurrenceEditor";

export function MeetingOccurrenceSettings({
  endpoint,
  occurrence,
  timeZone,
  onChanged,
}: {
  endpoint: string;
  occurrence: EventOccurrence;
  timeZone: string;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  // A save comes back as a new revision; the form closes with it.
  useEffect(() => setEditing(false), [occurrence.updatedAt]);

  return (
    <Panel aria-label="Occurrence settings">
      <PanelHeader title="Occurrence settings">
        {/* The way in. Once editing, the form below carries its own Save and
            Cancel, so the header offers nothing that would duplicate them. */}
        {!editing && (
          <EditActions
            label="Occurrence settings actions"
            editing={false}
            onEdit={() => setEditing(true)}
            onCancel={() => setEditing(false)}
          />
        )}
      </PanelHeader>
      <PanelBody>
        {editing ? (
          <MeetingOccurrenceEditor
            endpoint={endpoint}
            occurrence={occurrence}
            timeZone={timeZone}
            onChanged={onChanged}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <DescriptionList
            items={[
              { term: "Starts", value: formatDateTimeInZone(occurrence.startsAt, timeZone) },
              { term: "Ends", value: formatDateTimeInZone(occurrence.endsAt, timeZone) },
              { term: "Time zone", value: timeZone },
              { term: "Location", value: occurrence.location ?? "Not set" },
              {
                term: "Location override",
                value: occurrence.locationOverride ?? "None — the series location applies",
              },
              {
                term: "Meeting-provider URL",
                value: occurrence.providerConfigured
                  ? "Configured; participants receive it after confirming entry"
                  : "Not configured",
              },
            ]}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
