import { useAgendaRoomEditor } from "./useAgendaRoomEditor";
import { AgendaWorkspaceActions } from "./AgendaWorkspaceActions";
import { AgendaPublicationWorkspace } from "./AgendaPublicationWorkspace";
import { AgendaTimeStep } from "./AgendaTimeStep";
import { AgendaSelectionStatus } from "./AgendaSelectionStatus";
import { AcceptedProposalSchedulingPanel } from "./AcceptedProposalSchedulingPanel";
import { useAcceptedProposalPlacement } from "./useAcceptedProposalPlacement";
import { AcceptedProposalPlacementReview } from "./AcceptedProposalPlacementReview";
import { AgendaBoardDropTarget } from "./AgendaBoardDropTarget";
import { AgendaPublicPreview } from "./AgendaPublicPreview";
import { AgendaWorkspaceHeader, AgendaWorkspacePanels, type AgendaWorkspaceView } from "./AgendaWorkspaceHeader";
import { SessionDuplicate } from "./SessionDuplicate";
import { agendaMovedSpeakers } from "../../../../../../../shared/event-agenda-rooms";
import {
  agendaScheduleProposalSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { useAgendaScheduling } from "./useAgendaScheduling";
import { agendaSessionActions } from "./session-actions";
import { useAgendaTargetSelection } from "./useAgendaTargetSelection";
import { ContentLibrary } from "./ContentLibrary";
import { AgendaSessionTable } from "./AgendaSessionTable";
import { SessionPromotionKit } from "./SessionPromotionKit";
import { SessionHistoryEditor } from "./SessionHistoryEditor";
import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import {
  agendaOccurrencePatchSchema,
  agendaOccurrenceSchema,
  agendaSnapshotSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { AgendaDayNavigation } from "./AgendaDayNavigation";
import { useData } from "../../../../../../hooks/useData";
import { useUrlTableState } from "../../../../../../hooks/useUrlTableState";
import { getJson, patchJson } from "../../../../../../shared/api-client";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { RowActions } from "../../../../../../ui/RowActions";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { agendaPresenter } from "./presenter";
import { AgendaGeometry } from "./AgendaGeometry";
import { AgendaSettings } from "./AgendaSettings";
import { SessionMove } from "./SessionMove";
import { AgendaImport } from "./AgendaImport";
import { SessionSwap } from "./SessionSwap";
import { RoomEditor } from "./RoomEditor";
import { StaffingEditor } from "./StaffingEditor";
import "./AgendaEditor.css";

const SessionEditor = lazy(() => import("./SessionEditor").then((module) => ({ default: module.SessionEditor })));

const SessionBookings = lazy(() =>
  import("../participation/SessionBookings").then((module) => ({ default: module.SessionBookings })),
);

export function AgendaEditor({
  slug,
  canEdit,
  canReviewAppearances = false,
}: {
  slug: string;
  canEdit: boolean;
  canReviewAppearances?: boolean;
}) {
  const source = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  const [promotionSession, setPromotionSession] = useState<AgendaOccurrence | null>(null);
  const [historySession, setHistorySession] = useState<AgendaOccurrence | null>(null);
  const [participation, setParticipation] = useState<AgendaOccurrence | null>(null);
  const [settings, setSettings] = useState(false);
  const [moving, setMoving] = useState<AgendaOccurrence | null>(null);
  const [undo, setUndo] = useState<
    | { id: string; body: ReturnType<typeof agendaOccurrencePatchSchema.parse> }
    | { schedule: true; body: AgendaScheduleProposal }
    | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [acceptedBacklog, setAcceptedBacklog] = useState(false);
  const [publicPreview, setPublicPreview] = useState(false);
  const [publicationReview, setPublicationReview] = useState(false);
  const [importProposalIds, setImportProposalIds] = useState<string[] | undefined>();
  const [duplicating, setDuplicating] = useState<AgendaOccurrence | null>(null);
  const [swapping, setSwapping] = useState<AgendaOccurrence | null>(null);
  const roomEditor = useAgendaRoomEditor();
  const [snapshot, setSnapshot] = useState<AgendaSnapshot | null>(null);
  const [view, setView] = useState<AgendaWorkspaceView>("agenda");
  const [day, setDay] = useState("");
  const [editing, setEditing] = useState<AgendaOccurrence | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = snapshot?.eventSlug === slug ? snapshot : source.data;
  const acceptedPlacement = useAcceptedProposalPlacement(slug);
  const target = useAgendaTargetSelection(slug, busy, data?.occurrences);
  const { resizing, dragged } = target;
  const scheduling = useAgendaScheduling(slug, data, busy, accept, target.cancel, setError);
  useUrlTableState("agenda");
  if (source.loading && !data) return <Spinner label="Loading agenda…" />;
  if (!data) return <ErrorAlert error={source.error ?? "Agenda unavailable"} />;
  const days = agendaPresenter(data);
  const activeDay = days.find((value) => value.date === day) ?? days[0];
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda`;
  function accept(next: AgendaSnapshot) {
    const changed = data!.occurrences.filter((previous) => {
      const current = next.occurrences.find((value) => value.id === previous.id);
      return current && JSON.stringify(current) !== JSON.stringify(previous);
    });
    const schedulingOnly =
      changed.length > 0 &&
      changed.every((previous) => {
        const current = next.occurrences.find((item) => item.id === previous.id)!;
        const stable = (item: AgendaOccurrence) =>
          agendaOccurrenceSchema.parse({
            ...item,
            startAt: null,
            endAt: null,
            roomId: null,
            additionalRoomIds: [],
            publicationStatus: undefined,
          });
        return (
          JSON.stringify(stable({ ...previous, speakers: agendaMovedSpeakers(previous, current.roomId) })) ===
            JSON.stringify(stable(current)) &&
          (previous.startAt !== current.startAt ||
            previous.endAt !== current.endAt ||
            previous.roomId !== current.roomId ||
            JSON.stringify(previous.additionalRoomIds) !== JSON.stringify(current.additionalRoomIds))
        );
      });
    if (schedulingOnly && next.occurrences.length === data!.occurrences.length) {
      setUndo({
        schedule: true,
        body: agendaScheduleProposalSchema.parse({
          expectedRevision: next.revision,
          changes: changed.map((previous) => ({
            id: previous.id,
            startAt: previous.startAt,
            endAt: previous.endAt,
            roomId: previous.roomId,
            additionalRoomIds: previous.additionalRoomIds ?? [],
            speakerPlacements: Object.fromEntries(
              previous.speakers.map((speaker) => [
                speaker.userId,
                { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
              ]),
            ),
          })),
        }),
      });
    } else if (changed.length === 1 && next.occurrences.length === data!.occurrences.length) {
      const previous = changed[0];
      setUndo({
        id: previous.id,
        body: agendaOccurrencePatchSchema.parse({
          expectedRevision: next.revision,
          title: previous.title,
          description: previous.description,
          startAt: previous.startAt,
          endAt: previous.endAt,
          roomId: previous.roomId,
          additionalRoomIds: previous.additionalRoomIds ?? [],
          requiredEquipment: previous.requiredEquipment ?? [],
          accessPolicy: previous.accessPolicy,
          bookingOpensAt: previous.bookingOpensAt,
          bookingClosesAt: previous.bookingClosesAt,
          admissionPolicy: previous.admissionPolicy,
          capacity: previous.capacity,
          remoteCapacity: previous.remoteCapacity,
          presentationUrl: previous.presentationUrl,
          recordingUrl: previous.recordingUrl,
          visibility: previous.visibility,
          kind: previous.kind,
          speakerUserIds: previous.speakers.map((speaker) => speaker.userId),
          speakerRoles: Object.fromEntries(
            previous.speakers.map((speaker) => [speaker.userId, speaker.role ?? "speaker"]),
          ),
          speakerPlacements: Object.fromEntries(
            previous.speakers.map((speaker) => [
              speaker.userId,
              { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
            ]),
          ),
        }),
      });
    } else setUndo(null);
    setSnapshot(next);
  }
  async function undoLastEdit() {
    if (!undo) return;
    if ("schedule" in undo) {
      scheduling.preview(undo.body);
      setUndo(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await patchJson(`${base}/occurrences/${encodeURIComponent(undo.id)}`, undo.body, agendaSnapshotSchema),
      );
      setUndo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to undo this edit");
      setSnapshot(null);
      setUndo(null);
      await source.reload();
    } finally {
      setBusy(false);
    }
  }
  const { move, resize } = scheduling;
  function invalidResizeTarget(startAt: string, roomId: string) {
    const occurrence = data!.occurrences.find((value) => value.id === resizing);
    return (
      !!resizing &&
      (!occurrence?.startAt ||
        occurrence.roomId !== (roomId || null) ||
        Date.parse(startAt) <= Date.parse(occurrence.startAt))
    );
  }
  function actions(occurrence: AgendaOccurrence, beforeSelect?: () => void) {
    return agendaSessionActions(
      occurrence,
      {
        canEdit,
        canReviewAppearances,
        busy,
        scheduling,
        open: {
          duplicate: setDuplicating,
          history: setHistorySession,
          promotion: setPromotionSession,
          participation: setParticipation,
          move: setMoving,
          swap: setSwapping,
          edit: setEditing,
        },
        select: (id, kind) => {
          setView("agenda");
          target.select(id, kind);
        },
      },
      beforeSelect,
    );
  }
  const workspaceActions = (
    <AgendaWorkspaceActions
      snapshot={data}
      canEdit={canEdit}
      busy={busy}
      onUndo={undo ? () => void undoLastEdit() : undefined}
      onSettings={() => setSettings(true)}
      onImport={() => {
        setImportProposalIds(undefined);
        setImporting(true);
      }}
      onAcceptedProposals={() => {
        setView("agenda");
        setAcceptedBacklog((value) => !value);
      }}
      onPreview={() => setPublicPreview(true)}
      onNewLocation={roomEditor.create}
      onEditLocation={roomEditor.edit}
      onPublication={() => setPublicationReview(true)}
    />
  );
  if (canEdit && scheduling.panel) return scheduling.panel;
  if (
    (canEdit &&
      (participation || settings || moving || importing || swapping || roomEditor.open || editing !== undefined)) ||
    promotionSession ||
    (historySession && (canEdit || canReviewAppearances))
  )
    return (
      <div class="pk-stack pk-agenda-editor">
        {participation && canEdit && (
          <Panel>
            <PanelHeader title={`Participation · ${participation.title}`}>
              <Button onClick={() => setParticipation(null)}>Close</Button>
            </PanelHeader>
            <PanelBody>
              <Suspense fallback={<Spinner />}>
                <SessionBookings
                  slug={slug}
                  occurrenceId={participation.id}
                  onReviewRoom={(proposal) => {
                    const current = data.occurrences.find((item) => item.id === participation.id);
                    if (current)
                      setEditing({
                        ...current,
                        roomId: proposal.proposedRoomId,
                        additionalRoomIds: proposal.proposedAdditionalRoomIds,
                        capacity: proposal.proposedCapacity,
                      });
                  }}
                />
              </Suspense>
            </PanelBody>
          </Panel>
        )}
        {settings && canEdit && <AgendaSettings snapshot={data} onSaved={accept} onClose={() => setSettings(false)} />}
        {moving && canEdit && (
          <SessionMove
            snapshot={data}
            session={moving}
            timeStep={scheduling.timeStep}
            onTimeStep={scheduling.setTimeStep}
            onSaved={accept}
            onClose={() => setMoving(null)}
          />
        )}
        {importing && canEdit && (
          <AgendaImport
            snapshot={data}
            initialProposalIds={importProposalIds}
            onSaved={accept}
            onClose={() => setImporting(false)}
          />
        )}
        {swapping && canEdit && (
          <SessionSwap snapshot={data} first={swapping} onSaved={accept} onClose={() => setSwapping(null)} />
        )}
        {roomEditor.open && canEdit && (
          <RoomEditor
            key={roomEditor.room?.id ?? "new"}
            snapshot={data}
            room={roomEditor.room}
            onSaved={accept}
            onClose={roomEditor.close}
          />
        )}
        {promotionSession && (
          <SessionPromotionKit
            slug={slug}
            occurrence={promotionSession}
            snapshot={canEdit ? data : undefined}
            onSaved={setSnapshot}
            onClose={() => setPromotionSession(null)}
          />
        )}
        {historySession && (canEdit || canReviewAppearances) && (
          <SessionHistoryEditor
            canEdit={canEdit}
            snapshot={data}
            occurrence={historySession}
            onSaved={setSnapshot}
            onClose={() => setHistorySession(null)}
          />
        )}
        {editing !== undefined && canEdit && (
          <Suspense fallback={<Spinner label="Loading session editor…" />}>
            <SessionEditor
              key={`${editing?.id ?? "new"}:${editing?.roomId ?? ""}:${editing?.capacity ?? ""}:${(editing?.additionalRoomIds ?? []).join(",")}`}
              snapshot={data}
              occurrence={editing ?? undefined}
              actions={editing ? (close) => actions(editing, close) : undefined}
              onSaved={accept}
              onClose={() => setEditing(undefined)}
            />
          </Suspense>
        )}
      </div>
    );
  if (publicPreview) return <AgendaPublicPreview slug={slug} onClose={() => setPublicPreview(false)} />;
  if (canEdit && duplicating)
    return (
      <SessionDuplicate snapshot={data} session={duplicating} onSaved={accept} onClose={() => setDuplicating(null)} />
    );
  if (publicationReview)
    return (
      <AgendaPublicationWorkspace
        snapshot={data}
        canEdit={canEdit}
        onSaved={accept}
        onClose={() => setPublicationReview(false)}
      />
    );
  if (canEdit && acceptedPlacement.candidate)
    return (
      <AcceptedProposalPlacementReview
        snapshot={data}
        candidate={acceptedPlacement.candidate}
        onSaved={accept}
        onClose={acceptedPlacement.cancel}
      />
    );
  return (
    <div class={`pk-stack pk-agenda-editor${target.native ? " pk-agenda-editor--native-drag" : ""}`}>
      <AgendaWorkspaceHeader view={view} onViewChange={setView} actions={workspaceActions} />
      <AgendaWorkspacePanels view={view}>
        {(error || source.error) && <ErrorAlert error={error || source.error!} />}
        {canEdit && view === "agenda" && scheduling.bar}
        {view === "agenda" && (
          <>
            <div class="pk-cluster">
              {canEdit && <AgendaTimeStep value={scheduling.timeStep} onChange={scheduling.setTimeStep} />}
              {canEdit && <Button onClick={() => setEditing(null)}>New session</Button>}
            </div>
            {canEdit && (
              <AcceptedProposalSchedulingPanel
                snapshot={data}
                visible={acceptedBacklog}
                empty={!activeDay}
                timeStep={scheduling.timeStep}
                placement={acceptedPlacement}
                onSelecting={target.cancel}
                onReview={(id) => {
                  setImportProposalIds([id]);
                  setImporting(true);
                }}
              />
            )}
            <AgendaDayNavigation days={days} activeDate={activeDay?.date} onSelect={setDay} />
            {(dragged || resizing) && (
              <div class="pk-agenda-editor__selection-status">
                <AgendaSelectionStatus
                  title={
                    data.occurrences.find((value) => value.id === (resizing || dragged))?.title ?? "selected session"
                  }
                  resizing={Boolean(resizing)}
                  busy={busy}
                  onCancel={target.cancel}
                />
              </div>
            )}
            {activeDay && <AgendaGeometry day={activeDay} />}
            {activeDay ? (
              <ContentAgenda
                days={[activeDay]}
                speakers={[]}
                timeZone={data.timeZone}
                editor={{
                  session: (id) => {
                    const occurrence = data.occurrences.find((value) => value.id === id)!;
                    return {
                      resizeHandle: canEdit ? (
                        <button
                          class="pk-agenda-editor__resize"
                          type="button"
                          draggable
                          aria-label={`Resize ${occurrence.title} by dragging to an end time`}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer?.setData("application/x-pkic-agenda-resize", id);
                            acceptedPlacement.cancel();
                            target.select(id, "resize", true);
                          }}
                          onDragEnd={target.endDrag}
                          onClick={() => {
                            acceptedPlacement.cancel();
                            target.select(id, "resize");
                          }}
                        >
                          ↕ Resize duration
                        </button>
                      ) : null,
                      controls:
                        canEdit || canReviewAppearances ? (
                          <div class="pk-agenda-editor__card-actions">
                            <RowActions subject={occurrence.title} actions={actions(occurrence)} />
                          </div>
                        ) : null,
                      detailControls: (close) => (
                        <RowActions subject={occurrence.title} actions={actions(occurrence, close)} />
                      ),
                      onOpen: undefined,
                      onDragEnd: target.endDrag,
                      onDragStart: canEdit
                        ? (event) => {
                            event.dataTransfer?.setData("text/plain", id);
                            acceptedPlacement.cancel();
                            target.select(id, "move", true);
                          }
                        : undefined,
                    };
                  },
                  dropTarget: (startAt, roomId) =>
                    canEdit ? (
                      <AgendaBoardDropTarget
                        snapshot={data}
                        placement={acceptedPlacement}
                        instant={startAt}
                        roomId={roomId}
                        timeStep={scheduling.timeStep}
                        dragged={dragged}
                        resizing={resizing}
                        busy={busy}
                        invalidResize={invalidResizeTarget}
                        move={move}
                        resize={resize}
                      />
                    ) : null,
                }}
              />
            ) : (
              <Panel>
                <PanelBody>
                  <p>No scheduled sessions yet. Create a session or schedule one from the backlog.</p>
                </PanelBody>
              </Panel>
            )}
            <Panel>
              <PanelHeader title="Unscheduled sessions" />
              <PanelBody>
                <div class="pk-agenda-editor__backlog">
                  {data.occurrences
                    .filter((value) => !value.startAt || !value.endAt)
                    .map((value) => (
                      <article
                        draggable={canEdit}
                        onDragEnd={target.endDrag}
                        onDragStart={(event) => {
                          event.dataTransfer?.setData("text/plain", value.id);
                          acceptedPlacement.cancel();
                          target.select(value.id, "move", true);
                        }}
                      >
                        <strong>{value.title}</strong>
                        {(canEdit || canReviewAppearances) && (
                          <RowActions subject={value.title} actions={actions(value)} />
                        )}
                      </article>
                    ))}
                </div>
              </PanelBody>
            </Panel>
          </>
        )}
        {view === "sessions" && (
          <AgendaSessionTable
            retainUrlStateOnUnmount
            key={data.revision}
            data={data}
            days={days}
            canAct={canEdit || canReviewAppearances}
            actions={actions}
            toolbar={canEdit ? scheduling.bar : undefined}
            onNewSession={canEdit ? () => setEditing(null) : undefined}
            onEdit={canEdit ? setEditing : undefined}
            selection={canEdit ? scheduling.selection : undefined}
            onData={scheduling.onTableData}
          />
        )}
        {view === "library" && <ContentLibrary snapshot={data} canEdit={canEdit} onSaved={accept} />}
        {view === "staffing" && <StaffingEditor snapshot={data} canEdit={canEdit} onSaved={accept} />}
      </AgendaWorkspacePanels>
    </div>
  );
}
