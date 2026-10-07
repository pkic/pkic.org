import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { agendaBlocksListSchema } from "../../../../../../../shared/schemas/event-agenda-block-list";
import { useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { TableList } from "../../../../../../components/TableList";
import { CollectionToolbar } from "../../../../../../components/CollectionToolbar";
import { useCollectionSelection } from "../../../../../../hooks/useCollectionSelection";
import { BulkBar } from "../../../../../../ui/BulkBar";
import { DataTable } from "../../../../../../components/Table";
import { RowActions } from "../../../../../../ui/RowActions";
import { TabList } from "../../../../../../ui/TabList";
import { Badge } from "../../../../../../ui/Badge";
import { Button } from "../../../../../../ui/Button";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { StaffingShortfalls } from "./StaffingShortfalls";

export function StaffingOverview({
  snapshot,
  canEdit,
  editBlock,
  editPerson,
  editNeeds,
  editAssignment,
  createBlock,
  createPerson,
  configureRotation,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  editBlock: (id: string) => void;
  editPerson: (id: string) => void;
  editNeeds: (id: string) => void;
  editAssignment: (id: string) => void;
  createBlock?: () => void;
  createPerson?: () => void;
  configureRotation?: (blockIds: string[]) => void;
}) {
  const [tab, setTab] = useState("blocks");
  const [blockId, setBlock] = useState<string | null>(null);
  const [requirementId, setRequirement] = useState<string | null>(null);
  const blockSelection = useCollectionSelection<AgendaSnapshot["blocks"][number]>({
    rowKey: (row) => row.id,
    rowLabel: (row) => `Select ${row.name}`,
  });
  const coverage = snapshot.staffingReport?.coverage ?? [];
  const unfilledByBlock = new Map<string, number>();
  for (const position of snapshot.staffingReport?.uncovered ?? [])
    unfilledByBlock.set(position.blockId, (unfilledByBlock.get(position.blockId) ?? 0) + 1);
  const block = snapshot.blocks.find((row) => row.id === blockId);
  const requirement = snapshot.staffingRequirements.find((row) => row.id === requirementId);
  const roleName = (id: string) => snapshot.staffingRoles.find((row) => row.id === id)?.name ?? id;
  const postName = (id: string | null) => snapshot.staffingPosts.find((row) => row.id === id)?.name ?? "Event";
  if (block && requirement)
    return (
      <section class="pk-stack">
        <div class="pk-cluster">
          <Button onClick={() => setRequirement(null)}>Back to block</Button>
          <h3>
            {roleName(requirement.roleId)} · {postName(requirement.postId)}
          </h3>
        </div>
        <DescriptionList
          items={[
            { term: "Block", value: block.name },
            { term: "Time", value: formatTimeRangeInZone(block.startAt, block.endAt, snapshot.timeZone) },
            { term: "Ideal people", value: formatNumber(requirement.idealCount) },
          ]}
        />
        <DataTable
          caption="Staffing positions"
          data={snapshot.staffingPositions.filter((row) => row.requirementId === requirement.id)}
          rowKey={(row) => row.id}
          columns={[
            { header: "Position", cell: (row) => formatNumber(row.index), align: "end", width: "fit" },
            {
              header: "Person",
              cell: (row) =>
                snapshot.roleMembers.find(
                  (person) =>
                    person.userId ===
                    snapshot.assignments.find((assignment) => assignment.positionId === row.id)?.userId,
                )?.displayName ?? "Unassigned",
              width: "primary",
            },
            {
              header: "Status",
              cell: (row) => {
                const assignment = snapshot.assignments.find((value) => value.positionId === row.id);
                return (
                  <Badge tone={assignment ? "ok" : "warn"}>
                    {assignment?.pinned ? "Pinned" : assignment ? "Assigned" : "Unfilled"}
                  </Badge>
                );
              },
              width: "fit",
            },
            {
              header: "Actions",
              cell: (row) => (
                <RowActions
                  subject={`Position ${formatNumber(row.index)}`}
                  actions={
                    canEdit ? [{ id: "edit", label: "Edit assignment", onSelect: () => editAssignment(row.id) }] : []
                  }
                />
              ),
              width: "fit",
            },
          ]}
        />
        <StaffingShortfalls snapshot={snapshot} requirementId={requirement.id} />
      </section>
    );
  if (block)
    return (
      <section class="pk-stack">
        <div class="pk-cluster">
          <Button onClick={() => setBlock(null)}>Back to staffing</Button>
          <h3>{block.name}</h3>
        </div>
        <DescriptionList
          items={[
            { term: "Time", value: formatTimeRangeInZone(block.startAt, block.endAt, snapshot.timeZone) },
            { term: "Time zone", value: snapshot.timeZone },
          ]}
        />
        <DataTable
          caption="Block staffing needs"
          data={snapshot.staffingRequirements.filter((row) => row.blockId === block.id)}
          empty="No staffing needs configured for this block."
          rowKey={(row) => row.id}
          rowAction={(row) => ({
            label: `Review ${roleName(row.roleId)} · ${postName(row.postId)}`,
            onSelect: () => setRequirement(row.id),
          })}
          columns={[
            { header: "Role", cell: (row) => roleName(row.roleId), width: "primary" },
            { header: "Post", cell: (row) => postName(row.postId) },
            {
              header: "Assigned",
              cell: (row) => formatNumber(coverage.find((value) => value.requirementId === row.id)?.assignedCount ?? 0),
              align: "end",
              width: "fit",
            },
            { header: "Ideal", cell: (row) => formatNumber(row.idealCount), align: "end", width: "fit" },
            {
              header: "Unfilled",
              cell: (row) => formatNumber(coverage.find((value) => value.requirementId === row.id)?.missingCount ?? 0),
              align: "end",
              width: "fit",
            },
            {
              header: "Actions",
              cell: (row) => (
                <RowActions
                  subject={`${roleName(row.roleId)} · ${postName(row.postId)}`}
                  actions={[{ id: "review", label: "Review positions", onSelect: () => setRequirement(row.id) }]}
                />
              ),
              width: "fit",
            },
          ]}
        />
      </section>
    );
  return (
    <>
      <TabList
        label="Staffing views"
        activeId={tab}
        onSelect={setTab}
        idPrefix="staffing-view"
        items={[
          { id: "blocks", label: "Blocks", panelId: "staffing-blocks" },
          { id: "people", label: "Workload", panelId: "staffing-people" },
        ]}
      />
      <div role="tabpanel" id={`staffing-${tab}`} aria-labelledby={`staffing-view-${tab}`}>
        {tab === "blocks" ? (
          <ApiDataTable
            caption="Staffing blocks"
            endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/blocks`}
            responseSchema={agendaBlocksListSchema}
            resolve={(response) => response.blocks}
            resolvePage={(response) => response.page}
            paginate
            initialSort="startAt"
            urlState="staffing-blocks"
            searchPlaceholder="Block name, location or track"
            createAction={canEdit && createBlock ? { label: "New block", onSelect: createBlock } : undefined}
            onData={(response) => blockSelection.onRows(response.blocks)}
            onQueryChange={blockSelection.onQueryChange}
            bulkBar={
              canEdit &&
              configureRotation && (
                <BulkBar
                  count={blockSelection.selected.size}
                  total={blockSelection.total}
                  onClear={blockSelection.clear}
                >
                  <Button size="sm" onClick={() => configureRotation([...blockSelection.selected])}>
                    Configure rotation for selected blocks
                  </Button>
                </BulkBar>
              )
            }
            selection={canEdit && configureRotation ? blockSelection.selection : undefined}
            empty={
              canEdit && createBlock
                ? "No staffing blocks match. Use New block to configure a staffing period."
                : "No staffing blocks match."
            }
            rowKey={(row) => row.id}
            rowAction={(row) => ({ label: `Review ${row.name}`, onSelect: () => setBlock(row.id) })}
            columns={[
              { header: "Block", cell: (row) => row.name, width: "primary", sort: { asc: "name", desc: "-name" } },
              {
                header: "Time",
                cell: (row) => formatTimeRangeInZone(row.startAt, row.endAt, snapshot.timeZone),
                sort: { asc: "startAt", desc: "-startAt" },
              },
              {
                header: "Location",
                cell: (row) => snapshot.rooms.find((room) => room.id === row.roomId)?.name ?? "Event",
                width: "fit",
              },
              {
                header: "Unfilled",
                cell: (row) => {
                  const count = unfilledByBlock.get(row.id) ?? 0;
                  return count > 0 ? <Badge tone="warn">{formatNumber(count)} unfilled</Badge> : "—";
                },
                align: "end",
                width: "fit",
              },
              {
                header: "Boundary",
                cell: (row) => (
                  <Badge
                    tone={
                      snapshot.staffingReport?.boundaryChanges.some((change) => change.blockId === row.id)
                        ? "warn"
                        : "neutral"
                    }
                  >
                    {snapshot.staffingReport?.boundaryChanges.some((change) => change.blockId === row.id)
                      ? "Review times"
                      : "Scheduled"}
                  </Badge>
                ),
                width: "fit",
              },
              {
                header: "Actions",
                cell: (row) => (
                  <RowActions
                    subject={row.name}
                    actions={[
                      { id: "review", label: "Review staffing", onSelect: () => setBlock(row.id) },
                      ...(canEdit
                        ? [
                            { id: "edit", label: "Edit block", onSelect: () => editBlock(row.id) },
                            { id: "needs", label: "Staffing needs", onSelect: () => editNeeds(row.id) },
                          ]
                        : []),
                    ]}
                  />
                ),
                width: "fit",
              },
            ]}
          />
        ) : (
          <TableList caption="Staffing workload roster">
            <CollectionToolbar
              label="Duty workload controls"
              createAction={
                canEdit && createPerson ? { label: "Add eligible person", onSelect: createPerson } : undefined
              }
            />

            <DataTable
              caption="Duty workload"
              data={snapshot.staffingReport?.people ?? []}
              rowKey={(row) => row.userId}
              empty="No eligible people configured."
              columns={[
                { header: "Person", cell: (row) => row.displayName, width: "primary" },
                { header: "Minutes", cell: (row) => formatNumber(row.minutes), align: "end", width: "fit" },
                { header: "Pinned", cell: (row) => formatNumber(row.pinnedCount), align: "end", width: "fit" },
                { header: "Manual", cell: (row) => formatNumber(row.manualCount), align: "end", width: "fit" },
                {
                  header: "Actions",
                  cell: (row) => (
                    <RowActions
                      subject={row.displayName}
                      actions={
                        canEdit ? [{ id: "edit", label: "Edit person", onSelect: () => editPerson(row.userId) }] : []
                      }
                    />
                  ),
                  width: "fit",
                },
              ]}
            />
          </TableList>
        )}
      </div>
    </>
  );
}
