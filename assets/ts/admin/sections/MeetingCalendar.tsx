/** Admin meeting calendar: tab navigation and working-group selection. */
import { useState } from "preact/hooks";
import { Tabs } from "../../components/Tabs";
import { adminWorkingGroupCatalog } from "../services/catalogs";
import { ServerSearchSelect } from "../components/ServerSearchSelect";
import { MeetingSeriesManager } from "./meeting-calendar/MeetingSeriesManager";

function WorkingGroupMeetingsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>();

  return (
    <div>
      <div class="mb-3 adm-filter-control">
        <ServerSearchSelect
          catalog={adminWorkingGroupCatalog}
          label="Working group"
          value={selectedId}
          selectedLabel={selectedLabel}
          allowEmpty={false}
          autoSelectFirst
          onChange={(group) => {
            setSelectedId(group?.id ?? null);
            setSelectedLabel(group ? adminWorkingGroupCatalog.itemLabel(group) : undefined);
          }}
        />
      </div>
      {selectedId ? (
        <MeetingSeriesManager key={selectedId} baseUrl={`/api/v1/admin/working-groups/${selectedId}/meetings`} />
      ) : (
        <p class="text-muted fst-italic">No working groups exist yet.</p>
      )}
    </div>
  );
}

const TABS = [
  { key: "consortium", label: "Consortium" },
  { key: "working-groups", label: "Working Groups" },
];

export function MeetingCalendar() {
  const [tab, setTab] = useState("consortium");

  return (
    <div>
      <p class="text-muted small">
        Manage meeting series and their ICS file variants. Deactivating a file automatically switches any member whose
        saved preference pointed at it to receiving all active variants on the next resend.
      </p>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "consortium" && <MeetingSeriesManager baseUrl="/api/v1/admin/consortium/meetings" />}
      {tab === "working-groups" && <WorkingGroupMeetingsTab />}
    </div>
  );
}
